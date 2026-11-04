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
/** Bundled API graph for quick generate (models + sampler, positive prompt empty). */
const TEMPLATE_IMAGE_URL = new URL('./templates/moss-image-api.json', import.meta.url)

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
async function loadImageTemplate() {
  try {
    const text = await readFile(fileURLToPath(TEMPLATE_IMAGE_URL), 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Loader node types the template can carry, and the value each one reads. */
const MODEL_FIELDS = [
  ['MOSSImageUNETLoader', 'unet_name', 'unet'],
  ['MOSSImageCLIPLoader', 'clip_name', 'clip'],
  ['VAELoader', 'vae_name', 'vae'],
  ['LoraLoaderModelOnly', 'lora_name', 'lora'],
]

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
  const unet = findNodeWithId(graph, 'MOSSImageUNETLoader')
  if (!unet) return

  let loraId = null
  for (const [id, node] of Object.entries(graph)) {
    if (node && node.class_type === 'LoraLoaderModelOnly') {
      loraId = id
      break
    }
  }
  if (!loraId) return

  const consumers = []
  for (const [id, node] of Object.entries(graph)) {
    if (!node || !node.inputs || id === loraId) continue
    for (const [field, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && String(value[0]) === String(loraId)) consumers.push([id, field])
    }
  }
  delete graph[loraId]

  let prevId = unet.id
  loras.forEach((entry, index) => {
    const id = 'dsh-lora-' + (index + 1)
    graph[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: entry.name, strength_model: entry.strength, model: [prevId, 0] },
    }
    prevId = id
  })

  for (const [consumerId, field] of consumers) {
    graph[consumerId].inputs[field] = [prevId, 0]
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
  let template = await loadImageTemplate()
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
  for (const [type, field, key] of MODEL_FIELDS) {
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
  for (const [type, field, key] of MODEL_FIELDS) {
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

    return send(404, { ok: false, error: 'not found' })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }))
}
