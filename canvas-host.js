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

const DEFAULT_URL = 'http://127.0.0.1:8188'
const TIMEOUT_MS = 4000
const PREFIX = '/plugin/comfy-canvas'
const MAX_BODY = 16 * 1024 * 1024

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
