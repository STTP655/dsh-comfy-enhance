/**
 * Host half of dsh-comfy-canvas.
 *
 * Reads and writes the ComfyUI user workflow files so the canvas tab can edit a
 * workflow's bounding boxes without going through ComfyUI's own UI. The
 * workflows directory is derived from the running instance's `argv` in
 * `/system_stats`, so no path needs to be configured while the engine is local.
 */

import { dirname, join, extname, resolve } from 'node:path'
import { readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_URL = 'http://127.0.0.1:8188'
const TIMEOUT_MS = 4000
const PREFIX = '/plugin/comfy-canvas'
const MAX_BODY = 16 * 1024 * 1024
/** Bundled, empty-board MOSS workflow installed on first use. */
const TEMPLATE_NAME = 'moss-bbox-canvas.json'
const TEMPLATE_URL = new URL('./templates/moss-bbox-canvas.json', import.meta.url)

export const inject = ['webServer']

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

/** The workflows directory of the ComfyUI instance behind `baseUrl`. */
async function resolveWorkflowDir(baseUrl) {
  const stats = await getJSON(`${baseUrl}/system_stats`)
  const argv = (stats && stats.system && stats.system.argv) || []
  const mainPy = argv.find((entry) => typeof entry === 'string' && /main\.py$/i.test(entry))
  if (!mainPy) throw new Error('cannot derive the ComfyUI root from system_stats.argv')
  return join(dirname(mainPy), 'user', 'default', 'workflows')
}

/**
 * Install the bundled empty-board workflow on first use.
 *
 * A file with the same name is never overwritten, so a user's own edits and an
 * existing setup survive; a read-only workflows directory just means no default.
 */
async function ensureTemplate(dir) {
  const target = join(dir, TEMPLATE_NAME)
  try {
    await stat(target)
    return
  } catch {
    // Not installed yet: fall through.
  }
  try {
    await copyFile(fileURLToPath(TEMPLATE_URL), target)
  } catch {
    // Read-only directory: the canvas simply has no default entry.
  }
}

/** Reject anything that is not a plain workflow file name. */
function safeName(name) {
  if (typeof name !== 'string' || name.length === 0) throw new Error('file is required')
  if (name.includes('/') || name.includes('\\') || name.includes('..')) throw new Error('invalid file name')
  if (extname(name).toLowerCase() !== '.json') throw new Error('only .json workflow files are supported')
  return name
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The text encoder a sampler's positive input points at, with a fallback. */
function findPositiveTextNode(nodes) {
  let sampler = null
  for (const node of Object.values(nodes || {})) {
    const inputs = node && node.inputs
    if (inputs && 'steps' in inputs && ('cfg' in inputs || 'sampler_name' in inputs)) {
      sampler = node
      break
    }
  }
  const ref = sampler && Array.isArray(sampler.inputs.positive) ? String(sampler.inputs.positive[0]) : ''
  if (ref && nodes[ref] && nodes[ref].inputs && typeof nodes[ref].inputs.text === 'string') return ref
  for (const [id, node] of Object.entries(nodes || {})) {
    if (node && node.inputs && typeof node.inputs.text === 'string') return id
  }
  return null
}

/**
 * Submit one MOSS layout JSON as a generation job.
 *
 * The canvas workflow is UI format and `/prompt` only accepts the API graph, so
 * the newest history entry that actually ran a MOSSImage node is used as the
 * template and only its positive prompt text is replaced.
 */
async function submitLayout(baseUrl, layout) {
  const history = await getJSON(`${baseUrl}/history?max_items=50`)
  let template = null
  for (const entry of Object.values(history || {})) {
    const nodes = entry && entry.prompt ? (Array.isArray(entry.prompt) ? entry.prompt[2] : entry.prompt) : null
    if (!nodes) continue
    const isMoss = Object.values(nodes).some(
      (node) => node && typeof node.class_type === 'string' && node.class_type.indexOf('MOSSImage') === 0,
    )
    if (isMoss) {
      template = nodes
      break
    }
  }
  if (!template) throw new Error('没有可用的 MOSS 生成模板：先在 ComfyUI 里成功生成一张 MOSS 图')

  const graph = JSON.parse(JSON.stringify(template))
  const positiveId = findPositiveTextNode(graph)
  if (!positiveId) throw new Error('模板里找不到正向提示词节点')
  graph[positiveId].inputs.text = JSON.stringify(layout)

  const clientId = 'dsh-canvas-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  const res = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
    signal: AbortSignal.timeout(15000),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = payload && payload.error ? JSON.stringify(payload.error) : `HTTP ${res.status}`
    throw new Error('ComfyUI 拒绝了这个任务：' + detail)
  }
  return { ok: true, promptId: (payload && payload.prompt_id) || '' }
}

export function apply(ctx, config = {}) {
  const configured = config && typeof config.comfyUrl === 'string' ? config.comfyUrl.trim() : ''
  const envUrl = typeof process !== 'undefined' && process.env ? process.env.DSH_COMFY_URL : ''
  const baseUrl = String(configured || envUrl || DEFAULT_URL).replace(/\/+$/, '')

  let cachedDir = null

  async function dirOf() {
    if (cachedDir !== null) return cachedDir
    const dir = await resolveWorkflowDir(baseUrl)
    cachedDir = dir
    return dir
  }

  async function handler(req, res) {
    let pathname = ''
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname
    } catch {
      pathname = ''
    }

    const send = (status, body) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(body))
    }

    if (pathname === `${PREFIX}/resolutions`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const info = await getJSON(`${baseUrl}/object_info/ResolutionSelector`)
        const def = info && info.ResolutionSelector
        const required = (def && def.input && def.input.required) || {}
        const ratio = required.aspect_ratio
        const megapixels = required.megapixels
        return send(200, {
          ok: true,
          ratios: (ratio && ratio[1] && ratio[1].options) || [],
          megapixels: (megapixels && megapixels[1]) || {},
        })
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/workflows`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const dir = await dirOf()
        await ensureTemplate(dir)
        const names = (await readdir(dir)).filter((name) => /\.json$/i.test(name))
        const files = []
        for (const name of names) {
          try {
            const info = await stat(join(dir, name))
            files.push({ name, size: info.size, mtime: info.mtimeMs })
          } catch {
            // A file removed mid-listing is simply skipped.
          }
        }
        files.sort((left, right) => right.mtime - left.mtime)
        return send(200, { ok: true, dir, files })
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/generate`) {
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const body = JSON.parse((await readBody(req)) || '{}')
        if (!body || typeof body.layout !== 'object' || body.layout === null) {
          throw new Error('缺少 layout')
        }
        return send(200, await submitLayout(baseUrl, body.layout))
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/workflow`) {
      let name
      try {
        name = safeName(new URL(req.url || '/', 'http://localhost').searchParams.get('file'))
      } catch (error) {
        return send(400, { ok: false, error: String((error && error.message) || error) })
      }

      let dir
      try {
        dir = await dirOf()
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }

      const target = resolve(dir, name)
      if (!target.startsWith(resolve(dir))) return send(400, { ok: false, error: 'path escapes the workflows directory' })

      if (req.method === 'GET' || req.method === 'HEAD') {
        try {
          const text = await readFile(target, 'utf8')
          return send(200, { ok: true, name, workflow: JSON.parse(text) })
        } catch (error) {
          return send(404, { ok: false, error: String((error && error.message) || error) })
        }
      }

      if (req.method === 'POST') {
        let parsed
        try {
          parsed = JSON.parse(await readBody(req))
        } catch (error) {
          return send(400, { ok: false, error: 'invalid JSON body: ' + String((error && error.message) || error) })
        }
        try {
          // Keep one previous copy so a bad save never loses the workflow.
          await copyFile(target, target + '.bak').catch(() => {})
          await writeFile(target, JSON.stringify(parsed, null, 2), 'utf8')
          return send(200, { ok: true, name, savedAt: Date.now() })
        } catch (error) {
          return send(500, { ok: false, error: String((error && error.message) || error) })
        }
      }

      return send(405, { ok: false, error: 'method not allowed' })
    }

    return send(404, { ok: false, error: 'not found' })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }))
}
