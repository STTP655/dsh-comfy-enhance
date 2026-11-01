/**
 * Host half of the merged ComfyUI enhance bundle.
 *
 * The browser never talks to ComfyUI directly: the Web GUI may be opened from a
 * different machine (or over Tailscale), where 127.0.0.1 is the *viewer's*
 * loopback, not the engine's. This half proxies the ComfyUI HTTP API on the
 * harness origin so the sidebar sees the engine that actually runs the jobs.
 *
 * The bounding-box canvas routes live in `./canvas-host.js` and are mounted from
 * the same apply, under their own `/plugin/comfy-canvas` prefix.
 */

import { apply as applyCanvasHost } from './canvas-host.js'

const DEFAULT_URL = 'http://127.0.0.1:8188'
const UPSTREAM_TIMEOUT_MS = 3000
const CACHE_MS = 700
const ALBUM_LIMIT = 24
const ALBUM_CACHE_MS = 2000
const PREFIX = '/plugin/comfy-status'

export const inject = ['webServer']

/** Fetch JSON with a hard timeout; surfaces HTTP and network failures alike. */
async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

/** Pick the discrete accelerator, not an integrated part with a larger pool. */
function pickDevice(devices) {
  const list = Array.isArray(devices) ? devices : []
  const cuda = list.find((d) => d && d.type === 'cuda')
  if (cuda) return cuda
  return list.reduce(
    (best, d) => ((d && d.vram_total) || 0) > ((best && best.vram_total) || 0) ? d : best,
    list[0],
  )
}

/** Fold one history entry's messages into start/end timestamps and its outputs. */
function summarizeEntry(promptId, entry) {
  const messages = (entry && entry.status && entry.status.messages) || []
  const stamp = (name) => {
    const hit = messages.find((m) => Array.isArray(m) && m[0] === name)
    return hit && hit[1] ? hit[1].timestamp : undefined
  }
  const startedAt = stamp('execution_start')
  const endedAt = stamp('execution_success') ?? stamp('execution_error')
  const images = []
  const outputs = (entry && entry.outputs) || {}
  for (const node of Object.values(outputs)) {
    const list = (node && node.images) || []
    for (const img of list) {
      if (!img || !img.filename) continue
      images.push({
        filename: img.filename,
        subfolder: img.subfolder || '',
        type: img.type || 'output',
      })
    }
  }
  return {
    promptId,
    status: (entry && entry.status && entry.status.status_str) || 'unknown',
    completed: Boolean(entry && entry.status && entry.status.completed),
    startedAt: startedAt || 0,
    endedAt: endedAt || 0,
    durationMs: startedAt && endedAt ? Math.max(0, endedAt - startedAt) : 0,
    images,
  }
}

/** Newest completed-or-failed prompt in the history map. */
function latestHistory(history) {
  const entries = Object.entries(history || {}).map(([id, e]) => summarizeEntry(id, e))
  if (entries.length === 0) return null
  entries.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
  return entries[0]
}

async function buildSnapshot(baseUrl) {
  const [stats, queue, history] = await Promise.all([
    getJSON(`${baseUrl}/system_stats`),
    getJSON(`${baseUrl}/queue`),
    getJSON(`${baseUrl}/history?max_items=8`),
  ])

  const device = pickDevice(stats && stats.devices)
  const running = Array.isArray(queue && queue.queue_running) ? queue.queue_running : []
  const pending = Array.isArray(queue && queue.queue_pending) ? queue.queue_pending : []
  const system = (stats && stats.system) || {}

  return {
    up: true,
    url: baseUrl,
    at: Date.now(),
    version: system.comfyui_version || '',
    python: system.python_version || '',
    torch: system.pytorch_version || '',
    engine: {
      os: system.os || '',
      ramTotal: system.ram_total || 0,
      ramFree: system.ram_free || 0,
    },
    device: device
      ? {
          name: device.name || '',
          type: device.type || '',
          vramTotal: device.vram_total || 0,
          vramFree: device.vram_free || 0,
        }
      : null,
    queue: {
      running: running.length,
      pending: pending.length,
      runningIds: running.map((item) => (Array.isArray(item) ? String(item[1] || '') : '')).filter(Boolean),
      pendingIds: pending.map((item) => (Array.isArray(item) ? String(item[1] || '') : '')).filter(Boolean),
    },
    last: latestHistory(history),
  }
}

/** Model-file inputs, mapped to the role printed beside them in the album. */
const MODEL_INPUTS = {
  unet_name: 'UNET',
  ckpt_name: 'Checkpoint',
  clip_name: 'CLIP',
  vae_name: 'VAE',
  lora_name: 'LoRA',
  control_net_name: 'ControlNet',
  style_model_name: 'Style',
  model_name: 'Model',
}

/** Read a wiring reference such as `["4", 0]` down to its node id. */
function nodeRef(input) {
  if (!Array.isArray(input) || input.length === 0) return null
  const id = input[0]
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/**
 * Make one CLIPTextEncode `text` readable.
 *
 * Structured prompts (MOSS-Image writes JSON: `summary.caption` plus per-object
 * `items`/`bbox`) would be unreadable pasted raw, so the caption becomes the
 * body and the original string is kept for an explicit "raw JSON" disclosure.
 */
function readPromptText(raw) {
  if (typeof raw !== 'string') {
    if (raw == null) return null
    const json = JSON.stringify(raw)
    return { text: json, structured: true, raw: json }
  }
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { text: raw, structured: false, raw }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      const caption = parsed.summary && typeof parsed.summary.caption === 'string'
        ? parsed.summary.caption.trim()
        : ''
      return { text: caption || raw, structured: true, raw }
    }
  } catch {
    // Text that merely begins with a brace stays plain text.
  }
  return { text: raw, structured: false, raw }
}

/** Pull models, sampler settings, both prompts and the sampling size out of one API prompt. */
function summarizeWorkflow(nodes) {
  const models = []
  const seen = new Set()
  let samplerNode = null
  let latent = null

  for (const [id, node] of Object.entries(nodes || {})) {
    if (!node || typeof node !== 'object') continue
    const inputs = node.inputs || {}
    for (const [key, role] of Object.entries(MODEL_INPUTS)) {
      const value = inputs[key]
      if (typeof value !== 'string' || value.length === 0) continue
      const marker = `${role}\u0000${value}`
      if (seen.has(marker)) continue
      seen.add(marker)
      models.push({ role, name: value })
    }
    if (samplerNode === null && 'steps' in inputs && ('cfg' in inputs || 'sampler_name' in inputs)) {
      samplerNode = { id, inputs }
    }
    if (latent === null && typeof inputs.width === 'number' && typeof inputs.height === 'number') {
      latent = { width: inputs.width, height: inputs.height }
    }
  }

  const result = { models, sampler: null, positive: null, negative: null, size: latent }
  if (samplerNode === null) return result

  const inputs = samplerNode.inputs
  result.sampler = {
    name: typeof inputs.sampler_name === 'string' ? inputs.sampler_name : '',
    scheduler: typeof inputs.scheduler === 'string' ? inputs.scheduler : '',
    steps: typeof inputs.steps === 'number' ? inputs.steps : null,
    cfg: typeof inputs.cfg === 'number' ? inputs.cfg : null,
    seed: typeof inputs.seed === 'number'
      ? inputs.seed
      : (typeof inputs.noise_seed === 'number' ? inputs.noise_seed : null),
    denoise: typeof inputs.denoise === 'number' ? inputs.denoise : null,
  }

  const readSide = (ref) => {
    const target = nodeRef(ref)
    const node = target !== null ? nodes[target] : undefined
    return readPromptText(node && node.inputs ? node.inputs.text : undefined)
  }
  result.positive = readSide(inputs.positive)
  result.negative = readSide(inputs.negative)

  // Graphs may route conditioning through intermediary nodes; fall back to the
  // first two text encoders so the album never shows an empty prompt block.
  if (result.positive === null || result.negative === null) {
    const texts = []
    for (const node of Object.values(nodes || {})) {
      const text = node && node.inputs ? node.inputs.text : undefined
      if (typeof text === 'string' && text.trim().length > 0) texts.push(readPromptText(text))
    }
    if (result.positive === null && texts.length > 0) result.positive = texts[0]
    if (result.negative === null && texts.length > 1) result.negative = texts[1]
  }

  return result
}

/** One history entry as an album card: its outputs plus everything the detail panel shows. */
function albumItem(promptId, entry) {
  const summary = summarizeEntry(promptId, entry)
  const nodes = Array.isArray(entry && entry.prompt) ? entry.prompt[2] : entry && entry.prompt
  const workflow = summarizeWorkflow(nodes)

  const images = []
  const outputs = (entry && entry.outputs) || {}
  for (const node of Object.values(outputs)) {
    for (const img of (node && node.images) || []) {
      if (!img || !img.filename) continue
      const meta = img.metadata || {}
      const subfolder = img.subfolder || ''
      const type = img.type || 'output'
      images.push({
        filename: img.filename,
        subfolder,
        type,
        width: typeof meta.width === 'number' ? meta.width : null,
        height: typeof meta.height === 'number' ? meta.height : null,
        url: `${PREFIX}/view?filename=${encodeURIComponent(img.filename)}`
          + `&subfolder=${encodeURIComponent(subfolder)}`
          + `&type=${encodeURIComponent(type)}`,
      })
    }
  }

  return { id: promptId, ...summary, images, meta: workflow }
}

/** Newest-first gallery of history entries that produced an image, plus whatever is running now. */
async function buildAlbum(baseUrl) {
  const [history, queue] = await Promise.all([
    getJSON(`${baseUrl}/history?max_items=${ALBUM_LIMIT}`),
    getJSON(`${baseUrl}/queue`).catch(() => null),
  ])

  const items = Object.entries(history || {})
    .map(([id, entry]) => albumItem(id, entry))
    .filter((item) => item.images.length > 0)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))

  // A running prompt is queued as [number, prompt_id, prompt, extra_data, outputs];
  // the same node graph the history carries, so the same extraction applies.
  const running = []
  for (const entry of Array.isArray(queue && queue.queue_running) ? queue.queue_running : []) {
    if (!Array.isArray(entry) || entry.length < 3) continue
    const promptId = String(entry[1] || '')
    running.push({
      id: promptId,
      promptId,
      startedAt: Number(entry[0]) || 0,
      meta: summarizeWorkflow(entry[2]),
    })
  }

  return { up: true, at: Date.now(), count: items.length, items, running }
}

/** Serve the proxy route and the aggregated snapshot. */
function createHandler(baseUrl) {
  let cache = { at: 0, value: null }
  let inflight = null

  async function snapshot() {
    const now = Date.now()
    if (cache.value && now - cache.at < CACHE_MS) return cache.value
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const value = await buildSnapshot(baseUrl)
        cache = { at: Date.now(), value }
        return value
      } catch (error) {
        const value = {
          up: false,
          url: baseUrl,
          at: Date.now(),
          error: String((error && error.message) || error),
          queue: { running: 0, pending: 0, runningIds: [], pendingIds: [] },
          device: null,
          last: null,
        }
        // Cache the failure briefly too: a wedged engine must not be hammered
        // once per browser poll.
        cache = { at: Date.now(), value }
        return value
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  let albumCache = { at: 0, value: null }
  let albumInflight = null

  async function album() {
    if (albumCache.value && Date.now() - albumCache.at < ALBUM_CACHE_MS) return albumCache.value
    if (albumInflight) return albumInflight
    albumInflight = (async () => {
      try {
        const value = await buildAlbum(baseUrl)
        albumCache = { at: Date.now(), value }
        return value
      } catch (error) {
        const value = {
          up: false,
          at: Date.now(),
          error: String((error && error.message) || error),
          count: 0,
          items: [],
        }
        albumCache = { at: Date.now(), value }
        return value
      } finally {
        albumInflight = null
      }
    })()
    return albumInflight
  }

  /** Stream one ComfyUI output image through the harness origin. */
  async function proxyImage(req, res) {
    const query = new URL(req.url || '/', 'http://localhost').searchParams
    const filename = query.get('filename')
    if (!filename) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('filename is required')
      return
    }
    const target = new URL(`${baseUrl}/view`)
    for (const key of ['filename', 'subfolder', 'type']) {
      const value = query.get(key)
      if (value !== null) target.searchParams.set(key, value)
    }
    try {
      const upstream = await fetch(target, { signal: AbortSignal.timeout(20000) })
      if (!upstream.ok) {
        res.writeHead(upstream.status, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`ComfyUI responded ${upstream.status}`)
        return
      }
      const body = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(200, {
        'content-type': upstream.headers.get('content-type') || 'image/png',
        'content-length': String(body.length),
        // Output files are immutable once written, so the browser may hold them.
        'cache-control': 'private, max-age=600',
      })
      res.end(body)
    } catch (error) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String((error && error.message) || error))
    }
  }

  return async (req, res) => {
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

    if (pathname === `${PREFIX}/snapshot`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      const value = await snapshot()
      return send(200, value)
    }

    if (pathname === `${PREFIX}/album`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      const value = await album()
      return send(200, value)
    }

    if (pathname === `${PREFIX}/view`) return proxyImage(req, res)

    return send(404, { ok: false, error: 'not found' })
  }
}

export function apply(ctx, config = {}) {
  const configured = config && typeof config.comfyUrl === 'string' ? config.comfyUrl.trim() : ''
  const envUrl = typeof process !== 'undefined' && process.env ? process.env.DSH_COMFY_URL : ''
  const baseUrl = String(configured || envUrl || DEFAULT_URL).replace(/\/+$/, '')

  const handler = createHandler(baseUrl)

  ctx.effect(() =>
    ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }),
  )

  // The canvas module ships in the same bundle and mounts its own routes.
  applyCanvasHost(ctx, config)
}
