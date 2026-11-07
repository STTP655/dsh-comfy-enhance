/**
 * 漫画工具（preset 作用域）。
 *
 * 只在「漫画模式」这个 agent preset 里挂载，因此 comic_* 三个工具只对该模式
 * 的会话可见；普通会话根本不注册，不是隐藏。
 *
 * 数据走向：
 *   ~/.dsh/comic/state.json  ← 工作台保存时推送的实时文档（读）
 *   ~/.dsh/comic/draft.json  ← agent 写入，工作台轮询后自动载入（写）
 */
import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'comic-tools'
export const inject = ['tools']

const BUBBLE_TYPES = ['speech', 'thought', 'shout', 'whisper', 'box', 'caption', 'sfx', 'free']

let cachedOutputDir = undefined
/** 从 ComfyUI 的 /system_stats.argv 推输出目录；成功一次就缓存。 */
async function comfyOutputDir() {
  if (cachedOutputDir !== undefined) return cachedOutputDir
  cachedOutputDir = null
  try {
    const res = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    const argv = JSON.parse(data.system.argv)
    let dir = ''
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--output-directory' && argv[i + 1]) { dir = argv[i + 1]; break }
    }
    if (!dir) {
      const main = argv.find((a) => typeof a === 'string' && a.endsWith('main.py'))
      if (main) dir = join(dirname(main), 'output')
    }
    if (dir) {
      await stat(dir)
      cachedOutputDir = dir
    }
  } catch (error) {
    cachedOutputDir = null
  }
  return cachedOutputDir
}

function comicDir() {
  return join(homedir(), '.dsh', 'comic')
}
function draftPath() {
  return join(comicDir(), 'draft.json')
}
function statePath() {
  return join(comicDir(), 'state.json')
}

function make(def) {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    execute: def.execute,
  }
}

export function apply(ctx) {
  ctx.tools.register(
    make({
      name: 'comic_status',
      description:
        '查看漫画工作台当前状态：多少页多少格、每格提示词摘要与气泡数、每格多边形（毫米）、整页描述。source=live 表示读的是用户手上真实的画板。改写前先调用它。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      async execute() {
        const live = statePath()
        const draft = draftPath()
        let file = live
        let source = 'live'
        let text = ''
        let mtimeMs = 0
        try {
          text = await readFile(live, 'utf8')
          mtimeMs = (await stat(live)).mtimeMs
        } catch {
          file = draft
          source = 'draft'
          try {
            text = await readFile(draft, 'utf8')
            mtimeMs = (await stat(draft)).mtimeMs
          } catch {
            return { ok: true, exists: false, path: draft, livePath: live }
          }
        }
        let doc = null
        try {
          doc = JSON.parse(text)
        } catch {
          return { ok: false, exists: true, path: file, source, error: '不是合法 JSON' }
        }
        const panels = []
        if (Array.isArray(doc.pages)) {
          doc.pages.forEach((pg, pi) => {
            ;(pg && Array.isArray(pg.panels) ? pg.panels : []).forEach((p, i) => {
              panels.push({
                page: pi + 1,
                index: i + 1,
                prompt: String((p && p.prompt) || '').slice(0, 120),
                balloons: Array.isArray(p && p.balloons) ? p.balloons.length : 0,
                poly: Array.isArray(p && p.poly)
                  ? p.poly.map((v) => ({
                      x: Math.round(Number(v.x) * 100) / 100,
                      y: Math.round(Number(v.y) * 100) / 100,
                    }))
                  : [],
              })
            })
          })
        }
        return {
          ok: true,
          exists: true,
          path: file,
          source,
          mtimeMs,
          panels,
          summary:
            doc && doc.summary
              ? (typeof doc.summary === 'string' ? doc.summary : String(doc.summary.caption || '')).slice(0, 300)
              : '',
        }
      },
    }),
  )

  ctx.tools.register(
    make({
      name: 'comic_fill',
      description:
        '按当前画板的既有分格回填内容：只改提示词与气泡，几何一律不动。先 comic_status 拿 page/index，再提交 updates；也可以只传 summary 改整页画风。写入后工作台约 2.5 秒自动载入。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string', description: '整页描述 / 画风（写进 MOSS layout 的 summary.caption）' },
          updates: {
            type: 'array',
            description: '要改的格子，page/index 均为 1 起算',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                page: { type: 'integer' },
                index: { type: 'integer' },
                prompt: { type: 'string' },
                balloons: { type: 'array' },
              },
            },
          },
        },
      },
      async execute(args) {
        let text = ''
        try {
          text = await readFile(statePath(), 'utf8')
        } catch {
          throw new Error('还没有实时画板状态：先在工作台里摆好分格并保存一次')
        }
        const doc = JSON.parse(text)
        if (!Array.isArray(doc.pages)) throw new Error('实时状态不是工作台格式（没有 pages）')
        if (args && typeof args.summary === 'string') doc.summary = args.summary
        const updates = Array.isArray(args && args.updates) ? args.updates : []
        if (!updates.length && !(args && typeof args.summary === 'string')) {
          throw new Error('updates 为空，且没有给 summary')
        }
        let changed = 0
        for (const u of updates) {
          const pageIdx = Math.max(1, Number(u && u.page) || 1) - 1
          const panelIdx = Math.max(1, Number(u && u.index) || 0) - 1
          const pg = doc.pages[pageIdx]
          const panel = pg && Array.isArray(pg.panels) ? pg.panels[panelIdx] : null
          if (!panel) continue
          if (typeof u.prompt === 'string') panel.prompt = u.prompt
          if (Array.isArray(u.balloons)) {
            const poly = Array.isArray(panel.poly) ? panel.poly : []
            const xs = poly.map((v) => Number(v.x) || 0)
            const ys = poly.map((v) => Number(v.y) || 0)
            const bx = xs.length ? Math.min(...xs) : 10
            const by = ys.length ? Math.min(...ys) : 10
            const bw = xs.length ? Math.max(...xs) - bx : 80
            const bh = ys.length ? Math.max(...ys) - by : 100
            panel.balloons = u.balloons.map((b, i) => {
              const type = b && BUBBLE_TYPES.includes(b.type) ? b.type : 'speech'
              const size = {
                speech: [0.34, 0.15], thought: [0.34, 0.16], shout: [0.34, 0.17], whisper: [0.34, 0.15],
                box: [0.27, 0.24], caption: [0.24, 0.3], sfx: [0.5, 0.2], free: [0.5, 0.14],
              }[type]
              const w = Math.max(12, Math.min(64, bw * size[0]))
              const h = Math.max(8, Math.min(80, bh * size[1]))
              return {
                id: 'b' + Math.random().toString(36).slice(2, 8),
                type,
                text: String((b && b.text) || ''),
                x: Math.round((bx + bw * 0.06 + (i % 3) * 5) * 100) / 100,
                y: Math.round((by + bh * 0.06 + (i % 2) * 7) * 100) / 100,
                w: Math.round(w * 100) / 100,
                h: Math.round(h * 100) / 100,
                fontSize: type === 'sfx' ? 7.5 : 4.2,
                vertical: type === 'caption' || type === 'box',
                tailX: 0.72,
                tailY: 10,
              }
            })
          }
          changed++
        }
        if (!changed && !(args && typeof args.summary === 'string')) {
          throw new Error('没有匹配到任何格子，检查 page/index')
        }
        const draft = draftPath()
        await mkdir(dirname(draft), { recursive: true })
        await writeFile(draft, JSON.stringify(doc, null, 2), 'utf8')
        const info = await stat(draft)
        return {
          ok: true,
          changed,
          path: draft,
          mtimeMs: info.mtimeMs,
          hint: '工作台约 2.5 秒内自动载入，分格几何保持不变。',
        }
      },
    }),
  )

  ctx.tools.register(
    make({
      name: 'comic_images',
      description:
        '按需取出画板当前显示的图片（生成后的成图），返回本地绝对路径，供 read_image 检查构图/角色一致性/文字是否画错。默认只返回已有图的格子；可用 since（epoch 毫秒）只看这之后生成的图。不主动推送，只在调用时读取。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'integer', description: '只看某一页（1 起算），省略=全部' },
          since: { type: 'number', description: 'epoch 毫秒；只返回 imgAt 大于它的图' },
          fetch: { type: 'boolean', description: '是否把远程图下载到本地缓存（默认 true）' },
        },
      },
      async execute(args) {
        let text = ''
        try {
          text = await readFile(statePath(), 'utf8')
        } catch {
          try { text = await readFile(draftPath(), 'utf8') } catch {
            return { ok: true, exists: false, panels: [] }
          }
        }
        const doc = JSON.parse(text)
        const pages = Array.isArray(doc.pages) ? doc.pages : []
        const wantPage = Number(args && args.page) || 0
        const since = Number(args && args.since) || 0
        const doFetch = args && args.fetch === false ? false : true
        const out = []
        const cacheDir = join(comicDir(), 'images')
        if (doFetch) await mkdir(cacheDir, { recursive: true })
        // 「整页出图」只产页级大图（pages[i].image），分格 img 为空串；
        // 这里两条都收，否则整页路径永远看不见图。
        const resolveName = function (url) {
          const raw = String(url || '')
          const m = /[?&]filename=([^&]+)/.exec(raw)
          if (m) return decodeURIComponent(m[1])
          const tail = raw.split('/').pop().split('?')[0]
          return tail || ''
        }
        for (let pi = 0; pi < pages.length; pi++) {
          if (wantPage && pi + 1 !== wantPage) continue
          const pageImage = typeof pages[pi].image === 'string' ? pages[pi].image : ''
          if (pageImage) {
            const name = resolveName(pageImage)
            const entry = { page: pi + 1, index: 0, kind: 'page', img: name, at: Number(pages[pi].imageAt) || 0 }
            if (doFetch && name) {
              const outDir = await comfyOutputDir()
              if (outDir && name) {
                try {
                  const direct = join(outDir, name)
                  const info = await stat(direct)
                  entry.path = direct
                  if (!entry.at) entry.at = Math.round(info.mtimeMs)
                } catch (error) { /* 落到下载 */ }
              }
              try {
                if (entry.path) throw Object.assign(new Error('done'), { skipFetch: true })
                const target = join(cacheDir, 'page-' + (pi + 1) + '-' + name)
                const res = await fetch('http://127.0.0.1:8188/view?filename=' + encodeURIComponent(name) + '&type=output', { signal: AbortSignal.timeout(20000) })
                if (res.ok) {
                  await writeFile(target, Buffer.from(await res.arrayBuffer()))
                  entry.path = target
                  const info = await stat(target)
                  if (!entry.at) entry.at = Math.round(info.mtimeMs)
                } else {
                  entry.error = 'HTTP ' + res.status
                }
              } catch (error) {
                if (!(error && error.skipFetch)) entry.error = String((error && error.message) || error)
              }
            }
            if (!since || !entry.at || entry.at > since) out.push(entry)
          }
          const panels = Array.isArray(pages[pi].panels) ? pages[pi].panels : []
          for (let i = 0; i < panels.length; i++) {
            const panel = panels[i] || {}
            const img = typeof panel.img === 'string' ? panel.img : ''
            if (!img) continue
            const at = Number(panel.imgAt) || 0
            if (since && at && at <= since) continue
            const entry = { page: pi + 1, index: i + 1, img, at, prompt: String(panel.prompt || '').slice(0, 120) }
            if (doFetch) {
              try {
                const name = String(img).split('/').pop().split('?')[0] || ('panel-' + pi + '-' + i + '.png')
                const outDir = await comfyOutputDir()
                if (outDir) {
                  try {
                    const direct = join(outDir, name)
                    await stat(direct)
                    entry.path = direct
                  } catch (error) { /* 落到下载 */ }
                }
                if (entry.path) throw Object.assign(new Error('done'), { skipFetch: true })
                const target = join(cacheDir, pi + 1 + '-' + (i + 1) + '-' + name)
                const res = await fetch('http://127.0.0.1:8188/view?filename=' + encodeURIComponent(name) + '&type=output', { signal: AbortSignal.timeout(20000) })
                if (res.ok) {
                  await writeFile(target, Buffer.from(await res.arrayBuffer()))
                  entry.path = target
                } else {
                  entry.error = 'HTTP ' + res.status
                }
              } catch (error) {
                if (!(error && error.skipFetch)) entry.error = String((error && error.message) || error)
              }
            }
            out.push(entry)
          }
        }
        return {
          ok: true,
          count: out.length,
          cacheDir,
          panels: out,
          hint: out.length ? '用 read_image 打开 path 检查；只看新图可传 since。' : '当前没有已生成的图。',
        }
      },
    }),
  )

  ctx.tools.register(
    make({
      name: 'comic_import',
      description:
        '把一份完整漫画文档设为工作台当前草稿（会替换现有全部页面）。document 支持 {pages:[{panels:[{prompt,balloons}]}]} 或 MOSS 草案 {width,height,items:[{label,caption,bbox,text}]}。只想改内容、不动分格时用 comic_fill。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['document'],
        properties: {
          document: { type: 'object', additionalProperties: true, description: '漫画文档 JSON' },
          note: { type: 'string', description: '给操作者看的备注（可选）' },
        },
      },
      async execute(args) {
        const doc = args && args.document
        if (!doc || typeof doc !== 'object') throw new Error('document 必须是 JSON 对象')
        const shape = Array.isArray(doc.pages) || Array.isArray(doc.panels) || Array.isArray(doc.items)
        if (!shape) throw new Error('document 里找不到 pages / panels / items')
        const file = draftPath()
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(doc, null, 2), 'utf8')
        const info = await stat(file)
        let panels = 0
        let pages = 1
        if (Array.isArray(doc.pages)) {
          pages = doc.pages.length
          panels = doc.pages.reduce((s, pg) => s + ((pg && Array.isArray(pg.panels)) ? pg.panels.length : 0), 0)
        } else if (Array.isArray(doc.items)) {
          panels = doc.items.filter((it) => it && it.label !== 'text').length
        } else if (Array.isArray(doc.panels)) {
          panels = doc.panels.length
        }
        return {
          ok: true,
          path: file,
          pages,
          panels,
          note: (args && args.note) || '',
          mtimeMs: info.mtimeMs,
          hint: '工作台若已打开，约 2.5 秒后自动载入；未打开则下次打开时载入。',
        }
      },
    }),
  )
}
