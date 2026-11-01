window.__ModuleLoader__.load({
  id: 'dsh-comfy-enhance',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    // ------------------------------------------------------------- module prefs

    const PREF_KEY = 'dsh.comfy-status.modules'

    /**
     * Browser-local preferences for this bundle. Both the plugin page and the
     * surfaces themselves read one source, so a change takes effect at once.
     *
     * `clearedBefore` is the album's own watermark: renders at or before it are
     * hidden from the grid. It never touches ComfyUI's history or the output
     * files, so anything generated past it keeps appearing.
     */
    const pluginPrefs = (() => {
      let state = { status: true, album: true, canvas: true, clearedBefore: 0 }
      try {
        const raw = localStorage.getItem(PREF_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            state = {
              status: parsed.status !== false,
              album: parsed.album !== false,
              canvas: parsed.canvas !== false,
              clearedBefore: typeof parsed.clearedBefore === 'number' ? parsed.clearedBefore : 0,
            }
          }
        }
      } catch {
        // Private mode or a corrupted value: the defaults stand.
      }
      const listeners = new Set()
      return {
        get: () => state,
        set(key, value) {
          state = { ...state, [key]: value }
          try {
            localStorage.setItem(PREF_KEY, JSON.stringify(state))
          } catch {
            // Storage may be unavailable; the in-memory value still applies.
          }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    })()

    function usePref(key) {
      const [value, setValue] = useState(pluginPrefs.get()[key])
      useEffect(() => pluginPrefs.subscribe(() => setValue(pluginPrefs.get()[key])), [])
      return [value, (next) => pluginPrefs.set(key, next)]
    }

    const SNAPSHOT = '/plugin/comfy-status/snapshot'
    const POLL_MS = 2000
    const GIB = 1073741824

    const TONE = {
      idle: 'var(--dsw-alias-state-success-primary)',
      busy: 'var(--dsw-alias-brand-primary)',
      down: 'var(--dsw-alias-state-idle-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    function fmtGiB(bytes) {
      const n = Number(bytes) || 0
      return n <= 0 ? '0' : (n / GIB).toFixed(1)
    }

    function fmtDuration(ms) {
      const total = Math.round((Number(ms) || 0) / 100) / 10
      if (total <= 0) return '—'
      if (total < 60) return total.toFixed(1) + 's'
      const min = Math.floor(total / 60)
      return min + 'm' + Math.round(total - min * 60) + 's'
    }

    function useSnapshot() {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState(null)

      useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const res = await fetch(SNAPSHOT, { cache: 'no-store' })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const data = await res.json()
            if (!alive) return
            setSnap(data)
            setError(null)
          } catch (e) {
            if (!alive) return
            setError(String((e && e.message) || e))
          } finally {
            if (alive) timer = setTimeout(tick, POLL_MS)
          }
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      return [snap, error]
    }

    function dotStyle(tone, busy) {
      return {
        width: 7,
        height: 7,
        borderRadius: '50%',
        flex: 'none',
        background: tone,
        boxShadow: busy ? '0 0 0 3px color-mix(in srgb, ' + tone + ' 22%, transparent)' : 'none',
        animation: busy ? 'dsh-comfy-status-pulse 1.4s ease-in-out infinite' : 'none',
      }
    }

    const CARD = {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      width: '100%',
      boxSizing: 'border-box',
      padding: '9px 12px',
      borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 11,
      lineHeight: 1.3,
      userSelect: 'none',
    }
    const ROW = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
    const SUB = { color: 'var(--dsw-alias-label-secondary)', fontSize: 10 }
    const NUM = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' }
    const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }

    function PulseKeyframes() {
      return h(
        'style',
        null,
        '@keyframes dsh-comfy-status-pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
          '@media (prefers-reduced-motion:reduce){@keyframes dsh-comfy-status-pulse{0%,100%{opacity:.85}50%{opacity:.5}}}',
      )
    }

    function ComfyStatus(props) {
      const wide = !(props && props.wide === false)
      const [snap, error] = useSnapshot()

      const up = Boolean(snap && snap.up)
      const queue = (snap && snap.queue) || {}
      const running = queue.running || 0
      const pending = queue.pending || 0
      const busy = up && running > 0
      const device = up ? (snap && snap.device) || null : null
      const last = up ? (snap && snap.last) || null : null
      const version = (snap && snap.version) || ''

      const total = device ? device.vramTotal || 0 : 0
      const free = device ? device.vramFree || 0 : 0
      const used = Math.max(0, total - free)
      const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0

      const tone = !up ? TONE.down : busy ? TONE.busy : TONE.idle
      // ComfyUI keeps models resident while idle, so a high idle reading is normal
      // and must not read as a warning. Only pressure during a running job tints.
      const vramTone = pct >= 92 ? TONE.error : busy && pct >= 78 ? TONE.warn : 'var(--dsw-alias-brand-primary)'

      const stateText = !up ? '未连接' : busy ? '运行中' : pending > 0 ? '排队中' : '空闲'

      const tipLines = ['ComfyUI' + (up && version ? ' ' + version : '')]
      if (up) {
        tipLines.push('队列  运行 ' + running + ' · 等待 ' + pending)
        if (device) tipLines.push('显存  ' + fmtGiB(used) + ' / ' + fmtGiB(total) + ' GB (' + pct + '%)')
        if (last) {
          const name = last.images && last.images.length > 0 ? last.images[0].filename : last.promptId.slice(0, 8)
          tipLines.push('上次  ' + fmtDuration(last.durationMs) + ' · ' + name)
        }
      } else {
        tipLines.push(snap ? '端口未响应：' + (snap.url || '') : '正在连接…')
        if (error) tipLines.push(error)
        else if (snap && snap.error) tipLines.push(snap.error)
      }
      const tip = tipLines.join('\n')

      if (!wide) {
        const railLabel = !up ? '×' : String(running + pending)
        return h(
          'div',
          {
            title: tip,
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              width: '100%',
              padding: '4px 0',
              cursor: 'default',
            },
          },
          h(PulseKeyframes),
          h(
            'svg',
            {
              width: 15,
              height: 15,
              viewBox: '0 0 16 16',
              'aria-hidden': true,
              style: {
                display: 'block',
                color: tone,
                animation: busy ? 'dsh-comfy-status-pulse 1.4s ease-in-out infinite' : 'none',
              },
            },
            h(
              'g',
              { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('rect', { x: 1.6, y: 5.6, width: 4.6, height: 4.8, rx: 1.3 }),
              h('rect', { x: 9.8, y: 5.6, width: 4.6, height: 4.8, rx: 1.3 }),
              h('path', { d: 'M6.2 8h3.6' }),
            ),
          ),
          h(
            'span',
            {
              style: Object.assign({}, SUB, NUM, {
                fontSize: 10,
                lineHeight: 1.15,
                fontWeight: 500,
                color: up ? 'var(--dsw-alias-label-secondary)' : TONE.down,
              }),
            },
            railLabel,
          ),
        )
      }

      return h(
        'div',
        { title: tip, style: CARD },
        h(PulseKeyframes),
        h(
          'div',
          { style: Object.assign({}, ROW, { gap: 6 }) },
          h('span', { style: dotStyle(tone, busy) }),
          h('span', { style: { fontWeight: 600, fontSize: 11.5, letterSpacing: '.1px' } }, 'ComfyUI'),
          up && version ? h('span', { style: Object.assign({}, SUB, NUM) }, version) : null,
          h('span', { style: { flex: 1 } }),
          h('span', { style: Object.assign({}, SUB, { fontSize: 10.5 }) }, stateText),
        ),
        up
          ? h(
              'div',
              { style: Object.assign({}, ROW, { gap: 10 }) },
              h(
                'span',
                { style: Object.assign({}, SUB, NUM) },
                '运行 ',
                h('span', { style: { color: running > 0 ? 'var(--dsw-alias-label-primary)' : 'inherit', fontWeight: running > 0 ? 600 : 400 } }, String(running)),
              ),
              h('span', { style: Object.assign({}, SUB, NUM) }, '等待 ', h('span', { style: { color: pending > 0 ? 'var(--dsw-alias-label-primary)' : 'inherit' } }, String(pending))),
            )
          : null,
        up && device
          ? h(
              'div',
              { style: Object.assign({}, ROW, { gap: 6 }) },
              h('span', { style: Object.assign({}, SUB, { flex: 'none' }) }, '显存'),
              h(
                'div',
                {
                  style: {
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    background: 'var(--dsw-alias-bg-layer-2)',
                    overflow: 'hidden',
                    minWidth: 24,
                  },
                },
                h('div', {
                  style: {
                    width: pct + '%',
                    height: '100%',
                    borderRadius: 2,
                    background: vramTone,
                    transition: 'width .35s ease',
                  },
                }),
              ),
              h(
                'span',
                { style: Object.assign({}, SUB, NUM, { flex: 'none', fontSize: 9.5 }) },
                fmtGiB(used) + '/' + fmtGiB(total) + 'G',
              ),
            )
          : null,
        up && last
          ? h(
              'div',
              { style: Object.assign({}, SUB, NUM, ELLIPSIS, { fontSize: 9.5 }) },
              '上次 ' + fmtDuration(last.durationMs) + ' · ' +
                (last.images && last.images.length > 0 ? last.images[0].filename : last.promptId.slice(0, 8)),
            )
          : null,
        up
          ? null
          : h(
              'div',
              { style: Object.assign({}, SUB, ELLIPSIS, { fontSize: 9.5 }) },
              snap ? '端口未响应 ' + (snap.url || '').replace(/^https?:\/\//, '') : '正在连接…',
            ),
      )
    }

    // ---------------------------------------------------------------- album tab

    const TAB_ID = 'dsh-comfy-status'
    const TAB_KIND = 'comfy-album'
    const ALBUM_ENDPOINT = '/plugin/comfy-status/album'
    const ALBUM_POLL_MS = 15000

    const ALBUM_SHELL = {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      fontSize: 12,
      color: 'var(--dsw-alias-label-primary)',
    }
    const ALBUM_HEAD = {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '9px 12px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    const ALBUM_GRID = {
      flex: 'none',
      maxHeight: 208,
      overflowY: 'auto',
      overflowX: 'hidden',
      margin: '10px 12px 0',
      padding: 10,
      borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-l2)',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
    }
    /** One day's thumbnails inside the gallery. */
    const DAY_GRID = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
      gap: 8,
    }
    const DAY_RAIL_GRID = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
      gap: 6,
    }
    const DAY_HEADER = {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-secondary)',
      marginBottom: 6,
    }
    const DAY_COUNT = {
      fontWeight: 400,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const DAY_GROUP = { marginTop: 12 }
    const ALBUM_IMG = { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }
    const ALBUM_DETAIL = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }
    const ALBUM_EMPTY = {
      padding: '28px 12px',
      textAlign: 'center',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 11.5,
    }

    // A resizable right pane can be far wider than the stacked layout assumes.
    // Past this width the thumbnails move into a rail and the detail takes the rest.
    const WIDE_BREAKPOINT = 700
    const CONTENT_ROW = { display: 'flex', flex: 1, minHeight: 0 }
    const CONTENT_COLUMN = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
    const GRID_RAIL = {
      flex: 'none',
      width: 236,
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: 8,
      borderRight: '1px solid var(--dsw-alias-border-l2)',
    }
    const DETAIL_PANE = {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      overflowY: 'auto',
      padding: 14,
    }
    // Keeps the detail column readable instead of stretching a label and its
    // value to opposite edges of a very wide pane.
    const DETAIL_MAX_WIDTH = 760
    const MODEL_CHIP = {
      display: 'inline-block',
      maxWidth: '100%',
      padding: '2px 7px',
      borderRadius: 999,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 10,
      lineHeight: 1.4,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const PROMPT_BOX = {
      margin: 0,
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 11,
      lineHeight: 1.55,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 190,
      overflowY: 'auto',
      fontFamily: 'inherit',
    }

    /** Bordered surface used to group one block of details. */
    const INFO_CARD = {
      borderRadius: 10,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      padding: '9px 11px',
      // Light mode paints every surface #fff, so the border alone is the only
      // boundary; a whisper of shadow lifts the card off the page there and
      // disappears against dark backgrounds.
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
    }
    /** A second block inside a CARD, separated by a rule rather than a gap. */
    const CARD_SECTION = {
      borderTop: '1px solid var(--dsw-alias-border-l1)',
      marginTop: 9,
      paddingTop: 9,
    }
    const CARD_LABEL = {
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-secondary)',
      marginBottom: 5,
    }
    const EMPTY_GROUP = {
      fontSize: 10.5,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const PAIR_GRID = {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      columnGap: 18,
      rowGap: 3,
      fontSize: 10.5,
    }

    function fmtClock(ms) {
      const value = Number(ms) || 0
      if (value <= 0) return ''
      const date = new Date(value)
      const pad = (n) => String(n).padStart(2, '0')
      return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function dayKeyOf(ms) {
      const date = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    }

    /** "今天" / "昨天" / "3 天前" / "10 月 28 日" — relative while it stays useful. */
    function dayLabelOf(ms) {
      const date = new Date(ms)
      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      const days = Math.round((startOfToday - startOfThat) / 86400000)
      if (days <= 0) return '今天'
      if (days === 1) return '昨天'
      if (days < 7) return days + ' 天前'
      return date.getMonth() + 1 + ' 月 ' + date.getDate() + ' 日'
    }

    /** Newest-first items folded into one bucket per calendar day. */
    function groupByDay(items) {
      const groups = []
      const index = new Map()
      for (const item of items) {
        const key = dayKeyOf(item.startedAt || 0)
        let group = index.get(key)
        if (!group) {
          group = { key, label: dayLabelOf(item.startedAt || 0), items: [] }
          index.set(key, group)
          groups.push(group)
        }
        group.items.push(item)
      }
      return groups
    }

    function AlbumIcon(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h(
          'g',
          { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' },
          h('rect', { x: 1.6, y: 2.4, width: 5.6, height: 5.6, rx: 1.4 }),
          h('rect', { x: 8.8, y: 2.4, width: 5.6, height: 5.6, rx: 1.4 }),
          h('rect', { x: 1.6, y: 8.8, width: 5.6, height: 5.6, rx: 1.4 }),
          h('circle', { cx: 11.6, cy: 11.6, r: 2.8 }),
        ),
      )
    }

    function AlbumStyles() {
      return h(
        'style',
        null,
        [
          '.dshComfyAlbum-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.4;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
          '.dshComfyAlbum-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
          '.dshComfyAlbum-thumb{appearance:none;padding:0;margin:0;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;overflow:hidden;display:block;width:100%;height:92px;line-height:0}',
          '.dshComfyAlbum-thumb:hover{opacity:.86}',
          '.dshComfyAlbum-thumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshComfyAlbum-gallery{background:var(--dsw-specific-sidebar-fill);background:light-dark(var(--dsw-alias-bg-overlay),var(--dsw-alias-bg-layer-2))}',
          '.dshComfyAlbum-zoom{position:absolute;right:8px;bottom:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;cursor:pointer;background:rgba(0,0,0,.55);color:#fff;backdrop-filter:blur(4px)}',
          '.dshComfyAlbum-zoom:hover{background:rgba(0,0,0,.78)}',
          '.dshComfyAlbum-zoom:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        ].join(''),
      )
    }

    const RUNNING_BOX = {
      flex: 'none',
      position: 'relative',
      overflow: 'hidden',
      margin: '10px 12px 0',
      padding: '8px 11px 8px 13px',
      borderRadius: 10,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
    }

    function useAlbum() {
      const [album, setAlbum] = useState(null)
      const [error, setError] = useState(null)
      const [nonce, setNonce] = useState(0)

      useEffect(() => {
        let alive = true
        let timer = null
        let busy = false
        const load = async () => {
          try {
            const res = await fetch(ALBUM_ENDPOINT, { cache: 'no-store' })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const data = await res.json()
            if (!alive) return
            setAlbum(data)
            setError(null)
            busy = Boolean(data && data.running && data.running.length > 0)
          } catch (e) {
            if (!alive) return
            setError(String((e && e.message) || e))
          } finally {
            // A live job changes every few seconds; an idle gallery does not.
            if (alive) timer = setTimeout(load, busy ? 4000 : ALBUM_POLL_MS)
          }
        }
        load()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [nonce])

      return [album, error, () => setNonce((n) => n + 1)]
    }

    function PromptBlock(props) {
      const value = props.value
      const [showRaw, setShowRaw] = useState(false)
      const [copied, setCopied] = useState(false)
      if (!value) return null

      const text = showRaw && value.raw ? value.raw : value.text
      const accent = props.accent || 'var(--dsw-alias-border-l2)'

      const copy = async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          // Clipboard permission refused; the text is still selectable.
        }
      }

      return h(
        'div',
        { style: { marginTop: 14, position: 'relative', paddingLeft: 9 } },
        h('span', {
          style: {
            position: 'absolute',
            left: 0,
            top: 2,
            bottom: 2,
            width: 2,
            borderRadius: 1,
            background: accent,
          },
        }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 } },
          h('span', { style: { fontSize: 10.5, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, props.title),
          h('span', { style: { flex: 1 } }),
          value.structured
            ? h('button', { className: 'dshComfyAlbum-btn', onClick: () => setShowRaw(!showRaw) }, showRaw ? '显示正文' : '原始 JSON')
            : null,
          h('button', { className: 'dshComfyAlbum-btn', onClick: copy }, copied ? '已复制' : '复制'),
        ),
        h('pre', { style: PROMPT_BOX }, text),
      )
    }

    /** One pair inside the sampler grid; an absent value keeps its cell so the grid stays aligned. */
    function Pair(props) {
      const empty = props.value === null || props.value === undefined || props.value === ''
      if (empty) return h('div')
      return h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', gap: 8, minWidth: 0 } },
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', flex: 'none' } }, props.label),
        h('span', { style: Object.assign({}, NUM, ELLIPSIS) }, String(props.value)),
      )
    }

    function RunningBlock(props) {
      const job = props.job
      const meta = (job && job.meta) || {}
      const [expanded, setExpanded] = useState(false)
      const head = meta.positive && meta.positive.text ? meta.positive.text.replace(/\s+/g, ' ').trim() : ''

      const sampler = meta.sampler
      const samplerLine = sampler
        ? [sampler.steps !== null ? sampler.steps + ' 步' : '', sampler.cfg !== null ? 'CFG ' + sampler.cfg : '', sampler.seed !== null ? 'seed ' + sampler.seed : '']
            .filter(Boolean)
            .join(' · ')
        : ''

      return h(
        'div',
        { style: RUNNING_BOX },
        h('span', {
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--dsw-alias-brand-primary)',
          },
        }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', {
            style: {
              width: 7,
              height: 7,
              borderRadius: '50%',
              flex: 'none',
              background: 'var(--dsw-alias-brand-primary)',
              animation: 'dsh-comfy-status-pulse 1.4s ease-in-out infinite',
            },
          }),
          h('span', { style: { fontWeight: 600, fontSize: 11.5 } }, '正在生成'),
          h('span', { style: Object.assign({}, SUB, NUM, { fontSize: 10.5 }) }, samplerLine),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dshComfyAlbum-btn', onClick: () => setExpanded(!expanded) }, expanded ? '收起' : '查看提示词'),
        ),
        !expanded && head
          ? h('div', { style: Object.assign({}, SUB, ELLIPSIS, { marginTop: 4, fontSize: 10.5 }) }, head)
          : null,
        expanded
          ? h(
              'div',
              { style: { maxHeight: '30vh', overflowY: 'auto' } },
              h(PromptBlock, { title: '正向提示词', value: meta.positive }),
              h(PromptBlock, { title: '负向提示词', value: meta.negative }),
            )
          : null,
      )
    }

    const VIEWER_BACKDROP = {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'rgba(0, 0, 0, 0.86)',
      cursor: 'zoom-out',
    }
    const VIEWER_IMAGE = {
      maxWidth: '94vw',
      maxHeight: '88vh',
      objectFit: 'contain',
      borderRadius: 8,
      display: 'block',
      cursor: 'default',
      boxShadow: '0 18px 60px rgba(0, 0, 0, 0.5)',
    }
    const VIEWER_BAR = {
      position: 'absolute',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      maxWidth: '92vw',
      padding: '6px 10px',
      borderRadius: 10,
      background: 'rgba(0, 0, 0, 0.62)',
      color: '#ffffff',
    }

    /** Four outward arrows: "expand this image". */
    function ZoomIcon(props) {
      const size = (props && props.size) || 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
        h(
          'g',
          { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M6 2H2v4' }),
          h('path', { d: 'M10 2h4v4' }),
          h('path', { d: 'M14 10v4h-4' }),
          h('path', { d: 'M2 10v4h4' }),
        ),
      )
    }

    /** Full-viewport image viewer; Escape or a backdrop click closes it. */
    function ImageViewer(props) {
      const onClose = props.onClose
      useEffect(() => {
        const onKey = (event) => {
          if (event.isComposing) return
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
        // onClose only calls a state setter, so binding once is enough.
      }, [])

      return h(
        'div',
        { style: VIEWER_BACKDROP, onClick: onClose, role: 'presentation' },
        h('img', {
          src: props.src,
          alt: props.filename,
          style: VIEWER_IMAGE,
          onClick: (event) => event.stopPropagation(),
        }),
        h(
          'div',
          { style: VIEWER_BAR, onClick: (event) => event.stopPropagation() },
          h(
            'span',
            {
              style: {
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '46vw',
                color: 'rgba(255, 255, 255, 0.78)',
              },
            },
            props.filename,
          ),
          h('a', {
            className: 'dshComfyAlbum-btn',
            href: props.src,
            target: '_blank',
            rel: 'noreferrer',
            style: { textDecoration: 'none' },
          }, '新标签打开'),
          h('button', { className: 'dshComfyAlbum-btn', onClick: onClose }, '关闭'),
        ),
      )
    }

    /** Facts laid over the bottom of the preview, on a gradient that guarantees contrast on any image. */
    const IMAGE_HUD = {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 10,
      rowGap: 2,
      padding: '18px 44px 9px 11px',
      borderRadius: '0 0 10px 10px',
      background: 'linear-gradient(to top, rgba(0, 0, 0, 0.66), rgba(0, 0, 0, 0))',
      color: '#fff',
      fontSize: 10.5,
      lineHeight: 1.4,
      // The gradient must never swallow a click meant for the image itself.
      pointerEvents: 'none',
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
    }

    /** The facts, models and sampler of one output — stacked, or sharing columns on a wide pane. */
    function InfoCard(props) {
      const item = props.item
      const wide = Boolean(props.wide)
      const meta = item.meta || {}
      const sampler = meta.sampler || null
      const models = meta.models || []
      const hasSampler = sampler !== null && (sampler.name || sampler.steps !== null)

      if (models.length === 0 && !hasSampler) return null

      const modelChips =
        models.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
              ...models.map((model) =>
                h(
                  'span',
                  { key: model.role + '\u0000' + model.name, style: MODEL_CHIP, title: model.role + ': ' + model.name },
                  model.role + ' · ' + model.name,
                ),
              ),
            )
          : null

      const sampling = hasSampler
        ? h(
            'div',
            { style: PAIR_GRID },
            h(Pair, { label: '采样器', value: sampler.name }),
            h(Pair, { label: '调度', value: sampler.scheduler }),
            h(Pair, { label: '步数', value: sampler.steps }),
            h(Pair, { label: 'CFG', value: sampler.cfg }),
            h(Pair, { label: '种子', value: sampler.seed }),
          )
        : null

      if (!wide) {
        return h(
          'div',
          { style: Object.assign({}, INFO_CARD, { marginTop: 12 }) },
          modelChips ? h('div', null, h('div', { style: CARD_LABEL }, '模型'), modelChips) : null,
          sampling
            ? h(
                'div',
                { style: modelChips ? CARD_SECTION : null },
                h('div', { style: CARD_LABEL }, '采样'),
                sampling,
              )
            : null,
        )
      }

      // Wide: two columns share one card, so a handful of very short values stops
      // costing a full row each.
      return h(
        'div',
        {
          style: Object.assign({}, INFO_CARD, {
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)',
          }),
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: CARD_LABEL }, '模型'),
          modelChips || h('div', { style: EMPTY_GROUP }, '未记录'),
        ),
        h(
          'div',
          { style: { minWidth: 0, paddingLeft: 13, borderLeft: '1px solid var(--dsw-alias-border-l1)' } },
          h('div', { style: CARD_LABEL }, '采样'),
          sampling || h('div', { style: EMPTY_GROUP }, '未记录'),
        ),
      )
    }

    function AlbumDetail(props) {
      const item = props.item
      const image = item.images[0]
      const meta = item.meta || {}
      const [zoomed, setZoomed] = useState(false)
      // A wide pane can afford a taller preview without pushing the details away.
      const wide = Boolean(props.wide)

      const sizeText = image.width && image.height ? image.width + ' × ' + image.height : ''
      const durationText = fmtDuration(item.durationMs)
      const clockText = fmtClock(item.startedAt)

      return h(
        'div',
        null,
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'center' } },
          h(
            'div',
            { style: { position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 } },
            h('img', {
              src: image.url,
              alt: image.filename,
              style: {
                display: 'block',
                maxWidth: '100%',
                maxHeight: wide ? '44vh' : '30vh',
                width: 'auto',
                height: 'auto',
                borderRadius: 10,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-2)',
              },
            }),
            h(
              'div',
              { style: IMAGE_HUD },
              sizeText ? h('span', null, sizeText) : null,
              durationText && durationText !== '—' ? h('span', null, durationText) : null,
              clockText ? h('span', null, clockText) : null,
            ),
            h(
              'button',
              {
                className: 'dshComfyAlbum-zoom',
                title: '查看大图',
                'aria-label': '查看大图',
                onClick: () => setZoomed(true),
              },
              h(ZoomIcon, { size: 13 }),
            ),
          ),
        ),
        zoomed
          ? h(ImageViewer, { src: image.url, filename: image.filename, onClose: () => setZoomed(false) })
          : null,
        h(InfoCard, { item, wide }),
        h(PromptBlock, {
          title: '正向提示词',
          value: meta.positive,
          accent: 'var(--dsw-alias-brand-primary)',
        }),
        h(PromptBlock, {
          title: '负向提示词',
          value: meta.negative,
          accent: 'var(--dsw-alias-border-l2)',
        }),
      )
    }

    /**
     * Track the pane's own width. Media queries report the viewport, which says
     * nothing about a right sidebar the user drags independently of the window.
     */
    function usePaneWidth() {
      const ref = useRef(null)
      const [width, setWidth] = useState(0)

      useEffect(() => {
        const element = ref.current
        if (!element) return
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) setWidth(entry.contentRect.width)
        })
        observer.observe(element)
        setWidth(element.getBoundingClientRect().width)
        return () => observer.disconnect()
      }, [])

      return [ref, width]
    }

    function AlbumTab() {
      const [album, error, reload] = useAlbum()
      const [picked, setPicked] = useState(null)
      const [shellRef, paneWidth] = usePaneWidth()
      const [clearedBefore, setClearedBefore] = usePref('clearedBefore')
      const [confirming, setConfirming] = useState(false)
      const wide = paneWidth >= WIDE_BREAKPOINT

      // A clear only hides what already existed at that moment; the next render
      // still lands past the watermark and shows up.
      const items = (album && album.items) || []
      const visible = items.filter((item) => (item.startedAt || 0) > clearedBefore)
      const running = (album && album.running) || []
      const groups = groupByDay(visible)
      const selected = visible.find((item) => item.id === picked) || visible[0] || null

      useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(false), 4000)
        return () => clearTimeout(timer)
      }, [confirming])

      const requestClear = () => {
        if (!confirming) {
          setConfirming(true)
          return
        }
        setConfirming(false)
        setClearedBefore(Date.now())
      }

      const thumbOf = (item) =>
        h(
          'button',
          {
            key: item.id,
            className: 'dshComfyAlbum-thumb',
            title: item.images[0].filename,
            onClick: () => setPicked(item.id),
            style:
              selected && selected.id === item.id
                ? { outline: '2px solid var(--dsw-alias-brand-primary)', outlineOffset: 1 }
                : null,
          },
          h('img', { src: item.images[0].url, loading: 'lazy', alt: item.images[0].filename, style: ALBUM_IMG }),
        )

      const gallery = h(
        'div',
        { className: 'dshComfyAlbum-gallery', style: wide ? GRID_RAIL : ALBUM_GRID },
        ...groups.map((group, index) =>
          h(
            'div',
            { key: group.key, style: index === 0 ? null : DAY_GROUP },
            h(
              'div',
              { style: DAY_HEADER },
              h('span', null, group.label),
              h('span', { style: DAY_COUNT }, group.items.length + ' 张'),
            ),
            h('div', { style: wide ? DAY_RAIL_GRID : DAY_GRID }, ...group.items.map(thumbOf)),
          ),
        ),
      )

      let content
      if (error) content = h('div', { style: ALBUM_EMPTY }, '无法连接插件后端：' + error)
      else if (!album) content = h('div', { style: ALBUM_EMPTY }, '正在加载…')
      else if (album.up === false) content = h('div', { style: ALBUM_EMPTY }, 'ComfyUI 未连接')
      else if (items.length === 0) content = h('div', { style: ALBUM_EMPTY }, '还没有输出图')
      else if (visible.length === 0)
        content = h(
          'div',
          { style: ALBUM_EMPTY },
          '相册已清空，新生成的图会自动出现。',
          h(
            'div',
            { style: { marginTop: 10 } },
            h(
              'button',
              { className: 'dshComfyAlbum-btn', onClick: () => setClearedBefore(0) },
              '显示之前的 ' + items.length + ' 张',
            ),
          ),
        )
      else
        content = h(
          'div',
          { style: wide ? CONTENT_ROW : CONTENT_COLUMN },
          gallery,
          h(
            'div',
            { style: wide ? DETAIL_PANE : ALBUM_DETAIL },
            selected
              ? h(
                  'div',
                  { style: wide ? { maxWidth: DETAIL_MAX_WIDTH } : null },
                  h(AlbumDetail, { item: selected, wide }),
                )
              : null,
          ),
        )

      return h(
        'div',
        { style: ALBUM_SHELL, ref: shellRef },
        h(AlbumStyles),
        h(PulseKeyframes),
        h(
          'div',
          { style: ALBUM_HEAD },
          h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, '相册'),
          h('span', { style: Object.assign({}, SUB, NUM, { fontSize: 11 }) }, visible.length + ' 张'),
          h('span', { style: { flex: 1 } }),
          clearedBefore > 0
            ? h('button', { className: 'dshComfyAlbum-btn', onClick: () => setClearedBefore(0) }, '恢复')
            : null,
          visible.length > 0
            ? h(
                'button',
                {
                  className: 'dshComfyAlbum-btn',
                  style: confirming
                    ? {
                        color: 'var(--dsw-alias-state-error-primary)',
                        borderColor: 'var(--dsw-alias-state-error-primary)',
                      }
                    : null,
                  onClick: requestClear,
                },
                confirming ? '确认清空？' : '清空',
              )
            : null,
          h('button', { className: 'dshComfyAlbum-btn', onClick: reload }, '刷新'),
        ),
        running.length > 0 ? h(RunningBlock, { job: running[0] }) : null,
        content,
      )
    }

    function AlbumTitle() {
      return h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h(AlbumIcon, { size: 14 }),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 'ComfyUI 相册'),
      )
    }

    /** A theme-aware switch: the knob is the page colour, so it reads on either track. */
    function ModuleSwitch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked,
          'aria-label': props.label,
          onClick: () => props.onChange(!props.checked),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: props.checked ? 'flex-end' : 'flex-start',
            flex: 'none',
            width: 34,
            height: 20,
            padding: 2,
            border: 0,
            borderRadius: 999,
            cursor: 'pointer',
            background: props.checked
              ? 'var(--dsw-alias-brand-primary)'
              : 'var(--dsw-alias-border-l2)',
            transition: 'background .15s ease',
          },
        },
        h('span', {
          style: {
            display: 'block',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--dsw-alias-bg-base)',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
          },
        }),
      )
    }

    /** One module row on the plugin page: what it is, and its switch. */
    function ModuleRow(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '10px 0',
            borderTop: props.first ? 'none' : '1px solid var(--dsw-alias-border-l1)',
          },
        },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 12, fontWeight: 500 } }, props.title),
          h(
            'div',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2, lineHeight: 1.5 } },
            props.description,
          ),
        ),
        h(ModuleSwitch, { checked: props.checked, onChange: props.onChange, label: props.title }),
      )
    }

    /** This bundle's own configuration block, rendered on its plugin page. */
    function ModuleSettings(props) {
      const [statusOn, setStatusOn] = usePref('status')
      const [albumOn, setAlbumOn] = usePref('album')
      const [canvasOn, setCanvasOn] = usePref('canvas')

      if (props.view === 'summary') {
        return h(
          'span',
          { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          '侧边栏状态' +
            (statusOn ? '开' : '关') +
            ' · 相册' +
            (albumOn ? '开' : '关') +
            ' · 画板MOSS' +
            (canvasOn ? '开' : '关'),
        )
      }

      return h(
        'div',
        null,
        h(ModuleRow, {
          first: true,
          title: '侧边栏状态卡片',
          description: '在左侧边栏底部显示队列、显存与最近一次任务。',
          checked: statusOn,
          onChange: setStatusOn,
        }),
        h(ModuleRow, {
          title: '相册标签页',
          description: '在右侧边栏提供输出图画廊，含提示词、模型与采样参数。',
          checked: albumOn,
          onChange: setAlbumOn,
        }),
        h(ModuleRow, {
          title: '画板标签页（MOSS）',
          description: 'MOSS 模型专用：在右侧边栏编辑画框、整图描述与版式提示词。',
          checked: canvasOn,
          onChange: setCanvasOn,
        }),
      )
    }


    // ======================= merged: ComfyUI canvas =======================
    const CANVAS_SUB = { color: 'var(--dsw-alias-label-secondary)' }
    const API = '/plugin/comfy-canvas'
    const CANVAS_TAB_ID = 'dsh-comfy-canvas'
    const CANVAS_TAB_KIND = 'comfy-canvas'
    const NODE_TYPE = 'CreateBoundingBoxes'

    /** The board may take more of the viewport now that the two control rows share
     *  one line. */
    const BOARD_MAX_HEIGHT = '50vh'
    const SHELL = {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      fontSize: 12,
      color: 'var(--dsw-alias-label-primary)',
    }
    const HEAD = {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 14px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    /** Status folded into the header row instead of costing its own line. */
    const STATUS_TEXT = {
      flex: 'none',
      maxWidth: 84,
      fontSize: 10.5,
      color: 'var(--dsw-alias-label-secondary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const FILE_SELECT = {
      flex: 1,
      minWidth: 0,
      fontSize: 11,
      padding: '5px 8px',
      borderRadius: 7,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
    }
    const STAGE = {
      flex: 'none',
      padding: '14px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    /** Canvas and the box list share one row. */
    const STAGE_MAIN = { display: 'flex', gap: 10, alignItems: 'flex-start' }
    const BOARD_WRAP = { display: 'flex', justifyContent: 'center', flex: 1, minWidth: 0 }
    const BOX_LIST = {
      flex: 'none',
      width: 96,
      maxHeight: '50vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }
    const BOX_LIST_INDEX = {
      flex: 'none',
      fontSize: 9,
      opacity: 0.6,
      fontVariantNumeric: 'tabular-nums',
    }
    const BOX_LIST_TEXT = {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const BOARD = {
      position: 'relative',
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 10,
      overflow: 'hidden',
      touchAction: 'none',
      userSelect: 'none',
      boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.04)',
    }
    const STAGE_META = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 10,
      fontSize: 10.5,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const RES_ROW = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginBottom: 10,
      fontSize: 10,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const RES_LABEL = {
      flex: 'none',
      fontSize: 9.5,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const RES_SELECT = {
      flex: '1 1 0',
      minWidth: 0,
      fontSize: 10,
      padding: '3px 5px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
    }
    const RES_MP = {
      flex: 'none',
      width: 46,
      fontSize: 10,
      padding: '3px 5px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
    }
    const DROPDOWN = {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      right: 0,
      zIndex: 60,
      maxHeight: 240,
      overflowY: 'auto',
      padding: 4,
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    }

    // Full-screen working view ---------------------------------------------------
    const OVERLAY = {
      position: 'fixed',
      inset: 0,
      zIndex: 1200,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: 'rgba(0, 0, 0, 0.72)',
    }
    const PANEL = {
      display: 'flex',
      flexDirection: 'column',
      width: '94vw',
      height: '92vh',
      borderRadius: 14,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-base)',
      boxShadow: '0 24px 80px rgba(0, 0, 0, 0.45)',
      overflow: 'hidden',
    }
    const PANEL_HEAD = {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 16px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
      fontSize: 12,
    }
    const PANEL_BODY = { flex: 1, minHeight: 0, display: 'flex' }
    const PANEL_STAGE = {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'var(--dsw-alias-bg-layer-2)',
    }
    const PANEL_SIDE = {
      flex: 'none',
      width: 260,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderLeft: '1px solid var(--dsw-alias-border-l2)',
    }
    const PANEL_LIST = {
      flex: 'none',
      maxHeight: 230,
      overflowY: 'auto',
      padding: 8,
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    const LIST_ROW = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      width: '100%',
      boxSizing: 'border-box',
      marginBottom: 3,
    }
    const ZOOM_INFO = {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 14,
    }
    const ZOOM_INFO_TITLE = {
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary)',
    }
    const ZOOM_INFO_BODY = {
      fontSize: 11,
      lineHeight: 1.6,
      color: 'var(--dsw-alias-label-secondary)',
      wordBreak: 'break-word',
    }
    const ZOOM_INFO_HINT = {
      fontSize: 10,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-label-secondary)',
      opacity: 0.75,
    }
    const ZOOM_SEG_ROW = {
      display: 'flex',
      gap: 4,
      padding: 3,
      borderRadius: 9,
      background: 'var(--dsw-alias-bg-layer-2)',
    }
    const ZOOM_CHECK_ROW = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
    }
    const INSPECTOR = {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 14,
    }
    const INSPECTOR_HEAD = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 14,
    }
    const SEGMENT_WRAP = {
      display: 'flex',
      padding: 3,
      borderRadius: 9,
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l1)',
    }
    const SEGMENT = {
      flex: 1,
      appearance: 'none',
      border: 0,
      borderRadius: 7,
      padding: '7px 0',
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 1.35,
      fontFamily: 'inherit',
      cursor: 'pointer',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      transition: 'background .12s ease, color .12s ease',
    }
    // The selected segment must read as selected: layer-1 and layer-2 are the same
    // #fff in light mode, so the previous paint-the-background trick was invisible.
    const SEGMENT_ON = Object.assign({}, SEGMENT, {
      background: 'var(--dsw-alias-brand-primary)',
      color: 'var(--dsw-alias-bg-base)',
      cursor: 'default',
    })
    const FIELD_LABEL = {
      display: 'block',
      fontSize: 11,
      color: 'var(--dsw-alias-label-secondary)',
      marginBottom: 6,
    }
    const INPUT = {
      width: '100%',
      boxSizing: 'border-box',
      fontSize: 11,
      padding: '5px 8px',
      borderRadius: 7,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
    }
    const AREA = Object.assign({}, INPUT, { resize: 'vertical', minHeight: 68, lineHeight: 1.55 })
    const SUMMARY_BLOCK = {
      flex: 'none',
      padding: '0 14px 12px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    const SUMMARY_AREA = Object.assign({}, INPUT, {
      minHeight: 58,
      resize: 'vertical',
      lineHeight: 1.5,
    })
    const NUM_GRID = {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      columnGap: 12,
      rowGap: 10,
      marginTop: 14,
    }
    const NUM_CELL = { display: 'flex', alignItems: 'center', gap: 7 }
    const NUM_LABEL = {
      flex: 'none',
      width: 20,
      fontSize: 10.5,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const EMPTY = {
      padding: '42px 18px',
      textAlign: 'center',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 11.5,
      lineHeight: 1.75,
    }
    const LABEL_CHIP = {
      fontSize: 9,
      lineHeight: 1.25,
      margin: 2,
      padding: '1px 4px',
      borderRadius: 3,
      background: 'rgba(0, 0, 0, 0.55)',
      color: '#fff',
      maxWidth: 'calc(100% - 4px)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }

    /** Text drawn inside a box once it has one; wraps to the box width like a caption. */
    const INLINE_TEXT = {
      width: '100%',
      maxHeight: '100%',
      boxSizing: 'border-box',
      padding: '1px 3px',
      borderRadius: 3,
      background: 'rgba(0, 0, 0, 0.45)',
      color: '#ffffff',
      fontSize: 10,
      lineHeight: 1.35,
      wordBreak: 'break-word',
      whiteSpace: 'pre-wrap',
      overflow: 'hidden',
      pointerEvents: 'none',
    }
    /** The in-place editor opened by a double click. */
    const INLINE_EDITOR = {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      margin: 0,
      padding: 3,
      border: 0,
      borderRadius: 4,
      resize: 'none',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 10.5,
      lineHeight: 1.4,
      fontFamily: 'inherit',
      outline: 'none',
    }

    function Styles() {
      return h(
        'style',
        null,
        [
          '.dshCanvasBtn{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.5;padding:4px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}',
          '.dshCanvasBtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
          '.dshCanvasBtn:disabled{opacity:.4;cursor:default}',
          '.dshCanvasBtn[data-tone="primary"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-brand-primary)}',
          '.dshCanvasBtn[data-tone="primary"]:disabled{opacity:.4}',
          '.dshCanvasBtn[data-tone="danger"]:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}',
          '.dshCanvasBoard:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
          '.dshCanvasSeg:hover:not([data-on="true"]){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
          '.dshCanvasSeg:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshCanvasPicker{appearance:none;display:flex;align-items:center;width:100%;box-sizing:border-box;font:inherit;font-size:10px;padding:3px 5px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}',
          '.dshCanvasPicker:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasPicker:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshCanvasOption{appearance:none;display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:10px;padding:4px 6px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.dshCanvasOption:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasOption[data-on="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
          '.dshCanvasBoxItem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshCanvasBoxItem{appearance:none;display:flex;align-items:center;gap:5px;width:100%;box-sizing:border-box;font:inherit;font-size:10px;padding:3px 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;outline:none}',
          '.dshCanvasBoxItem:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasBoxItem:focus{outline:none}',
          '.dshCanvasBoxItem[data-on="true"]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
        ].join(''),
      )
    }

    function boxLabel(box) {
      const meta = box.metadata || {}
      if (meta.type === 'text' && meta.text) return meta.text
      const desc = (meta.desc || '').trim()
      if (desc) return desc
      return meta.type || 'obj'
    }

    /** Short kind label shown beside a box in the list. */
    function boxKind(box) {
      const meta = box.metadata || {}
      if (meta.type === 'text') return '文字'
      if (meta.character) return '人物'
      return '元素'
    }

    /** Leading characters of a box label, for the compact list. */
    function shortLabel(box, max) {
      const text = boxLabel(box) || '未命名'
      const chars = Array.from(text)
      return chars.length > max ? chars.slice(0, max).join('') + '…' : text
    }

    /** Percentage geometry so one layout serves every container width. */
    function boxStyle(box, width, height, selected) {
      return {
        position: 'absolute',
        left: (box.x / width) * 100 + '%',
        top: (box.y / height) * 100 + '%',
        width: (box.width / width) * 100 + '%',
        height: (box.height / height) * 100 + '%',
        boxSizing: 'border-box',
        border: '1.5px solid ' + (selected ? 'var(--dsw-alias-brand-primary)' : 'rgba(0, 0, 0, 0.42)'),
        background: selected ? 'rgba(0, 0, 0, 0.09)' : 'rgba(0, 0, 0, 0.025)',
        borderRadius: 5,
        cursor: 'move',
        display: 'flex',
        alignItems: 'flex-start',
        // No clipping: the handle sits astride the corner, so it must not be cut.
        // The label constrains its own overflow.
        padding: 0,
      }
    }

    /**
     * Bottom-right grab handle on the selected box. A small outlined square is the
     * convention every design tool uses — a solid filled block reads as more
     * content rather than as a control.
     */
    const HANDLE = {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: 10,
      height: 10,
      boxSizing: 'border-box',
      borderRadius: 2,
      border: '1.5px solid var(--dsw-alias-brand-primary)',
      background: 'var(--dsw-alias-bg-base)',
      cursor: 'nwse-resize',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    // ------------------------------------------------------------ draft storage

    const DRAFT_PREFIX = 'dsh.comfy-canvas.draft.'

    /** One draft per workflow file, so switching files never mixes two edits. */
    function draftKeyOf(file) {
      return DRAFT_PREFIX + encodeURIComponent(String(file || ''))
    }

    function readDraft(file) {
      if (!file) return null
      try {
        const raw = localStorage.getItem(draftKeyOf(file))
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && Array.isArray(parsed.boxes) ? parsed : null
      } catch {
        return null
      }
    }

    function writeDraft(file, value) {
      if (!file) return
      try {
        localStorage.setItem(draftKeyOf(file), JSON.stringify(value))
      } catch {
        // Storage unavailable or full: editing still works in memory.
      }
    }

    function clearDraft(file) {
      if (!file) return
      try {
        localStorage.removeItem(draftKeyOf(file))
      } catch {
        // Nothing to remove.
      }
    }

    /** Keep every box inside the canvas with a workable minimum size. */
    function sanitizeBoxes(boxes, width, height) {
      return (Array.isArray(boxes) ? boxes : []).map((box) => {
        const w = Math.max(16, Math.min(Math.round(Number(box.width) || 16), width))
        const h = Math.max(16, Math.min(Math.round(Number(box.height) || 16), height))
        const x = clamp(Math.round(Number(box.x) || 0), 0, Math.max(0, width - w))
        const y = clamp(Math.round(Number(box.y) || 0), 0, Math.max(0, height - h))
        return { ...box, x, y, width: w, height: h }
      })
    }

    /**
     * Build the exact layout prompt JSON MOSSImageLayoutPrompt would emit:
     * 0-1000 normalised boxes become canvas-centred pixels as [y0, x0, y1, x1].
     */
    function buildMossLayout(summary, width, height, boxes) {
      const halfW = Math.floor(width / 2)
      const halfH = Math.floor(height / 2)
      const items = boxes.map((box) => {
        const meta = box.metadata || {}
        const isText = meta.type === 'text'
        const item = {
          label: isText ? 'text' : meta.character ? 'character' : 'object',
          caption: String(meta.desc || '').trim(),
        }
        if (isText) item.text = String(meta.text || '')
        const palette = Array.isArray(meta.palette) ? meta.palette.filter(Boolean) : []
        if (palette.length > 0) item.palette = palette.slice(0, 5)
        // Mirrors nodes_moss_image.py: floor the near edge, ceil the far edge.
        item.bbox = [
          Math.floor((box.y / height) * 1000 * (height / 1000)) - halfH,
          Math.floor((box.x / width) * 1000 * (width / 1000)) - halfW,
          Math.ceil(((box.y + box.height) / height) * 1000 * (height / 1000)) - halfH,
          Math.ceil(((box.x + box.width) / width) * 1000 * (width / 1000)) - halfW,
        ]
        return item
      })
      return {
        summary: { caption: String(summary || '').trim() },
        items,
        bbox_coord_space: 'abs_centralized',
        bbox_format: 'yxyx',
      }
    }

    /**
     * ResolutionSelector's own maths. The `multiple` comes from the workflow node
     * itself (16 in the shipped template) — MOSS rejects anything off the grid, so
     * it is never assumed here.
     */
    function resolveSize(ratioLabel, megapixels, multiple) {
      const match = /^(\d+)\s*:\s*(\d+)/.exec(String(ratioLabel || ''))
      const a = match ? Number(match[1]) : 1
      const b = match ? Number(match[2]) : 1
      const ratio = b === 0 ? 1 : a / b
      const area = Math.max(0.1, Number(megapixels) || 1) * 1024 * 1024
      const step = Math.max(8, Math.round(Number(multiple) || 16))
      const width = Math.max(step, Math.round(Math.sqrt(area * ratio) / step) * step)
      const height = Math.max(step, Math.round(Math.sqrt(area / ratio) / step) * step)
      return { width, height }
    }

    /** Drag a box; the pointer delta is converted back into canvas units. */
    /**
     * Uncontrolled in-place editor, used inside the zoom overlay.
     *
     * The overlay re-renders through a store on every state change, and a
     * controlled textarea rewrites `value` each time — which kills an IME
     * composition. Keeping the DOM as the source of truth lets Chinese input work
     * there, where the plain (controlled) editor in the main pane does not need it.
     */
    function PlainEditor(props) {
      const ref = useRef(null)
      const closed = useRef(false)

      useEffect(() => {
        if (ref.current) ref.current.focus()
      }, [])

      const finish = (value) => {
        if (closed.current) return
        closed.current = true
        props.onCommit(value)
      }

      const cancel = () => {
        if (closed.current) return
        closed.current = true
        props.onCancel()
      }

      return h('textarea', {
        ref,
        defaultValue: props.initial,
        style: INLINE_EDITOR,
        onPointerDown: (event) => event.stopPropagation(),
        onKeyDown: (event) => {
          // Enter / Escape belong to the IME while a composition is open.
          if (event.nativeEvent && event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            finish(ref.current ? ref.current.value : '')
          }
        },
        onBlur: () => {
          // Capture the value first: the node may unmount before the timer runs.
          const value = ref.current ? ref.current.value : ''
          window.setTimeout(() => {
            if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return
            finish(value)
          }, 160)
        },
      })
    }

    function Board(props) {
      const boardRef = useRef(null)
      const [drag, setDrag] = useState(null)

      useEffect(() => {
        if (!drag) return undefined
        const onMove = (event) => {
          const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null
          if (!rect || rect.width === 0 || rect.height === 0) return
          const dx = ((event.clientX - drag.startX) / rect.width) * props.width
          const dy = ((event.clientY - drag.startY) / rect.height) * props.height
          const box = props.boxes[drag.index]
          if (!box) return
          if (drag.mode === 'resize') {
            const minimum = 16
            const maxWidth = Math.max(minimum, props.width - box.x)
            const maxHeight = Math.max(minimum, props.height - box.y)
            props.onChange(drag.index, {
              width: Math.round(clamp(drag.origW + dx, minimum, maxWidth)),
              height: Math.round(clamp(drag.origH + dy, minimum, maxHeight)),
            })
            return
          }
          props.onChange(drag.index, {
            x: Math.round(clamp(drag.origX + dx, 0, props.width - box.width)),
            y: Math.round(clamp(drag.origY + dy, 0, props.height - box.height)),
          })
        }
        const onUp = () => setDrag(null)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }, [drag, props])

      const ratio = props.width / props.height

      return h(
        'div',
        {
          ref: boardRef,
          className: 'dshCanvasBoard',
          style: Object.assign({}, BOARD, {
            width: '100%',
            maxWidth: 'calc(' + (props.maxHeight || BOARD_MAX_HEIGHT) + ' * ' + ratio + ')',
            aspectRatio: props.width + ' / ' + props.height,
          }),
          onPointerDown: (event) => {
            // Left click only: a right press belongs to the context menu.
            if (event.button !== 0) return
            props.onSelect(null)
          },
          onContextMenu: (event) => {
            // Empty canvas: keep the browser menu suppressed so the gesture stays
            // consistent with right-clicking a box.
            event.preventDefault()
          },
        },
        // Sits under every box and never takes pointer events, so it stays a
        // visual underlay to trace against.
        props.reference
          ? h('img', {
              src: props.reference.url,
              alt: '',
              draggable: false,
              onError: () => {
                if (props.onReferenceError) props.onReferenceError()
              },
              style: {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: props.reference.opacity,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })
          : null,
        ...props.boxes.map((box, index) =>
          h(
            'div',
            {
              key: index,
              // Lifting the selected box keeps an overlapping neighbour from
              // burying it, without touching the array order MOSS cares about.
              style: Object.assign(
                {},
                boxStyle(box, props.width, props.height, props.selected === index),
                { zIndex: props.selected === index ? 20 : 1 },
              ),
              onPointerDown: (event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                props.onSelect(index)
                setDrag({
                  mode: 'move',
                  index,
                  startX: event.clientX,
                  startY: event.clientY,
                  origX: box.x,
                  origY: box.y,
                })
              },
              onContextMenu: (event) => {
                event.preventDefault()
                event.stopPropagation()
                props.onRemove(index)
              },
              onDoubleClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                setDrag(null)
                props.onEditStart(index)
              },
            },
            props.editing === index
              ? props.plainEditor
                ? h(PlainEditor, {
                    initial: props.draft,
                    onCommit: (value) => props.onEditCommit(value),
                    onCancel: props.onEditCancel,
                  })
                : h('textarea', {
                    autoFocus: true,
                    value: props.draft,
                    style: INLINE_EDITOR,
                    onPointerDown: (event) => event.stopPropagation(),
                    onChange: (event) => props.onDraftChange(event.target.value),
                    onBlur: () => props.onEditCommit(),
                    onKeyDown: (event) => {
                      // Enter/Escape during an IME composition belong to the IME.
                      const busy = event.nativeEvent ? event.nativeEvent.isComposing : event.isComposing
                      if (busy) return
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        props.onEditCancel()
                      }
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        props.onEditCommit()
                      }
                    },
                  })
              : (() => {
                  const meta = box.metadata || {}
                  // Show the same field the double click edits.
                  const body = meta.type === 'text' ? meta.text || '' : meta.desc || ''
                  return body
                    ? h('div', { style: INLINE_TEXT }, body)
                    : h('span', { style: LABEL_CHIP }, boxLabel(box))
                })(),
            props.selected === index && props.editing !== index
              ? h('div', {
                  style: HANDLE,
                  title: '拖动调整大小',
                  onPointerDown: (event) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    event.stopPropagation()
                    setDrag({
                      mode: 'resize',
                      index,
                      startX: event.clientX,
                      startY: event.clientY,
                      origW: box.width,
                      origH: box.height,
                    })
                  },
                })
              : null,
          ),
        ),
      )
    }

    /**
     * A self-drawn dropdown. A native <select> renders its open list itself, so
     * newly fetched options cannot appear until it is reopened; this one re-renders
     * from React state while open.
     */
    function Dropdown(props) {
      const [open, setOpen] = useState(false)
      const boxRef = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false)
        }
        const onKey = (event) => {
          if (event.isComposing) return
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const current = props.options.find((option) => option.value === props.value)

      return h(
        'div',
        { ref: boxRef, style: { position: 'relative', flex: '1 1 0', minWidth: 0 } },
        h(
          'button',
          {
            type: 'button',
            className: 'dshCanvasPicker',
            title: props.title,
            onClick: () => {
              if (!open && props.onOpen) props.onOpen()
              setOpen(!open)
            },
          },
          h(
            'span',
            { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            current ? current.label : '',
          ),
        ),
        open
          ? h(
              'div',
              { style: DROPDOWN },
              ...props.options.map((option) =>
                h(
                  'button',
                  {
                    key: option.value,
                    type: 'button',
                    className: 'dshCanvasOption',
                    'data-on': option.value === props.value ? 'true' : 'false',
                    title: option.label,
                    onClick: () => {
                      props.onPick(option.value)
                      setOpen(false)
                    },
                  },
                  option.label,
                ),
              ),
            )
          : null,
      )
    }

    /**
     * Contains a crash inside the zoom view. Without it a throwing child blanks the
     * whole slot entry, which looks like the panel silently disappearing.
     */
    class ZoomBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) {
          return h(
            'div',
            {
              style: {
                position: 'fixed',
                inset: 0,
                zIndex: 1200,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: 24,
                background: 'rgba(0, 0, 0, 0.72)',
                color: '#ffffff',
                fontSize: 12,
                lineHeight: 1.6,
                textAlign: 'center',
              },
            },
            h('span', { style: { fontWeight: 600 } }, '放大视图渲染失败'),
            h('span', { style: { opacity: 0.85, maxWidth: 520, wordBreak: 'break-word' } },
              String((this.state.error && this.state.error.message) || this.state.error)),
            h('button', {
              className: 'dshCanvasBtn',
              onClick: () => this.setState({ error: null }),
            }, '重试'),
          )
        }
        return this.props.children
      }
    }

    /**
     * Full-screen working view: a larger canvas beside a flat list of every box,
     * so an overlapping box is always reachable even when it cannot be clicked in
     * the pile.
     */
    function ZoomOverlay(props) {
      const onClose = props.onClose
      const [localEditing, setLocalEditing] = useState(null)
      const [localDraft, setLocalDraft] = useState('')
      const [confirmRemove, setConfirmRemove] = useState(false)

      useEffect(() => {
        if (!confirmRemove) return undefined
        const timer = setTimeout(() => setConfirmRemove(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmRemove])

      /** Two-step delete: the second press within four seconds really removes it. */
      const requestRemove = () => {
        if (!confirmRemove) {
          setConfirmRemove(true)
          return
        }
        setConfirmRemove(false)
        props.onRemove(props.selected)
      }

      /** Opens the in-place editor from the box the user just double clicked. */
      const startLocalEdit = (index) => {
        const box = props.boxes[index]
        if (!box) return
        const meta = box.metadata || {}
        setLocalEditing(index)
        setLocalDraft(meta.type === 'text' ? meta.text || '' : meta.desc || '')
      }

      const cancelLocalEdit = () => {
        setLocalEditing(null)
        setLocalDraft('')
      }

      const commitLocalEdit = (value) => {
        const index = localEditing
        setLocalEditing(null)
        setLocalDraft('')
        if (index === null) return
        const box = props.boxes[index]
        if (!box) return
        const isText = Boolean((box.metadata || {}).type === 'text')
        props.onChange(index, { metadata: isText ? { text: value } : { desc: value } })
      }

      useEffect(() => {
        const onKey = (event) => {
          // An IME uses Escape to cancel a candidate; that must not close the panel.
          if (event.isComposing) return
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [])

      const selectedBox = props.selected !== null ? props.boxes[props.selected] : null

      return h(
        'div',
        { style: OVERLAY, onClick: onClose, role: 'presentation' },
        h(
          'div',
          {
            style: PANEL,
            role: 'dialog',
            'aria-label': 'MOSS 画框大视图',
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { style: PANEL_HEAD },
            h('span', { style: { fontWeight: 600 } }, '画框 MOSS · ' + props.width + ' × ' + props.height),
            h('span', { style: { flex: 1 } }),
            h('span', { style: Object.assign({}, CANVAS_SUB, { fontSize: 10.5 }) }, props.boxes.length + ' 个框 · Esc 关闭'),
            h('button', { className: 'dshCanvasBtn', onClick: onClose }, '关闭'),
          ),
          h(
            'div',
            { style: PANEL_BODY },
            h(
              'div',
              { style: PANEL_STAGE },
              h(Board, {
                width: props.width,
                height: props.height,
                boxes: props.boxes,
                selected: props.selected,
                onSelect: props.onSelect,
                onChange: props.onChange,
                onRemove: props.onRemove,
                // The overlay owns its editing session: routing it through the
                // store costs a publish/notify round trip, and a stale closure
                // there makes a double click silently do nothing.
                editing: localEditing,
                draft: localDraft,
                // Plain (uncontrolled) editor, so the store re-renders cannot
                // clobber an in-flight IME composition.
                plainEditor: true,
                reference: props.reference,
                onReferenceError: props.onReferenceError,
                onEditStart: startLocalEdit,
                onDraftChange: setLocalDraft,
                onEditCommit: commitLocalEdit,
                onEditCancel: cancelLocalEdit,
                maxHeight: '76vh',
              }),
            ),
            h(
              'div',
              { style: PANEL_SIDE },
              h(
                'div',
                { style: PANEL_LIST },
                ...props.boxes.map((box, index) =>
                  h(
                    'button',
                    {
                      key: index,
                      type: 'button',
                      className: 'dshCanvasOption',
                      'data-on': props.selected === index ? 'true' : 'false',
                      style: LIST_ROW,
                      title: boxLabel(box),
                      onClick: () => props.onSelect(index),
                    },
                    h('span', { style: { flex: 'none', opacity: 0.65, fontSize: 9 } }, String(index + 1)),
                    h(
                      'span',
                      {
                        style: {
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        },
                      },
                      boxLabel(box) || '未命名',
                    ),
                    h('span', { style: { flex: 'none', fontSize: 9, opacity: 0.7 } }, boxKind(box)),
                  ),
                ),
              ),
              selectedBox
                ? (() => {
                    const meta = selectedBox.metadata || {}
                    const isText = meta.type === 'text'
                    const patch = (next) => props.onChange(props.selected, { metadata: { ...meta, ...next } })
                    return h(
                      'div',
                      { style: ZOOM_INFO },
                      h(
                        'div',
                        { style: ZOOM_INFO_TITLE },
                        '第 ' + (props.selected + 1) + ' 个框 · ' + boxKind(selectedBox),
                      ),
                      h(
                        'div',
                        { style: ZOOM_SEG_ROW },
                        h(
                          'button',
                          { type: 'button', style: isText ? SEGMENT : SEGMENT_ON, onClick: () => patch({ type: 'obj' }) },
                          '画面元素',
                        ),
                        h(
                          'button',
                          { type: 'button', style: isText ? SEGMENT_ON : SEGMENT, onClick: () => patch({ type: 'text' }) },
                          '文字',
                        ),
                      ),
                      isText
                        ? null
                        : h(
                            'label',
                            { style: ZOOM_CHECK_ROW },
                            h('input', {
                              type: 'checkbox',
                              checked: Boolean(meta.character),
                              onChange: (event) => patch({ character: event.target.checked }),
                            }),
                            '标记为人物',
                          ),
                      h('div', { style: ZOOM_INFO_BODY }, boxLabel(selectedBox) || '未命名'),
                      h('div', { style: ZOOM_INFO_HINT }, '双击画框可直接编辑，改完点框外保存'),
                      h(
                        'div',
                        { style: { display: 'flex', gap: 6, marginTop: 4 } },
                        h(
                          'button',
                          {
                            className: 'dshCanvasBtn',
                            onClick: () => {
                              if (props.onAdd) props.onAdd()
                            },
                          },
                          '加框',
                        ),
                        h(
                          'button',
                          {
                            className: 'dshCanvasBtn',
                            'data-tone': confirmRemove ? 'danger' : undefined,
                            onClick: requestRemove,
                          },
                          confirmRemove ? '确认删除？' : '删除',
                        ),
                      ),
                    )
                  })()
                : h('div', { style: EMPTY }, '点选一个框'),
            ),
          ),
        ),
      )
    }

    /**
     * The canvas tab and the frame-wide overlay seat sit on different contexts, so
     * a tiny store carries the open flag and the working copy between them.
     */
    const zoomStore = (() => {
      let state = null
      const listeners = new Set()
      return {
        get: () => state,
        set(next) {
          state = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    })()

    /** Rendered in the frame-wide overlay seat, outside every column container. */
    function ZoomHost() {
      const [state, setState] = useState(zoomStore.get())
      useEffect(() => zoomStore.subscribe(() => setState(zoomStore.get())), [])
      if (!state || !state.open) return null
      return h(ZoomBoundary, null, h(ZoomOverlay, state))
    }

    function Inspector(props) {
      const box = props.box
      const meta = box.metadata || {}
      const type = meta.type || 'obj'
      const patchMeta = (patch) => props.onChange({ metadata: { ...meta, ...patch } })
      const patchBox = (patch) => props.onChange(patch)

      const numeric = (key, label) =>
        h(
          'div',
          { key, style: NUM_CELL },
          h('span', { style: NUM_LABEL }, label),
          h('input', {
            type: 'number',
            value: box[key],
            style: Object.assign({}, INPUT, NUM),
            onChange: (event) => patchBox({ [key]: Number(event.target.value) || 0 }),
          }),
        )

      return h(
        'div',
        { style: INSPECTOR },
        h(
          'div',
          { style: INSPECTOR_HEAD },
          h('span', { style: { fontWeight: 600, fontSize: 12 } }, '画框 ' + (props.index + 1)),
          h('span', { style: Object.assign({}, NUM, { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' }) },
            box.width + ' × ' + box.height),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dshCanvasBtn', 'data-tone': 'danger', onClick: props.onRemove }, '删除'),
        ),
        h(
          'div',
          { style: { marginBottom: 16 } },
          h('span', { style: FIELD_LABEL }, '类型'),
          h(
            'div',
            { style: SEGMENT_WRAP },
            h(
              'button',
              {
                className: 'dshCanvasSeg',
                'data-on': type === 'obj' ? 'true' : 'false',
                style: type === 'obj' ? SEGMENT_ON : SEGMENT,
                onClick: () => patchMeta({ type: 'obj' }),
              },
              'obj · 画面元素',
            ),
            h(
              'button',
              {
                className: 'dshCanvasSeg',
                'data-on': type === 'text' ? 'true' : 'false',
                style: type === 'text' ? SEGMENT_ON : SEGMENT,
                onClick: () => patchMeta({ type: 'text' }),
              },
              'text · 文字',
            ),
          ),
        ),
        type === 'text'
          ? h(
              'div',
              { style: { marginBottom: 14 } },
              h('label', { style: FIELD_LABEL }, '文字'),
              h('input', {
                value: meta.text || '',
                style: INPUT,
                placeholder: '框里要出现的文字',
                onChange: (event) => patchMeta({ text: event.target.value }),
              }),
            )
          : h(
              'div',
              { style: { marginBottom: 14 } },
              h(
                'label',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 11,
                    cursor: 'pointer',
                    color: 'var(--dsw-alias-label-primary)',
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(meta.character),
                  onChange: (event) => patchMeta({ character: event.target.checked }),
                }),
                h('span', null, '标记为人物（character）'),
              ),
            ),
        h(
          'div',
          null,
          h(
            'label',
            { style: FIELD_LABEL },
            '描述',
            String(meta.desc || '').trim()
              ? null
              : h(
                  'span',
                  { style: { color: 'var(--dsw-alias-state-error-primary)', marginLeft: 6 } },
                  '必填',
                ),
          ),
          h('textarea', {
            value: meta.desc || '',
            style: Object.assign({}, AREA, {
              borderColor: String(meta.desc || '').trim()
                ? 'var(--dsw-alias-border-l2)'
                : 'var(--dsw-alias-state-error-primary)',
            }),
            placeholder: meta.type === 'text'
              ? '这个字长什么样：字体、颜色、粗细、有无底色边框'
              : '这个框里画什么（会作为该框的 caption）',
            onChange: (event) => patchMeta({ desc: event.target.value }),
          }),
        ),
        h('div', { style: NUM_GRID }, numeric('x', 'x'), numeric('y', 'y'), numeric('width', '宽'), numeric('height', '高')),
      )
    }

    function CanvasTab(props) {
      const [files, setFiles] = useState(null)
      const [file, setFile] = useState('')
      const [nodeId, setNodeId] = useState(null)
      const [size, setSize] = useState({ width: 1024, height: 1024 })
      const [boxes, setBoxes] = useState([])
      const [selected, setSelected] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [status, setStatus] = useState('')
      const [error, setError] = useState('')
      const [ratio, setRatio] = useState('')
      const [megapixels, setMegapixels] = useState(1)
      const [multiple, setMultiple] = useState(16)
      const [summary, setSummary] = useState('')
      const [ratioOptions, setRatioOptions] = useState([])
      const [mpMeta, setMpMeta] = useState({ min: 0.1, max: 16, step: 0.1 })
      const [confirmSend, setConfirmSend] = useState(false)
      const [confirmReset, setConfirmReset] = useState(false)
      const [zoomMode, setZoomMode] = useState(false)
      const [reloadNonce, setReloadNonce] = useState(0)
      const [lastRemoved, setLastRemoved] = useState(null)
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState('')
      const [referenceOptions, setReferenceOptions] = useState([])
      const [referenceUrl, setReferenceUrl] = useState('')
      const [referenceKind, setReferenceKind] = useState('')
      const [referenceName, setReferenceName] = useState('')
      const [referenceOpacity, setReferenceOpacity] = useState(55)
      /** Set by the polling effect so opening the dropdown can refresh on demand. */
      const refreshAlbum = useRef(null)

      // Reference images come from the ComfyUI album plugin when it is enabled.
      // Polled so a render that finishes while the board is open shows up without
      // a reload.
      useEffect(() => {
        let alive = true
        let timer = null

        const load = async () => {
          try {
            const res = await fetch('/plugin/comfy-status/album', { cache: 'no-store' })
            const data = await res.json()
            // The album endpoint answers { up, count, items, running } and carries
            // no `ok` flag, unlike this plugin's own routes.
            if (!alive || !data) return
            const items = Array.isArray(data.items) ? data.items : []
            const options = []
            for (const item of items) {
              for (const image of item.images || []) {
                if (image && image.url) {
                  options.push({ url: image.url, label: image.filename || image.url })
                }
              }
            }
            const signature = options.map((option) => option.url).join('|')
            setReferenceOptions((previous) => {
              // Keep the same array when nothing changed, so the panel does not
              // re-render every poll.
              return previous.map((option) => option.url).join('|') === signature ? previous : options
            })
          } catch {
            // The album plugin may be switched off; the file picker still works.
          } finally {
            if (alive) timer = setTimeout(load, 15000)
          }
        }

        load()
        refreshAlbum.current = load
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      // Revoke the previous blob URL whenever the local reference is replaced.
      useEffect(() => {
        return () => {
          if (referenceKind === 'file' && referenceUrl && referenceUrl.startsWith('blob:')) {
            URL.revokeObjectURL(referenceUrl)
          }
        }
      }, [referenceKind, referenceUrl])

      const pickReferenceFile = (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        setReferenceUrl(URL.createObjectURL(file))
        setReferenceKind('file')
        setReferenceName(file.name)
        setDirty(true)
      }

      const clearReference = () => {
        setReferenceUrl('')
        setReferenceKind('')
        setReferenceName('')
        setDirty(true)
      }

      const chooseReference = (value) => {
        if (!value) {
          clearReference()
          return
        }
        setReferenceUrl(value)
        setReferenceKind(value.startsWith('blob:') ? 'file' : 'album')
        setDirty(true)
      }

      useEffect(() => {
        if (!confirmReset) return undefined
        const timer = setTimeout(() => setConfirmReset(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmReset])

      /** Drop the stored draft and reload the workflow's own values. */
      const requestReset = () => {
        if (!confirmReset) {
          setConfirmReset(true)
          return
        }
        setConfirmReset(false)
        clearDraft(file)
        setReloadNonce((value) => value + 1)
      }

      useEffect(() => {
        if (!confirmSend) return undefined
        const timer = setTimeout(() => setConfirmSend(false), 4000)
        return () => clearTimeout(timer)
      }, [confirmSend])

      useEffect(() => {
        let alive = true
        fetch(API + '/resolutions', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive || !data.ok) return
            setRatioOptions(data.ratios || [])
            if (data.megapixels && typeof data.megapixels.min === 'number') {
              setMpMeta({
                min: data.megapixels.min,
                max: data.megapixels.max,
                step: data.megapixels.step,
              })
            }
          })
          .catch(() => {
            // Without the list the canvas still works at its stored size.
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        let alive = true
        fetch(API + '/workflows', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive) return
            if (!data.ok) throw new Error(data.error || '无法读取工作流目录')
            setFiles(data.files || [])
            if ((data.files || []).length > 0) setFile(data.files[0].name)
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        if (!file) return undefined
        let alive = true
        setError('')
        setStatus('')
        fetch(API + '/workflow?file=' + encodeURIComponent(file), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive) return
            if (!data.ok) throw new Error(data.error || '无法读取工作流')
            const wf = data.workflow
            const node = (wf.nodes || []).find((item) => item.type === NODE_TYPE)
            if (!node) {
              setNodeId(null)
              setBoxes([])
              setSelected(null)
              setSummary('')
              setDirty(false)
              return
            }
            const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
            const width = typeof values[0] === 'number' ? values[0] : 1024
            const height = typeof values[1] === 'number' ? values[1] : 1024
            const list = Array.isArray(values[2]) ? values[2] : []
            const resolver = (wf.nodes || []).find((item) => item.type === 'ResolutionSelector')
            const resolverValues = resolver && Array.isArray(resolver.widgets_values) ? resolver.widgets_values : []
            const wfRatio = typeof resolverValues[0] === 'string' ? resolverValues[0] : ''
            const wfMegapixels = typeof resolverValues[1] === 'number' ? resolverValues[1] : 1
            const wfMultiple = typeof resolverValues[2] === 'number' ? resolverValues[2] : 16
            // The whole-image caption lives on MOSSImageLayoutPrompt's `prompt`.
            const layoutNode = (wf.nodes || []).find((item) => item.type === 'MOSSImageLayoutPrompt')
            const wfSummary =
              layoutNode && Array.isArray(layoutNode.widgets_values) && typeof layoutNode.widgets_values[0] === 'string'
                ? layoutNode.widgets_values[0]
                : ''

            // An unsent draft wins over the file: it is what the user last saw.
            const draft = readDraft(file)
            const useWidth = draft && typeof draft.width === 'number' ? draft.width : width
            const useHeight = draft && typeof draft.height === 'number' ? draft.height : height
            const useBoxes = draft ? draft.boxes : list

            setNodeId(node.id)
            setSize({ width: useWidth, height: useHeight })
            setRatio(draft && typeof draft.ratio === 'string' ? draft.ratio : wfRatio)
            setMegapixels(draft && typeof draft.megapixels === 'number' ? draft.megapixels : wfMegapixels)
            setMultiple(draft && typeof draft.multiple === 'number' ? draft.multiple : wfMultiple)
            setSummary(draft && typeof draft.summary === 'string' ? draft.summary : wfSummary)
            setBoxes(sanitizeBoxes(useBoxes, useWidth, useHeight))
            setSelected(useBoxes.length > 0 ? 0 : null)
            // A local file's blob URL dies with the page, so only album references
            // are restored; the opacity choice still comes back either way.
            const draftKind = draft && typeof draft.referenceKind === 'string' ? draft.referenceKind : ''
            if (draftKind === 'album' && typeof draft.referenceUrl === 'string' && draft.referenceUrl) {
              setReferenceUrl(draft.referenceUrl)
              setReferenceKind('album')
              setReferenceName(typeof draft.referenceName === 'string' ? draft.referenceName : '')
            } else if (draft) {
              setReferenceUrl('')
              setReferenceKind('')
              setReferenceName('')
            }
            if (draft && typeof draft.referenceOpacity === 'number') {
              setReferenceOpacity(clamp(draft.referenceOpacity, 0, 100))
            }
            setDirty(Boolean(draft))
            if (draft) setStatus('已恢复上次未发送的编辑')
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [file, reloadNonce])

      // Persist the working copy so leaving and returning to the tab loses nothing.
      // Only dirty state is stored: a untouched view keeps no draft, which is what
      // makes "reset" stay clean.
      useEffect(() => {
        if (!file || nodeId === null || !dirty) return undefined
        const timer = setTimeout(() => {
          writeDraft(file, {
            width: size.width,
            height: size.height,
            ratio,
            megapixels,
            multiple,
            summary,
            boxes,
            referenceUrl,
            referenceKind,
            referenceName,
            referenceOpacity,
          })
        }, 400)
        return () => clearTimeout(timer)
      }, [file, nodeId, dirty, size, ratio, megapixels, multiple, summary, boxes, referenceUrl, referenceKind, referenceName, referenceOpacity])

      const changeBox = (index, patch) => {
        setBoxes((current) =>
          current.map((box, at) =>
            at === index ? { ...box, ...patch, metadata: { ...box.metadata, ...(patch.metadata || {}) } } : box,
          ),
        )
        setDirty(true)
      }

      const addBox = () => {
        const next = {
          x: Math.round(size.width * 0.1),
          y: Math.round(size.height * 0.1),
          width: Math.round(size.width * 0.3),
          height: Math.round(size.height * 0.3),
          metadata: { type: 'obj', text: '', desc: '', palette: [] },
        }
        setBoxes((current) => [...current, next])
        setSelected(boxes.length)
        setDirty(true)
      }

      const removeBox = (index) => {
        const removed = boxes[index]
        if (!removed) return
        setBoxes((current) => current.filter((_, at) => at !== index))
        setSelected(null)
        setEditing(null)
        setDirty(true)
        // Keep the last removal so a right-click slip is one click away from undone.
        setLastRemoved({ box: removed, index })
      }

      /** Double click edits what that box type actually carries. */
      const startEdit = (index) => {
        const box = boxes[index]
        if (!box) return
        const meta = box.metadata || {}
        setSelected(index)
        setEditing(index)
        // A text box prints its text; every other box only has a description.
        setDraft(meta.type === 'text' ? meta.text || '' : meta.desc || '')
      }

      const commitEdit = (value) => {
        if (editing === null) return
        const index = editing
        const box = boxes[index]
        const isText = Boolean(box && (box.metadata || {}).type === 'text')
        // The editor is uncontrolled and passes the DOM value; fall back to the
        // stored draft when nothing was passed.
        const finalValue = typeof value === 'string' ? value : draft
        setEditing(null)
        changeBox(index, { metadata: isText ? { text: finalValue } : { desc: finalValue } })
      }

      const cancelEdit = () => {
        setEditing(null)
        setDraft('')
      }

      const undoRemove = () => {
        if (!lastRemoved) return
        const { box, index } = lastRemoved
        setBoxes((current) => {
          const next = [...current]
          next.splice(Math.min(index, next.length), 0, box)
          return next
        })
        setSelected(Math.min(index, boxes.length))
        setLastRemoved(null)
        setDirty(true)
      }

      /**
       * Change the canvas ratio. The boxes are absolute pixel coordinates, so a
       * new canvas size would strand them; every box is scaled by the same
       * factor to keep the composition intact.
       */
      const applyResolution = (nextRatio, nextMegapixels) => {
        const target = resolveSize(nextRatio, nextMegapixels, multiple)
        if (target.width === size.width && target.height === size.height) {
          setRatio(nextRatio)
          setMegapixels(nextMegapixels)
          return
        }
        const sx = target.width / Math.max(1, size.width)
        const sy = target.height / Math.max(1, size.height)
        setBoxes((current) =>
          current.map((box) => ({
            ...box,
            x: Math.round(clamp(box.x * sx, 0, Math.max(0, target.width - 1))),
            y: Math.round(clamp(box.y * sy, 0, Math.max(0, target.height - 1))),
            width: Math.max(8, Math.round(box.width * sx)),
            height: Math.max(8, Math.round(box.height * sy)),
          })),
        )
        setSize(target)
        setRatio(nextRatio)
        setMegapixels(nextMegapixels)
        setDirty(true)
      }

      /**
       * Hand the canvas to the agent instead of writing anything back to ComfyUI.
       * The slot exposes the session input actions, so the payload lands in the
       * composer and is submitted in one step.
       */
      const sendToAgent = () => {
        const actions = props.inputActions
        if (!actions) {
          setStatus('当前面板没有可用的会话输入通道')
          return
        }
        if (boxes.length === 0) {
          setStatus('画布上还没有框')
          return
        }
        // Sending replaces the composer draft, so the button asks once first.
        if (!confirmSend) {
          setConfirmSend(true)
          return
        }
        setConfirmSend(false)
        const layout = buildMossLayout(summary, size.width, size.height, boxes)
        const emptyCaptions = boxes.filter((box) => !String((box.metadata || {}).desc || '').trim()).length
        const text = [
          'MOSS 画板（' +
            file +
            ' · ' +
            size.width +
            '×' +
            size.height +
            ' · ' +
            boxes.length +
            ' 个框' +
            (emptyCaptions > 0 ? '，其中 ' + emptyCaptions + ' 个还没写 desc' : '') +
            '）',
          '```json',
          JSON.stringify(layout, null, 2),
          '```',
          'caption 就是每个框的 desc，空的请补；bbox 已按 abs_centralized / yxyx 算好，不要改动。',
        ].join('\n')
        try {
          actions.setDraft(text)
          actions.persistDraft()
          actions.submit()
          setDirty(false)
          setStatus('已发给 agent')
        } catch (err) {
          setStatus('')
          setError(String((err && err.message) || err))
        }
      }

      const hasNode = nodeId !== null

      // Hand the working copy to the frame-wide overlay host. It renders outside
      // this pane, so a fixed overlay here would be clipped by the column.
      useEffect(() => {
        zoomStore.set({
          open: zoomMode,
          width: size.width,
          height: size.height,
          boxes,
          selected,
          editing,
          draft,
          reference: referenceUrl ? { url: referenceUrl, opacity: referenceOpacity / 100 } : null,
          onReferenceError: clearReference,
          onChange: changeBox,
          onRemove: removeBox,
          onSelect: setSelected,
          onEditStart: startEdit,
          onDraftChange: setDraft,
          onEditCommit: commitEdit,
          onEditCancel: cancelEdit,
          onAdd: addBox,
          onClose: () => setZoomMode(false),
        })
      }, [zoomMode, size.width, size.height, boxes, selected, editing, draft, referenceUrl, referenceOpacity])

      useEffect(() => () => zoomStore.set(null), [])

      let body
      if (error) body = h('div', { style: EMPTY }, error)
      else if (files === null) body = h('div', { style: EMPTY }, '正在读取工作流…')
      else if (files.length === 0) body = h('div', { style: EMPTY }, '工作流目录是空的')
      else if (!hasNode)
        body = h(
          'div',
          { style: EMPTY },
          '这个工作流里没有 CreateBoundingBoxes 节点',
          h('div', { style: { marginTop: 8 } }, '先在 ComfyUI 里打开带画板的模板并另存为工作流'),
        )
      else
        body = h(
          React.Fragment,
          null,
          h(
            'div',
            { style: STAGE },
            h(
              'div',
              { style: RES_ROW },
              ratioOptions.length > 0
                ? h(
                    React.Fragment,
                    null,
                    h('span', { style: RES_LABEL }, '比例'),
                    h(
                      'select',
                      {
                        value: ratio || ratioOptions[0],
                        style: RES_SELECT,
                        title: '画布比例',
                        onChange: (event) => applyResolution(event.target.value, megapixels),
                      },
                      ...ratioOptions.map((option) => h('option', { key: option, value: option }, option)),
                    ),
                    h('input', {
                      type: 'number',
                      value: megapixels,
                      min: mpMeta.min,
                      max: mpMeta.max,
                      step: mpMeta.step,
                      style: Object.assign({}, RES_MP, NUM),
                      title: '百万像素',
                      onChange: (event) => {
                        const next = Number(event.target.value)
                        if (Number.isFinite(next) && next > 0) {
                          applyResolution(ratio || ratioOptions[0], next)
                        }
                      },
                    }),
                    h('span', { style: RES_LABEL }, 'MP'),
                  )
                : null,
              h('span', { style: RES_LABEL }, '参考'),
              h(Dropdown, {
                title: '参考图（来自 ComfyUI 相册）',
                value: referenceUrl,
                options: [
                  { value: '', label: '无' },
                  ...referenceOptions.map((option) => ({ value: option.url, label: option.label })),
                  ...(referenceKind === 'file' && referenceUrl
                    ? [{ value: referenceUrl, label: '本地 · ' + referenceName }]
                    : []),
                ],
                onOpen: () => {
                  if (refreshAlbum.current) refreshAlbum.current()
                },
                onPick: chooseReference,
              }),
              h(
                'label',
                {
                  className: 'dshCanvasBtn',
                  style: { cursor: 'pointer', margin: 0, padding: '3px 8px' },
                  title: '选择本地图片作为参考',
                },
                h('input', {
                  type: 'file',
                  accept: 'image/*',
                  style: { display: 'none' },
                  onChange: pickReferenceFile,
                }),
                '本地',
              ),
              h('input', {
                type: 'number',
                min: 0,
                max: 100,
                step: 5,
                value: referenceOpacity,
                style: Object.assign({}, RES_MP, NUM, { width: 42 }),
                title: '参考图不透明度 %',
                onChange: (event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) {
                    setReferenceOpacity(clamp(next, 0, 100))
                    setDirty(true)
                  }
                },
              }),
              h('span', { style: RES_LABEL }, '%'),
            ),
            h(
              'div',
              { style: STAGE_MAIN },
              h('div', { style: BOARD_WRAP }, h(Board, {
                width: size.width,
                height: size.height,
                boxes,
                selected,
                onSelect: setSelected,
                onChange: changeBox,
                onRemove: removeBox,
                editing,
                draft,
                reference: referenceUrl ? { url: referenceUrl, opacity: referenceOpacity / 100 } : null,
                onReferenceError: clearReference,
                onEditStart: startEdit,
                onDraftChange: setDraft,
                onEditCommit: commitEdit,
                onEditCancel: cancelEdit,
              })),
              boxes.length > 0
                ? h(
                    'div',
                    { style: BOX_LIST },
                    ...boxes.map((box, index) =>
                      h(
                        'button',
                        {
                          key: index,
                          type: 'button',
                          className: 'dshCanvasBoxItem',
                          'data-on': selected === index ? 'true' : 'false',
                          title: boxLabel(box),
                          onClick: () => setSelected(index),
                        },
                        h('span', { style: BOX_LIST_INDEX }, String(index + 1)),
                        h('span', { style: BOX_LIST_TEXT }, shortLabel(box, 5)),
                      ),
                    ),
                  )
                : null,
            ),
            h(
              'div',
              { style: STAGE_META },
              h('span', { style: NUM }, size.width + ' × ' + size.height),
              h('span', null, boxes.length + ' 个框'),
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'dshCanvasBtn', onClick: () => setZoomMode(true) }, '放大'),
              h('button', { className: 'dshCanvasBtn', onClick: addBox }, '加框'),
            ),
          ),
          h(
            'div',
            { style: SUMMARY_BLOCK },
            h(
              'label',
              { style: FIELD_LABEL },
              '整图描述',
              String(summary || '').trim()
                ? null
                : h(
                    'span',
                    { style: { color: 'var(--dsw-alias-state-error-primary)', marginLeft: 6 } },
                    '必填',
                  ),
            ),
            h('textarea', {
              value: summary,
              style: Object.assign({}, SUMMARY_AREA, {
                borderColor: String(summary || '').trim()
                  ? 'var(--dsw-alias-border-l2)'
                  : 'var(--dsw-alias-state-error-primary)',
              }),
              placeholder: '整张图讲什么：画风、光线、背景、谁在哪',
              onChange: (event) => {
                setSummary(event.target.value)
                setDirty(true)
              },
            }),
          ),
          selected !== null && boxes[selected]
            ? h(Inspector, {
                box: boxes[selected],
                index: selected,
                onChange: (patch) => changeBox(selected, patch),
                onRemove: () => removeBox(selected),
              })
            : h('div', { style: EMPTY }, '点选画布里的框来编辑'),
        )

      return h(
        'div',
        { style: SHELL },
        h(Styles),
        h(
          'div',
          { style: HEAD },
          h(
            'select',
            {
              value: file,
              style: FILE_SELECT,
              onChange: (event) => setFile(event.target.value),
              disabled: !files || files.length === 0,
            },
            ...(files || []).map((item) => h('option', { key: item.name, value: item.name }, item.name)),
          ),
          status || dirty || lastRemoved
            ? h('span', { style: STATUS_TEXT, title: status || '未发送' }, status || '未发送')
            : null,
          lastRemoved
            ? h('button', { className: 'dshCanvasBtn', title: '撤销删除', onClick: undoRemove }, '撤销')
            : null,
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              'data-tone': confirmReset ? 'danger' : undefined,
              onClick: requestReset,
              disabled: files === null || files.length === 0,
            },
            confirmReset ? '确认重置？' : '重置',
          ),
          h(
            'button',
            { className: 'dshCanvasBtn', 'data-tone': 'primary', onClick: sendToAgent, disabled: !hasNode },
            confirmSend ? '确认发送？' : '发给 agent',
          ),
        ),
        body,
      )
    }

    function CanvasTitle() {
      return h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
          h(
            'g',
            { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
            h('rect', { x: 1.6, y: 1.6, width: 12.8, height: 12.8, rx: 2 }),
            h('rect', { x: 3.8, y: 3.8, width: 5, height: 4, rx: 1 }),
            h('rect', { x: 9.6, y: 8.6, width: 3.4, height: 3, rx: 0.9 }),
          ),
        ),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 'ComfyUI 画框 MOSS'),
      )
    }

    function CanvasIcon(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
        h(
          'g',
          { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
          h('rect', { x: 1.6, y: 1.6, width: 12.8, height: 12.8, rx: 2 }),
          h('rect', { x: 3.8, y: 3.8, width: 5, height: 4, rx: 1 }),
          h('rect', { x: 9.6, y: 8.6, width: 3.4, height: 3, rx: 0.9 }),
        ),
      )
    }

    const canvasHalf = {
      inject: ['slots'],
      apply(ctx) {
        ctx.inject(['sidebarRightTabs'], (tabCtx) => {
          // The canvas module can be switched off from the plugin page.
          let disposeType = null
          const syncCanvasTab = () => {
            if (disposeType) {
              disposeType()
              disposeType = null
            }
            if (pluginPrefs.get().canvas) {
              disposeType = tabCtx.sidebarRightTabs.register({
                id: CANVAS_TAB_ID,
                kind: CANVAS_TAB_KIND,
                // Keep the body mounted while the tab is hidden, so only a reload
                // needs the stored draft for recovery.
                keepMounted: true,
                title: () => 'ComfyUI 画框 MOSS',
                guide: [
                  {
                    id: 'canvas',
                    order: 16,
                    title: () => 'ComfyUI 画框 MOSS',
                    description: () => 'MOSS 模型专用：编辑工作流的画框与版式提示词',
                    icon: CanvasIcon,
                  },
                ],
              })
            }
          }
          const unsubscribeCanvas = pluginPrefs.subscribe(syncCanvasTab)
          syncCanvasTab()
          tabCtx.effect(() => () => {
            unsubscribeCanvas()
            if (disposeType) {
              disposeType()
              disposeType = null
            }
          })

          tabCtx.slots.inject('sidebar.right.pane.tab', () =>
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab', key: CANVAS_TAB_ID }, CanvasTab),
          )
          tabCtx.slots.inject('sidebar.right.pane.tab.title', () =>
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab.title', key: CANVAS_TAB_ID }, CanvasTitle),
          )
        })

        // The zoom view lives in the frame-wide overlay seat: it must cover every
        // column, and a `position: fixed` inside the pane is clipped by the layout.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'comfy-canvas-zoom' }, ZoomHost),
        )
      },
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        // The status card can be switched off, so its registration follows the
        // preference instead of being fixed at apply time.
        ctx.slots.inject('sidebar.footer.action', () => {
          let dispose = null
          const sync = () => {
            if (dispose) {
              dispose()
              dispose = null
            }
            if (pluginPrefs.get().status) {
              dispose = ctx.slots.register(
                {
                  name: 'sidebar.footer.action',
                  id: 'comfy-status',
                  order: -1,
                  label: () => 'ComfyUI 状态',
                },
                ComfyStatus,
              )
            }
          }
          const unsubscribe = pluginPrefs.subscribe(sync)
          sync()
          return () => {
            unsubscribe()
            if (dispose) {
              dispose()
              dispose = null
            }
          }
        })

        // This bundle's configuration block on its plugin page.
        ctx.slots.inject('plugins.bundle.config', () =>
          // Keyed by the bundle's package name: the plugin page looks configs up by that key.
        ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-comfy-enhance' }, ModuleSettings),
        )

        // The album is an optional surface: without the right sidebar the status
        // card above must keep working, so it registers on its own sub-context.
        ctx.inject(['sidebarRightTabs'], (tabCtx) => {
          let disposeType = null
          const syncAlbum = () => {
            if (disposeType) {
              disposeType()
              disposeType = null
            }
            if (pluginPrefs.get().album) {
              disposeType = tabCtx.sidebarRightTabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                title: () => 'ComfyUI 相册',
                guide: [
                  {
                    id: 'album',
                    order: 15,
                    title: () => 'ComfyUI 相册',
                    description: () => '浏览输出图、提示词与采样参数',
                    icon: AlbumIcon,
                  },
                ],
              })
            }
          }
          const unsubscribe = pluginPrefs.subscribe(syncAlbum)
          syncAlbum()
          tabCtx.effect(() => () => {
            unsubscribe()
            if (disposeType) {
              disposeType()
              disposeType = null
            }
          })

          tabCtx.slots.inject('sidebar.right.pane.tab', () =>
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, AlbumTab),
          )
          tabCtx.slots.inject('sidebar.right.pane.tab.title', () =>
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, AlbumTitle),
          )
        })

        canvasHalf.apply(ctx)
      },
    }
  },
})
