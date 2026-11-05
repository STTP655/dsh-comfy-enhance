/**
 * Host half of dsh-comfy-canvas.
 *
 * Reads and writes the ComfyUI user workflow files so the canvas tab can edit a
 * workflow's bounding boxes without going through ComfyUI's own UI. The
 * workflows directory is derived from the running instance's `argv` in
 * `/system_stats`, so no path needs to be configured while the engine is local.
 */

import { isAbsolute, dirname, join, extname, resolve } from 'node:path'
import { readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const DEFAULT_URL = 'http://127.0.0.1:8188'
const TIMEOUT_MS = 4000
const PREFIX = '/plugin/comfy-canvas'
const MAX_BODY = 16 * 1024 * 1024
/** Bundled, empty-board MOSS workflow installed on first use. */
const TEMPLATE_NAME = 'moss-bbox-canvas.json'
const TEMPLATE_URL = new URL('./templates/moss-bbox-canvas.json', import.meta.url)
// Bundled canvas workflows for the two model families; installed on first use so
// a fresh install only needs ComfyUI running, no manual download.
const TEMPLATE_BASE_NAME = 'moss-base-canvas.json'
const TEMPLATE_BASE_URL = new URL('./templates/moss-base-canvas.json', import.meta.url)
const TEMPLATE_SFT_NAME = 'moss-sft-canvas.json'
const TEMPLATE_SFT_URL = new URL('./templates/moss-sft-canvas.json', import.meta.url)
/** Bundled API graph for quick generate (models + sampler, positive prompt empty). */
const TEMPLATE_IMAGE_URL = new URL('./templates/moss-image-api.json', import.meta.url)
/** SFT checkpoints need the MOSS-specific loaders; base/fp8 use the plain ones. */
const TEMPLATE_IMAGE_SFT_URL = new URL('./templates/moss-image-sft-api.json', import.meta.url)

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
  // A relative "main.py" resolves against this process's cwd (the DSH install),
  // not the ComfyUI folder: refuse instead of scanning a random directory.
  if (!isAbsolute(mainPy)) {
    throw new Error('ComfyUI 是用相对路径启动的，无法定位工作流目录；请关闭它并改用插件里的「启动 ComfyUI」重新启动一次')
  }
  return join(dirname(mainPy), 'user', 'default', 'workflows')
}

/**
 * Install the bundled canvas workflows.
 *
 * Without `force` an existing file is kept, so a user's own edits and an earlier
 * install survive. With `force` the previous file is backed up as `.bak` first.
 */
async function installTemplates(dir, force) {
  const entries = [
    [TEMPLATE_NAME, TEMPLATE_URL],
    [TEMPLATE_BASE_NAME, TEMPLATE_BASE_URL],
    [TEMPLATE_SFT_NAME, TEMPLATE_SFT_URL],
  ]
  for (const [name, url] of entries) {
    const target = join(dir, name)
    if (force) {
      try {
        await copyFile(target, target + '.bak')
      } catch {
        // Nothing to back up yet.
      }
      try {
        await writeFile(target, await readFile(fileURLToPath(url)))
      } catch {
        // Read-only directory: leave it as is.
      }
      continue
    }
    try {
      await stat(target)
      continue
    } catch {
      // Not installed yet: fall through.
    }
    try {
      await copyFile(fileURLToPath(url), target)
    } catch {
      // Read-only directory: the canvas simply has no default entry.
    }
  }
}

async function ensureTemplate(dir) {
  await installTemplates(dir, false)
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

/** The text encoder a sampler's negative input points at, when it has one. */
function findNegativeTextNode(nodes) {
  let sampler = null
  for (const node of Object.values(nodes || {})) {
    const inputs = node && node.inputs
    if (inputs && 'steps' in inputs && ('cfg' in inputs || 'sampler_name' in inputs)) {
      sampler = node
      break
    }
  }
  const ref = sampler && Array.isArray(sampler.inputs.negative) ? String(sampler.inputs.negative[0]) : ''
  if (ref && nodes[ref] && nodes[ref].inputs && typeof nodes[ref].inputs.text === 'string') return ref
  return null
}

/** The bundled API template: quick generate does not depend on history. */
async function loadImageTemplate(models) {
  const wanted = models && typeof models === 'object' ? models : {}
  const sft = /sft/i.test(String(wanted.clip || '')) || /sft/i.test(String(wanted.unet || ''))
  const url = sft ? TEMPLATE_IMAGE_SFT_URL : TEMPLATE_IMAGE_URL
  try {
    const text = await readFile(fileURLToPath(url), 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Loader node types the template can carry, and the value each one reads. */
const MODEL_FIELDS_BASE = [
  // Base/fp8 checkpoints ride the plain loaders (official workflow structure).
  ['UNETLoader', 'unet_name', 'unet'],
  ['CLIPLoader', 'clip_name', 'clip'],
  ['VAELoader', 'vae_name', 'vae'],
  ['LoraLoaderModelOnly', 'lora_name', 'lora'],
]
const MODEL_FIELDS_SFT = [
  // SFT int8 checkpoints need the MOSS-specific loader nodes.
  ['MOSSImageUNETLoader', 'unet_name', 'unet'],
  ['MOSSImageCLIPLoader', 'clip_name', 'clip'],
  ['VAELoader', 'vae_name', 'vae'],
  ['LoraLoaderModelOnly', 'lora_name', 'lora'],
]
// The options listing uses the base set; both loaders read the same directories.
const MODEL_FIELDS = MODEL_FIELDS_BASE

let modelOptionsCache = null
let modelOptionsAt = 0
const MODEL_OPTIONS_TTL = 5 * 60 * 1000

/** First node of the given class_type in an API graph. */
function findNodeByType(graph, type) {
  for (const node of Object.values(graph || {})) {
    if (node && node.class_type === type) return node
  }
  return null
}

/** The empty-latent node (class name varies by model family). */
function findLatentNode(graph) {
  for (const node of Object.values(graph || {})) {
    if (!node || !node.inputs) continue
    if (
      typeof node.class_type === 'string' &&
      /Latent/i.test(node.class_type) &&
      typeof node.inputs.width === 'number' &&
      typeof node.inputs.height === 'number'
    ) {
      return node
    }
  }
  return null
}

/** Node id + body of the first node of the given class_type. */
function findNodeWithId(graph, type) {
  for (const [id, node] of Object.entries(graph || {})) {
    if (node && node.class_type === type) return { id, node }
  }
  return null
}

/** Up to four LoRA entries, accepting the legacy single-LoRA fields too. */
function normalizeLoras(models) {
  const raw = Array.isArray(models.loras) ? models.loras : []
  const list = raw
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim())
    .map((entry) => ({
      name: entry.name.trim(),
      strength: Number.isFinite(Number(entry.strength)) ? Number(entry.strength) : 1,
    }))
  if (list.length === 0 && typeof models.lora === 'string' && models.lora.trim()) {
    const strength = Number(models.loraStrength)
    return [{ name: models.lora.trim(), strength: Number.isFinite(strength) ? strength : 1 }]
  }
  return list.slice(0, 4)
}

/**
 * Rebuild the LoRA chain in place: UNET → lora… → the template's downstream.
 *
 * The template carries one LoRA node; its consumers are re-pointed at the new
 * chain tail (or straight at the UNET node when the list is empty).
 */
function rewriteLoraChain(graph, loras) {
  const unet = findNodeWithId(graph, 'UNETLoader') || findNodeWithId(graph, 'MOSSImageUNETLoader')
  if (!unet) return

  const loraIds = new Set()
  for (const [id, node] of Object.entries(graph)) {
    if (node && node.class_type === 'LoraLoaderModelOnly') loraIds.add(String(id))
  }
  // Every model consumer that pointed at the loader or an old LoRA is rewired to
  // the tail of the rebuilt chain (official templates carry no LoRA by default).
  const sources = new Set([String(unet.id), ...loraIds])
  const consumers = []
  for (const [id, node] of Object.entries(graph)) {
    if (!node || !node.inputs || loraIds.has(String(id))) continue
    for (const [field, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && sources.has(String(value[0]))) consumers.push({ id, field })
    }
  }
  for (const id of loraIds) delete graph[id]

  let prevId = unet.id
  loras.forEach((entry, index) => {
    const id = 'dsh-lora-' + (index + 1)
    graph[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: entry.name, strength_model: entry.strength, model: [prevId, 0] },
    }
    prevId = id
  })
  for (const consumer of consumers) {
    graph[consumer.id].inputs[consumer.field] = [prevId, 0]
  }
}

/**
 * ComfyUI describes a combo input in one of two shapes: `[["a","b"], meta]` for
 * the classic list, or `["COMBO", { options: ["a","b"] }]` in newer versions.
 */
function readComboList(entry) {
  if (!Array.isArray(entry)) return []
  if (Array.isArray(entry[0])) return entry[0].filter((value) => typeof value === 'string')
  const meta = entry[1]
  if (meta && Array.isArray(meta.options)) return meta.options.filter((value) => typeof value === 'string')
  if (entry[0] === 'COMBO') return []
  return entry.filter((value) => typeof value === 'string')
}

/** Installed model files per loader, straight from ComfyUI's node definitions. */
async function getModelOptions(baseUrl) {
  const now = Date.now()
  if (modelOptionsCache && now - modelOptionsAt < MODEL_OPTIONS_TTL) return modelOptionsCache
  const result = { unet: [], clip: [], vae: [], lora: [] }
  await Promise.all(
    MODEL_FIELDS.map(async ([type, field, key]) => {
      try {
        const info = await getJSON(`${baseUrl}/object_info/${type}`)
        const def = info && info[type]
        const required = (def && def.input && def.input.required) || {}
        result[key] = readComboList(required[field])
      } catch {
        // One loader lookup failing should not blank the others.
      }
    }),
  )
  modelOptionsCache = result
  modelOptionsAt = now
  return result
}

/**
 * Submit one MOSS layout JSON as a generation job.
 *
 * The canvas workflow is UI format and `/prompt` only accepts the API graph, so
 * the bundled API template is used first; the newest history entry that ran a
 * MOSSImage node is only the fallback for installs that predate the template.
 */
async function submitLayout(baseUrl, layout, models, width, height, negative) {
  const wantedModels = models && typeof models === 'object' ? models : {}
  const isSft =
    /sft/i.test(String(wantedModels.clip || '')) || /sft/i.test(String(wantedModels.unet || ''))
  const modelFields = isSft ? MODEL_FIELDS_SFT : MODEL_FIELDS_BASE
  let template = await loadImageTemplate(wantedModels)
  if (!template) {
    const history = await getJSON(`${baseUrl}/history?max_items=50`)
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
  }
  if (!template) throw new Error('没有可用的 MOSS 生成模板：先在 ComfyUI 里成功生成一张 MOSS 图')

  const graph = JSON.parse(JSON.stringify(template))
  const wanted = models && typeof models === 'object' ? models : {}

  // The user's picks override the template; anything unset keeps its value.
  for (const [type, field, key] of modelFields) {
    if (key === 'lora') continue
    const node = findNodeByType(graph, type)
    if (!node || !node.inputs) continue
    const value = typeof wanted[key] === 'string' ? wanted[key].trim() : ''
    if (value) node.inputs[field] = value
  }

  // LoRA is a chain: rebuilt from the user's list (0–4 entries, each with its own
  // strength). An empty list bypasses the template's LoRA node entirely.
  const loras = normalizeLoras(wanted)
  rewriteLoraChain(graph, loras)

  // Sampling knobs ride along with the model choice so the overlay can tune a
  // preview without touching the ComfyUI workflow.
  const sampling = wanted.sampling && typeof wanted.sampling === 'object' ? wanted.sampling : null
  if (sampling) {
    const samplerNode = findNodeByType(graph, 'KSampler')
    if (samplerNode && samplerNode.inputs) {
      const steps = Number(sampling.steps)
      if (Number.isFinite(steps)) samplerNode.inputs.steps = Math.max(1, Math.round(steps))
      const cfg = Number(sampling.cfg)
      if (Number.isFinite(cfg)) samplerNode.inputs.cfg = cfg
      if (typeof sampling.sampler === 'string' && sampling.sampler) {
        samplerNode.inputs.sampler_name = sampling.sampler
      }
      if (typeof sampling.scheduler === 'string' && sampling.scheduler) {
        samplerNode.inputs.scheduler = sampling.scheduler
      }
      const seed = Number(sampling.seed)
      if (Number.isFinite(seed)) {
        const value = Math.max(0, Math.floor(seed))
        if ('seed' in samplerNode.inputs) samplerNode.inputs.seed = value
        else if ('noise_seed' in samplerNode.inputs) samplerNode.inputs.noise_seed = value
      }
    }
  }

  // The layout's aspect comes from the canvas, so the latent must match it —
  // otherwise the picture comes out in the template's old resolution.
  const canvasWidth = Number(width)
  const canvasHeight = Number(height)
  if (Number.isFinite(canvasWidth) && Number.isFinite(canvasHeight) && canvasWidth > 0 && canvasHeight > 0) {
    const latentNode = findLatentNode(graph)
    if (latentNode && latentNode.inputs) {
      latentNode.inputs.width = Math.max(64, Math.round(canvasWidth))
      latentNode.inputs.height = Math.max(64, Math.round(canvasHeight))
    }
  }

  // Fail fast with a payload the UI can explain, instead of ComfyUI's node_errors.
  const options = await getModelOptions(baseUrl)
  const missing = []
  for (const [type, field, key] of modelFields) {
    if (key === 'lora') continue
    const node = findNodeByType(graph, type)
    if (!node || !node.inputs) continue
    const value = node.inputs[field]
    if (typeof value !== 'string' || !value) continue
    const list = options[key] || []
    if (list.length > 0 && list.indexOf(value) < 0) missing.push({ kind: key, file: value })
  }
  const loraList = options.lora || []
  for (const entry of loras) {
    if (loraList.length > 0 && loraList.indexOf(entry.name) < 0) {
      missing.push({ kind: 'lora', file: entry.name })
    }
  }
  if (missing.length > 0) return { ok: false, code: 'missing-models', missing, available: options }

  const positiveId = findPositiveTextNode(graph)
  if (!positiveId) throw new Error('模板里找不到正向提示词节点')
  graph[positiveId].inputs.text = JSON.stringify(layout)

  // An explicit negative prompt replaces whatever the template carried; blank
  // keeps the template's own negative untouched.
  if (typeof negative === 'string' && negative.trim() !== '') {
    const negativeId = findNegativeTextNode(graph)
    if (negativeId) graph[negativeId].inputs.text = negative.trim()
  }

  // ComfyUI routes execution/progress events to the client_id that submitted the
  // prompt. The Host's WebSocket subscribes with this same id, so keep it fixed.
  const clientId = 'dsh-comfy-canvas'
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

// ------------------------------------------------------------ prompt polish

const POLISH_SKILL_PATH = join(homedir(), '.dsh', 'skills', 'moss-image-prompt-enhancer', 'SKILL.md')
let polishSkillCache = null

async function loadPolishSkill() {
  if (polishSkillCache !== null) return polishSkillCache
  try {
    polishSkillCache = await readFile(POLISH_SKILL_PATH, 'utf8')
  } catch {
    polishSkillCache = ''
  }
  return polishSkillCache
}

/** Reformulate box copy with the user's instruction, carrying the skill's rules. */
async function runPolish(ctx, body, onEvent) {
  const emit = typeof onEvent === 'function' ? onEvent : () => {}
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  const mode = body.mode === 'board' ? 'board' : 'single'
  const targets = Array.isArray(body.targets) ? body.targets : []
  const summary = typeof body.summary === 'string' ? body.summary : ''
  const history = Array.isArray(body.history) ? body.history : []
  const effort = typeof body.effort === 'string' ? body.effort.trim() : ''
  if (!instruction) throw new Error('缺少润色要求')
  if (targets.length === 0) throw new Error('没有可润色的框')
  const llm = ctx && ctx.llm
  if (!llm || typeof llm.stream !== 'function') throw new Error('LLM 服务不可用')
  const selection =
    ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function'
      ? ctx.agentDefaultModel.currentSelection()
      : null
  const provider = selection && selection.provider
  const model = selection && selection.model
  if (!provider || !model) throw new Error('没有可用的默认模型')

  const skill = await loadPolishSkill()
  const system = [
    '你是 MOSS-Image 的提示词润色助手，负责把用户的画框描述润色得更好。',
    '',
    '【工作纪律】',
    '- 严格遵循用户当前的润色要求与对话上下文，按用户给定的方向改写。',
    '- 不对内容做道德评判、说教、劝退或免责声明，不因题材或风格拒绝润色请求。',
    '- 如实输出润色结果，不添加与画面无关的评论或解释。',
    '- 保持画框的数量、编号和类型不变；不要编造新的画框，也不要删除画框。',
    '- 只输出要求的最终内容，不要附带前言、说明或建议。',
    '- 单框模式只输出 JSON：{"text":"<润色后的描述>"}；整板模式只输出 JSON：{"items":[{"id":"<原 id>","text":"<润色后描述>"}]}。',
    '- 不要输出标题、中英对照、多个版本或「如果你需要…」这类话。',
    '',
    skill,
  ].join('\n')

  const lines = []
  if (history.length > 0) {
    lines.push('【之前的对话】')
    for (const turn of history) {
      const role = turn && turn.role === 'assistant' ? '助手' : '用户'
      const text = turn && typeof turn.text === 'string' ? turn.text.trim() : ''
      if (text) lines.push(role + '：' + text)
    }
    lines.push('')
  }
  lines.push('【本次润色要求】' + instruction)
  if (mode === 'board') {
    if (summary.trim()) lines.push('【整图描述】' + summary.trim())
    lines.push('【画框列表】')
    targets.forEach((target, index) => {
      lines.push(
        String(index + 1) +
          '. id=' +
          String(target.id) +
          ' 类型=' +
          (target.kind === 'text' ? '文字' : '画面元素') +
          ' 描述=' +
          String(target.text || ''),
      )
    })
    lines.push('')
    lines.push('请润色每个框的描述（保持 id 不变），只输出 JSON：{"items":[{"id":"<原 id>","text":"<润色后描述>"}]}')
  } else {
    lines.push('【待润色描述】' + String(targets[0].text || ''))
  }

  const messages = [{ role: 'user', content: [{ type: 'text', text: lines.join('\n') }] }]
  const options = { provider, model, system, messages }
  // Only forward an effort the exact model advertises: providers reject unknown
  // efforts outright (UNSUPPORTED_REASONING_EFFORT). Supported tiers: off/low/high/max.
  if (effort === 'off' || effort === 'low' || effort === 'high' || effort === 'max') {
    try {
      const info = await ctx.llm.resolveModelInfo(provider, model)
      const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : []
      const ids = efforts.map((entry) => (entry && entry.id) || entry)
      if (ids.length === 0 || ids.indexOf(effort) >= 0) options.reasoningEffort = effort
    } catch {
      // Cannot inspect the model: leave the effort unset rather than fail the call.
    }
  }
  let text = ''
  let finishReason = ''
  let usage = null
  for await (const chunk of llm.stream(options)) {
    if (!chunk) continue
    if (chunk.type === 'text-delta') {
      text += chunk.text
      emit({ type: 'delta', text: chunk.text })
    } else if (chunk.type === 'reasoning-delta') {
      emit({ type: 'reasoning', text: chunk.text })
    } else if (chunk.type === 'usage') {
      usage = chunk.usage
    } else if (chunk.type === 'finish') {
      finishReason = chunk.reason
    }
  }
  if (!text.trim()) {
    let detail = ''
    if (finishReason && finishReason !== 'stop') {
      detail = typeof finishReason === 'string' ? finishReason : JSON.stringify(finishReason).slice(0, 200)
    }
    throw new Error('模型没有返回内容' + (detail ? '（' + detail + '）' : ''))
  }
  emit({ type: 'done', usage: usage || null, skillLength: skill.length })
  return { ok: true, text: text.trim(), usage: usage || null, skillLength: skill.length }
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

    // Re-install the bundled canvas workflows (backs the current ones up first).
    if (pathname === `${PREFIX}/reset-templates`) {
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const dir = await dirOf()
        await installTemplates(dir, true)
        return send(200, { ok: true })
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
        // The bundled base/sft canvas workflows stay pinned to the top.
        const priority = (name) => (name === TEMPLATE_BASE_NAME ? 2 : name === TEMPLATE_SFT_NAME ? 1 : 0)
        files.sort((left, right) => priority(right.name) - priority(left.name) || right.mtime - left.mtime)
        return send(200, { ok: true, dir, files })
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/model-options`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const options = await getModelOptions(baseUrl)
        return send(200, Object.assign({ ok: true }, options))
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
        return send(200, await submitLayout(baseUrl, body.layout, body.models, body.width, body.height, body.negative))
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

    // Remote image generation (OpenAI-compatible /images/generations), proxied by
    // the host so the browser never talks to the vendor directly (no CORS, the key
    // never appears in the page's own requests).
    if (pathname === `${PREFIX}/remote-image`) {
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const body = JSON.parse((await readBody(req)) || '{}')
        const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
        const key = typeof body.key === 'string' ? body.key.trim() : ''
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-image-1'
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
        const size = typeof body.size === 'string' && body.size.trim() ? body.size.trim() : '1024x1024'
        if (!endpoint || !key || !prompt) {
          return send(400, { ok: false, error: '需要端点、API Key 和 prompt' })
        }
        const mode = body.mode === 'edits' ? 'edits' : 'generations'
        const imageData = typeof body.image === 'string' ? body.image : ''
        let upstream
        if (mode === 'edits') {
          if (!imageData) return send(400, { ok: false, error: '编辑模式需要参考图' })
          const match = /^data:([^;]+);base64,(.+)$/.exec(imageData)
          if (!match) return send(400, { ok: false, error: '参考图格式不对（需要 data URL）' })
          const form = new FormData()
          form.append('model', model)
          form.append('n', '1')
          form.append('response_format', 'b64_json')
          form.append('prompt', prompt)
          form.append('image', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), 'reference.png')
          const url = /\/images\/edits?$/.test(endpoint) ? endpoint : endpoint.replace(/\/+$/, '') + '/images/edits'
          upstream = await fetch(url, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + key },
            body: form,
            signal: AbortSignal.timeout(300000),
          })
        } else {
          const url = /\/images\//.test(endpoint) ? endpoint : endpoint.replace(/\/+$/, '') + '/images/generations'
          upstream = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
            body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' }),
            signal: AbortSignal.timeout(300000),
          })
        }
        const text = await upstream.text()
        if (!upstream.ok) {
          return send(502, { ok: false, error: 'HTTP ' + upstream.status + ' ' + text.slice(0, 300) })
        }
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          return send(502, { ok: false, error: '响应不是 JSON：' + text.slice(0, 200) })
        }
        const item = (json && json.data && json.data[0]) || json
        const b64 = item && typeof item.b64_json === 'string' ? item.b64_json : null
        const imageUrl = item && typeof item.url === 'string' ? item.url : null
        if (!b64 && !imageUrl) return send(502, { ok: false, error: '响应里没有图片数据' })
        return send(200, { ok: true, model, b64, url: imageUrl })
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/polish`) {
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      let body = null
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch {
        return send(400, { ok: false, error: 'invalid JSON body' })
      }
      // Stream progress as NDJSON: the panel shows the text as the model writes
      // it instead of waiting for the whole reply.
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      })
      const write = (event) => {
        try {
          res.write(JSON.stringify(event) + '\n')
        } catch {
          // Client went away.
        }
      }
      try {
        await runPolish(ctx, body, write)
      } catch (error) {
        write({ type: 'error', error: String((error && error.message) || error) })
      } finally {
        res.end()
      }
      return
    }

    return send(404, { ok: false, error: 'not found' })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }))
}
