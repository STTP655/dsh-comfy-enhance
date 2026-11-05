#!/usr/bin/env node
/**
 * 改动前的副本。
 *
 * 这个插件是被运行中的 DSH 直接加载的（profile 用 junction 指向本目录，浏览器拿到的
 * 就是这里的 `client.js`），所以存盘即上线：一次半截的保存就足以让某个面板变砖。
 * git 记的是"提交过的好状态"，这个脚本记的是"上一次改动前的样子"，两者互补。
 *
 *   node scripts/snapshot.mjs                 # 拍一份
 *   node scripts/snapshot.mjs fix-polish      # 拍一份，带上备注
 *   node scripts/snapshot.mjs --list          # 看有哪些
 *   node scripts/snapshot.mjs --restore <id>  # 用某份覆盖当前文件
 *
 * 快照写在 backups/（已被 .gitignore 忽略），默认保留最近 20 份。
 */
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const backupRoot = join(root, 'backups')

/** 会直接影响运行结果的文件；素材与模板不在此列（它们很少变，且体积大）。 */
const FILES = ['index.js', 'canvas-host.js', 'client.js', 'package.json', 'CHANGELOG.md']
const KEEP = 20

const pad = (value) => String(value).padStart(2, '0')

function stamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

/** 本地时间，快照名与列表用同一套时区，免得对不上。 */
function fmtLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function safeNote(note) {
  return String(note || '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

async function listSnapshots() {
  let names = []
  try {
    names = (await readdir(backupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  return names.sort().reverse()
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function snapshot(note) {
  const id = stamp() + (note ? '-' + note : '')
  const target = join(backupRoot, id)
  await mkdir(target, { recursive: true })
  const copied = []
  for (const name of FILES) {
    try {
      await copyFile(join(root, name), join(target, name))
      copied.push(name)
    } catch {
      // 文件不存在就跳过：快照里缺它，恢复时也不会动它。
    }
  }
  if (copied.length === 0) {
    await rm(target, { recursive: true, force: true })
    throw new Error('没有可复制的文件，检查是不是在包根目录运行')
  }
  // 只保留最近 KEEP 份，避免 backups/ 无限长大。
  const all = await listSnapshots()
  for (const stale of all.slice(KEEP)) {
    await rm(join(backupRoot, stale), { recursive: true, force: true })
  }
  return { id, target, copied, pruned: Math.max(0, all.length - KEEP) }
}

async function showList() {
  const all = await listSnapshots()
  if (all.length === 0) {
    console.log('还没有快照。改动前先跑一次 `node scripts/snapshot.mjs`。')
    return
  }
  console.log(`共 ${all.length} 份快照（${backupRoot}）：`)
  for (const id of all) {
    const dir = join(backupRoot, id)
    const sizes = []
    for (const name of FILES) {
      const size = await fileSize(join(dir, name))
      if (size > 0) sizes.push(`${name} ${(size / 1024).toFixed(0)}K`)
    }
    const info = await stat(dir)
    console.log(`  ${id}  ${fmtLocal(info.mtime)}  ${sizes.join(' / ')}`)
  }
}

async function restore(id) {
  const target = join(backupRoot, id)
  let entries = []
  try {
    entries = await readdir(target)
  } catch {
    const all = await listSnapshots()
    throw new Error(`没有快照 ${id}。现有：${all.length > 0 ? all.join(', ') : '（无）'}`)
  }
  // 先确认快照里至少有一个认识的入口文件，免得把无关目录当成快照。
  if (!entries.some((name) => FILES.includes(name))) {
    throw new Error(`${id} 里没有插件文件，拒绝恢复`)
  }
  const restored = []
  for (const name of FILES) {
    if (!entries.includes(name)) continue
    await copyFile(join(target, name), join(root, name))
    restored.push(name)
  }
  return restored
}

const args = process.argv.slice(2)
try {
  if (args.includes('--list') || args.includes('-l')) {
    await showList()
  } else if (args.includes('--restore')) {
    const id = args[args.indexOf('--restore') + 1]
    if (!id) throw new Error('--restore 需要一个快照名，先跑 --list 看看')
    const restored = await restore(id)
    console.log(`已用 ${id} 覆盖：${restored.join(', ')}`)
    console.log('刷新页面看效果；宿主侧改动需重启 DSH。')
  } else {
    const result = await snapshot(safeNote(args.join(' ')))
    console.log(`快照 ${result.id}：${result.copied.join(', ')}`)
    console.log(`位置 ${result.target}`)
    if (result.pruned > 0) console.log(`顺手清掉了 ${result.pruned} 份超过 ${KEEP} 的旧快照`)
  }
} catch (error) {
  console.error(String((error && error.message) || error))
  process.exit(1)
}
