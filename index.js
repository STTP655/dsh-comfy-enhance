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
import { dirname, join } from 'node:path'
import { readdir, stat, readFile } from 'node:fs/promises'

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

/** ComfyUI's own output directory, derived from the running instance's argv. */
async function resolveOutputDir(baseUrl) {
  const stats = await getJSON(`${baseUrl}/system_stats`)
  const argv = (stats && stats.system && stats.system.argv) || []
  const mainPy = argv.find((entry) => typeof entry === 'string' && /main\.py$/i.test(entry))
  if (!mainPy) throw new Error('cannot derive the ComfyUI root from system_stats.argv')
  return join(dirname(mainPy), 'output')
}

/** Text chunks of a PNG (ComfyUI stores the API prompt in `tEXt:prompt`). */
function readPngText(buffer) {
  const result = {}
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    if (type === 'tEXt') {
      const data = buffer.subarray(dataStart, dataStart + length)
      const separator = data.indexOf(0)
      if (separator > 0) {
        const key = data.toString('latin1', 0, separator)
        const value = data.toString('latin1', separator + 1)
        result[key] = value
      }
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4
  }
  return result
}

/** Summarized generation parameters of one output file, when it carries them. */
async function readOutputMeta(dir, filename) {
  const buffer = await readFile(join(dir, filename))
  const text = readPngText(buffer)
  let prompt = null
  if (typeof text.prompt === 'string') {
    try {
      prompt = JSON.parse(text.prompt)
    } catch {
      prompt = null
    }
  }
  if (!prompt) return null
  return summarizeWorkflow(prompt)
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
      const entry = { role, name: value }
      // LoRA strength is what makes a weight meaningful: 0.8 and 0.3 are
      // different pictures. Loaders use strength_model / strength_clip, and some
      // custom nodes a single strength.
      if (role === 'LoRA') {
        const modelStrength = typeof inputs.strength_model === 'number'
          ? inputs.strength_model
          : (typeof inputs.strength === 'number' ? inputs.strength : null)
        const clipStrength = typeof inputs.strength_clip === 'number' ? inputs.strength_clip : null
        if (modelStrength !== null) entry.strength = modelStrength
        if (clipStrength !== null && clipStrength !== modelStrength) entry.strengthClip = clipStrength
      }
      models.push(entry)
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

/**
 * Resolve the sampler and the two text-encoder nodes in an API prompt graph.
 *
 * Regenerating edits text in place, so the node ids matter. Graphs that route
 * conditioning through intermediate nodes fall back to the first two text
 * encoders, matching what summarizeWorkflow reports.
 */
function resolvePromptNodes(nodes) {
  let samplerId = null
  for (const [id, node] of Object.entries(nodes || {})) {
    const inputs = node && node.inputs
    if (!inputs) continue
    if ('steps' in inputs && ('cfg' in inputs || 'sampler_name' in inputs)) {
      samplerId = id
      break
    }
  }
  const sampler = samplerId !== null ? nodes[samplerId] : null
  const textNodes = []
  for (const [id, node] of Object.entries(nodes || {})) {
    if (node && node.inputs && typeof node.inputs.text === 'string') textNodes.push(id)
  }
  const isText = (id) =>
    id !== null && id !== undefined && nodes[id] && nodes[id].inputs && typeof nodes[id].inputs.text === 'string'
  const positiveRef = sampler ? nodeRef(sampler.inputs.positive) : null
  const negativeRef = sampler ? nodeRef(sampler.inputs.negative) : null
  const positiveId = isText(positiveRef) ? positiveRef : (textNodes[0] || null)
  const negativeId = isText(negativeRef) ? negativeRef : (textNodes.find((id) => id !== positiveId) || null)
  return { samplerId, positiveId, negativeId }
}

/**
 * Re-submit one history prompt with edited prompts, optionally on a fresh seed.
 *
 * The graph is cloned before touching it: the history entry is shared with the
 * album cache, and mutating it would corrupt every later read of that record.
 */
async function regeneratePrompt(baseUrl, body) {
  const promptId = body && typeof body.promptId === 'string' ? body.promptId : ''
  if (!promptId) throw new Error('缺少 promptId')

  const res = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`ComfyUI 返回 ${res.status}`)
  const history = await res.json()
  const entry = history && history[promptId]
  if (!entry) throw new Error('这条记录已不在 ComfyUI 历史里，可能被清理了')

  const source = Array.isArray(entry.prompt) ? entry.prompt[2] : entry.prompt
  if (!source || typeof source !== 'object') throw new Error('无法读取原始工作流')

  const graph = JSON.parse(JSON.stringify(source))
  const target = resolvePromptNodes(graph)
  if (!target.positiveId) throw new Error('这套工作流里找不到文本编码节点')

  if (typeof body.positive === 'string') graph[target.positiveId].inputs.text = body.positive
  if (typeof body.negative === 'string' && target.negativeId) graph[target.negativeId].inputs.text = body.negative

  if (target.samplerId !== null) {
    const inputs = graph[target.samplerId].inputs
    // Only write keys the node actually has: KSampler uses sampler_name/steps,
    // other sampler nodes may expose a different field set.
    const write = (key, value) => {
      if (key in inputs) inputs[key] = value
    }
    if (typeof body.sampler === 'string' && body.sampler) write('sampler_name', body.sampler)
    if (typeof body.scheduler === 'string' && body.scheduler) write('scheduler', body.scheduler)
    if (typeof body.steps === 'number' && Number.isFinite(body.steps)) {
      write('steps', Math.max(1, Math.round(body.steps)))
    }
    if (typeof body.cfg === 'number' && Number.isFinite(body.cfg)) write('cfg', body.cfg)
    if (body.seed === 'random') {
      const next = Math.floor(Math.random() * 1125899906842624)
      if ('seed' in inputs) inputs.seed = next
      else if ('noise_seed' in inputs) inputs.noise_seed = next
    }
  }

  const clientId = 'dsh-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  const submit = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
    signal: AbortSignal.timeout(15000),
  })
  const payload = await submit.json().catch(() => null)
  if (!submit.ok) {
    const detail = payload && payload.error
      ? (typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error))
      : `HTTP ${submit.status}`
    throw new Error('ComfyUI 拒绝了这个任务：' + detail)
  }
  return {
    ok: true,
    promptId: (payload && payload.prompt_id) || '',
    number: payload && payload.number,
  }
}

/**
 * The sampler and scheduler choices ComfyUI advertises for its KSampler node.
 *
 * Reading them from the engine instead of hardcoding means a custom node pack
 * (or a newer ComfyUI) never offers a value the server would reject.
 */
async function samplerOptions(baseUrl) {
  const info = await getJSON(`${baseUrl}/object_info/KSampler`)
  const required = (info && info.KSampler && info.KSampler.input && info.KSampler.input.required) || {}
  const list = (key) =>
    Array.isArray(required[key]) && Array.isArray(required[key][0]) ? required[key][0].map(String) : []
  return { samplers: list('sampler_name'), schedulers: list('scheduler') }
}

/** Read and parse a small JSON request body. */
function readJson(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2000000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * Stop one job: drop it from the pending queue, or interrupt the running one.
 *
 * /interrupt has no job argument — it stops whatever is executing — so it is
 * only called when the queue says the running job is the one being cancelled.
 */
async function cancelPrompt(baseUrl, body) {
  const promptId = body && typeof body.promptId === 'string' ? body.promptId : ''
  if (!promptId) throw new Error('缺少 promptId')

  const queue = await getJSON(`${baseUrl}/queue`)
  const ids = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) => (Array.isArray(item) ? String(item[1] || '') : ''))
      .filter(Boolean)
  const running = ids(queue && queue.queue_running)
  const pending = ids(queue && queue.queue_pending)

  const removed = []
  if (pending.indexOf(promptId) >= 0) {
    const res = await fetch(`${baseUrl}/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`删除排队任务失败：HTTP ${res.status}`)
    removed.push('pending')
  }
  if (running.indexOf(promptId) >= 0) {
    const res = await fetch(`${baseUrl}/interrupt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`中断任务失败：HTTP ${res.status}`)
    removed.push('running')
  }
  return { ok: true, removed }
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

  let optionsCache = { at: 0, value: null }
  const OPTIONS_CACHE_MS = 300000

  async function options() {
    if (optionsCache.value && Date.now() - optionsCache.at < OPTIONS_CACHE_MS) return optionsCache.value
    const value = await samplerOptions(baseUrl)
    optionsCache = { at: Date.now(), value }
    return value
  }

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
    // `preview` lets ComfyUI render a downscaled variant (webp) for grids; without
    // it the browser decodes the full-size PNG for every thumbnail.
    for (const key of ['filename', 'subfolder', 'type', 'preview']) {
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

  let cachedOutputDir = null
  const outputDir = async () => {
    if (cachedOutputDir !== null) return cachedOutputDir
    cachedOutputDir = await resolveOutputDir(baseUrl)
    return cachedOutputDir
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

    if (pathname === `${PREFIX}/regenerate`) {
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      const body = await readJson(req)
      try {
        const value = await regeneratePrompt(baseUrl, body)
        // The next album read must see the new job, not the cached list.
        albumCache = { at: 0, value: null }
        return send(200, value)
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/cancel`) {
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
      const body = await readJson(req)
      try {
        const value = await cancelPrompt(baseUrl, body)
        albumCache = { at: 0, value: null }
        return send(200, value)
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/sampler-options`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      try {
        return send(200, await options())
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    if (pathname === `${PREFIX}/view`) return proxyImage(req, res)

    // The engine's own output folder, so the workspace album can browse files
    // ComfyUI wrote directly instead of only what this plugin tracked.
    if (pathname === `${PREFIX}/outputs`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const dir = await outputDir()
        const entries = await readdir(dir, { withFileTypes: true })
        const files = []
        for (const entry of entries) {
          if (!entry.isFile() || !/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) continue
          let info = null
          try {
            info = await stat(join(dir, entry.name))
          } catch {
            continue
          }
          files.push({
            name: entry.name,
            mtime: info.mtimeMs,
            url: `${PREFIX}/view?filename=${encodeURIComponent(entry.name)}&type=output`,
          })
        }
        files.sort((left, right) => right.mtime - left.mtime)
        return send(200, { ok: true, dir, files: files.slice(0, 300) })
      } catch (error) {
        return send(502, { ok: false, error: String((error && error.message) || error) })
      }
    }

    // Generation parameters embedded in one output PNG, for the workspace preview.
    if (pathname === `${PREFIX}/output-meta`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const query = new URL(req.url || '/', 'http://localhost').searchParams
        const filename = query.get('filename') || ''
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('invalid filename')
        }
        const dir = await outputDir()
        const meta = await readOutputMeta(dir, filename)
        return send(200, { ok: true, meta })
      } catch (error) {
        return send(404, { ok: false, error: String((error && error.message) || error) })
      }
    }

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
