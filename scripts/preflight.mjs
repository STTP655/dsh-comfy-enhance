#!/usr/bin/env node
/**
 * Parse gate for files that go live the moment they are saved.
 *
 * The running DSH loads this bundle straight from its directory (the profile
 * points here with a junction, and the browser gets `client.js` as-is), so a
 * half-written file is served before any test could catch it. This script only
 * asks whether each file can be parsed at all — the cheapest useful gate.
 *
 *   node scripts/preflight.mjs            # this package
 *   node scripts/preflight.mjs <dir>      # another copy, e.g. a staged one
 *
 * Exit code 0 means every file parses. Optional commit hook:
 *   node scripts/preflight.mjs || exit 1
 */
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2] || join(here, '..'))

/** Files the runtime imports or serves directly. */
const SOURCES = ['index.js', 'canvas-host.js', 'client.js']

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Ask node to parse one file without running it.
 *
 * Stdio is deliberately not piped: a confined environment cannot open the pipes
 * a capture needs, and a failed capture looks exactly like a broken file. The
 * status is read first, and a failure is repeated with inherited stderr so the
 * actual syntax error still reaches the terminal.
 */
function parses(path) {
  const quiet = spawnSync(process.execPath, ['--check', path], { stdio: 'ignore' })
  if (quiet.error) return { ok: false, detail: String(quiet.error.message || quiet.error) }
  if (quiet.status === 0) return { ok: true }
  spawnSync(process.execPath, ['--check', path], { stdio: ['ignore', 'ignore', 'inherit'] })
  return { ok: false, detail: '（node --check 的报错见上方）' }
}

async function checkSources() {
  const problems = []
  for (const name of SOURCES) {
    const path = join(root, name)
    if ((await readText(path)) === null) {
      problems.push(`缺失：${name}`)
      continue
    }
    const result = parses(path)
    if (!result.ok) problems.push(`${name} 解析失败 ${result.detail}`)
  }
  return problems
}

async function checkPackageJson() {
  const text = await readText(join(root, 'package.json'))
  if (text === null) return ['缺失：package.json']
  try {
    JSON.parse(text)
    return []
  } catch (error) {
    return [`package.json 不是合法 JSON：${String((error && error.message) || error)}`]
  }
}

/** Bundled workflows are read at request time, so a bad one breaks a route. */
async function checkTemplates() {
  const dir = join(root, 'templates')
  let names = []
  try {
    names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.json'))
  } catch {
    return []
  }
  const problems = []
  for (const name of names) {
    const text = await readText(join(dir, name))
    if (text === null) continue
    try {
      JSON.parse(text)
    } catch (error) {
      problems.push(`templates/${name} 不是合法 JSON：${String((error && error.message) || error)}`)
    }
  }
  return problems
}

// The manifest is checked first: `node --check` resolves module syntax through
// it, so an unreadable package.json reports every source file as broken too.
const manifest = await checkPackageJson()
if (manifest.length > 0) {
  console.error('preflight 失败：包清单读不出来，其余检查无从进行。')
  for (const problem of manifest) console.error('  - ' + problem)
  process.exit(1)
}

const problems = [...(await checkSources()), ...(await checkTemplates())]

if (problems.length > 0) {
  console.error(`preflight 失败（${problems.length} 项）：`)
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log(`preflight 通过：${SOURCES.join(' / ')} 均可解析，package.json 与 templates/*.json 合法`)
