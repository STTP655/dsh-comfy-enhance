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
    /** Default MOSS DiT trio; the model panel lets the user change it. */
    const DEFAULT_CANVAS_MODELS = {
      unet: 'moss-image-sft-dit-int8-convrot.safetensors',
      clip: 'moss-image-sft-qwen35-int8-convrot.safetensors',
      vae: 'moss-image-sft-vae.safetensors',
      // Each entry: { name, strength }; empty list = no LoRA at all.
      loras: [],
      // Applies to the quick-generate KSampler only.
      sampling: {
        steps: 16,
        cfg: 1,
        sampler: 'euler',
        scheduler: 'simple',
        seed: Math.floor(Math.random() * 1e15),
        // 'random': a fresh seed on every quick generate; 'fixed': use the field.
        seedMode: 'fixed',
      },
    }

    const pluginPrefs = (() => {
      let state = {
        status: true,
        album: true,
        canvas: true,
        clearedBefore: 0,
        sound: true,
        editorPositiveHeight: 96,
        editorNegativeHeight: 96,
        viewerPanelWidth: 360,
        albumTheme: 'dark',
        zoomSummaryHeight: 54,
        zoomDescHeight: 68,
        zoomPanelWidth: 260,
        workspacePanelWidth: 280,
        canvasRuler: false,
        canvasWorkspace: true,
        canvasModels: Object.assign({}, DEFAULT_CANVAS_MODELS),
      }
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
              sound: parsed.sound !== false,
              editorPositiveHeight:
                typeof parsed.editorPositiveHeight === 'number' ? parsed.editorPositiveHeight : 96,
              editorNegativeHeight:
                typeof parsed.editorNegativeHeight === 'number' ? parsed.editorNegativeHeight : 96,
              viewerPanelWidth:
                typeof parsed.viewerPanelWidth === 'number' ? parsed.viewerPanelWidth : 360,
              albumTheme: parsed.albumTheme === 'light' ? 'light' : 'dark',
              zoomSummaryHeight:
                typeof parsed.zoomSummaryHeight === 'number' ? parsed.zoomSummaryHeight : 54,
              zoomDescHeight:
                typeof parsed.zoomDescHeight === 'number' ? parsed.zoomDescHeight : 68,
              zoomPanelWidth:
                typeof parsed.zoomPanelWidth === 'number' ? parsed.zoomPanelWidth : 260,
              workspacePanelWidth:
                typeof parsed.workspacePanelWidth === 'number' ? parsed.workspacePanelWidth : 280,
              canvasRuler: parsed.canvasRuler === true,
              canvasWorkspace: parsed.canvasWorkspace !== false,
              canvasModels: (() => {
                const raw =
                  parsed.canvasModels && typeof parsed.canvasModels === 'object' ? parsed.canvasModels : {}
                const merged = Object.assign({}, DEFAULT_CANVAS_MODELS, raw)
                if (!Array.isArray(merged.loras)) {
                  // Migrate the old single-LoRA preference into the list form.
                  merged.loras =
                    typeof raw.lora === 'string' && raw.lora.trim()
                      ? [
                          {
                            name: raw.lora.trim(),
                            strength: typeof raw.loraStrength === 'number' ? raw.loraStrength : 1,
                          },
                        ]
                      : []
                }
                delete merged.lora
                delete merged.loraStrength
                if (!merged.sampling || typeof merged.sampling !== 'object') {
                  merged.sampling = Object.assign({}, DEFAULT_CANVAS_MODELS.sampling)
                } else if (typeof merged.sampling.seed !== 'number') {
                  // Older preferences predate the seed field.
                  merged.sampling = Object.assign({}, DEFAULT_CANVAS_MODELS.sampling, merged.sampling)
                } else if (merged.sampling.seedMode !== 'random' && merged.sampling.seedMode !== 'fixed') {
                  merged.sampling = Object.assign({}, merged.sampling, { seedMode: 'fixed' })
                }
                return merged
              })(),
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

    /**
     * The surfaces draw in fixed CSS px, which reads small on a 2K panel running
     * at 100% OS scaling. Scale them up on wide screens, but never on top of a
     * high devicePixelRatio — the OS already scaled everything there.
     */
    const UI_SCALE = (() => {
      try {
        const screenWidth = (window.screen && window.screen.width) || window.innerWidth || 0
        const dpr = window.devicePixelRatio || 1
        let scale = 1
        if (screenWidth >= 2400) scale = 1.16
        else if (screenWidth >= 1900) scale = 1.08
        if (dpr >= 1.5) scale = Math.min(scale, 1.03)
        return Math.round(scale * 100) / 100
      } catch {
        return 1
      }
    })()

    /**
     * Lucide icon paths (24×24, stroke 2). Stored as data so the plugin keeps no
     * icon dependency and every glyph shares the same geometry and stroke.
     */
    const LUCIDE = {
      x: [
        ['path', { d: 'M18 6 6 18' }],
        ['path', { d: 'm6 6 12 12' }],
      ],
      info: [
        ['circle', { cx: 12, cy: 12, r: 10 }],
        ['path', { d: 'M12 16v-4' }],
        ['path', { d: 'M12 8h.01' }],
      ],
      'external-link': [
        ['path', { d: 'M15 3h6v6' }],
        ['path', { d: 'M10 14 21 3' }],
        ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ],
      bell: [
        ['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }],
        ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }],
      ],
      'bell-off': [
        ['path', { d: 'M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5' }],
        ['path', { d: 'M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7' }],
        ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }],
        ['path', { d: 'm2 2 20 20' }],
      ],
      maximize: [
        ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
        ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
        ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
        ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }],
      ],
      'layout-grid': [
        ['rect', { width: 7, height: 7, x: 3, y: 3, rx: 1 }],
        ['rect', { width: 7, height: 7, x: 14, y: 3, rx: 1 }],
        ['rect', { width: 7, height: 7, x: 14, y: 14, rx: 1 }],
        ['rect', { width: 7, height: 7, x: 3, y: 14, rx: 1 }],
      ],
      'columns-2': [
        ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
        ['path', { d: 'M12 3v18' }],
      ],
      cpu: [
        ['rect', { width: 16, height: 16, x: 4, y: 4, rx: 2 }],
        ['rect', { width: 6, height: 6, x: 9, y: 9, rx: 1 }],
        ['path', { d: 'M15 2v2' }],
        ['path', { d: 'M15 20v2' }],
        ['path', { d: 'M2 15h2' }],
        ['path', { d: 'M2 9h2' }],
        ['path', { d: 'M20 15h2' }],
        ['path', { d: 'M20 9h2' }],
        ['path', { d: 'M9 2v2' }],
        ['path', { d: 'M9 20v2' }],
      ],
      scan: [
        ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
        ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
        ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
        ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
      ],
      ruler: [
        ['path', { d: 'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z' }],
        ['path', { d: 'm14.5 12.5 2-2' }],
        ['path', { d: 'm11.5 9.5 2-2' }],
        ['path', { d: 'm8.5 6.5 2-2' }],
        ['path', { d: 'm17.5 15.5 2-2' }],
      ],
      sun: [
        ['circle', { cx: 12, cy: 12, r: 4 }],
        ['path', { d: 'M12 2v2' }],
        ['path', { d: 'M12 20v2' }],
        ['path', { d: 'm4.93 4.93 1.41 1.41' }],
        ['path', { d: 'm17.66 17.66 1.41 1.41' }],
        ['path', { d: 'M2 12h2' }],
        ['path', { d: 'M20 12h2' }],
        ['path', { d: 'm6.34 17.66-1.41 1.41' }],
        ['path', { d: 'm19.07 4.93-1.41 1.41' }],
      ],
      moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
      eye: [
        ['path', { d: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0' }],
        ['circle', { cx: 12, cy: 12, r: 3 }],
      ],
      'eye-off': [
        ['path', { d: 'M10.73 5.08a10.74 10.74 0 0 1 11.21 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49' }],
        ['path', { d: 'M14.08 14.16a3 3 0 0 1-4.24-4.24' }],
        ['path', { d: 'M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14' }],
        ['path', { d: 'm2 2 20 20' }],
      ],
      'move-diagonal': [
        ['path', { d: 'M13 5h6v6' }],
        ['path', { d: 'M11 19H5v-6' }],
        ['path', { d: 'M19 5 5 19' }],
      ],
      'sliders-horizontal': [
        ['line', { x1: 21, x2: 14, y1: 4, y2: 4 }],
        ['line', { x1: 10, x2: 3, y1: 4, y2: 4 }],
        ['line', { x1: 21, x2: 12, y1: 12, y2: 12 }],
        ['line', { x1: 8, x2: 3, y1: 12, y2: 12 }],
        ['line', { x1: 21, x2: 16, y1: 20, y2: 20 }],
        ['line', { x1: 12, x2: 3, y1: 20, y2: 20 }],
        ['line', { x1: 14, x2: 14, y1: 2, y2: 6 }],
        ['line', { x1: 8, x2: 8, y1: 10, y2: 14 }],
        ['line', { x1: 16, x2: 16, y1: 18, y2: 22 }],
      ],
      shuffle: [
        ['path', { d: 'M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22' }],
        ['path', { d: 'm18 2 4 4-4 4' }],
        ['path', { d: 'M2 6h1.9c1.5 0 2.9.9 3.6 2.2' }],
        ['path', { d: 'M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8' }],
        ['path', { d: 'm18 14 4 4-4 4' }],
      ],
      images: [
        ['path', { d: 'M18 22H4a2 2 0 0 1-2-2V6' }],
        ['path', { d: 'm22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18' }],
        ['circle', { cx: 12, cy: 8, r: 2 }],
        ['rect', { width: 16, height: 16, x: 6, y: 2, rx: 2 }],
      ],
    }

    function lucideParts(name) {
      return (LUCIDE[name] || []).map((part, index) => h(part[0], Object.assign({ key: index }, part[1])))
    }

    /** One Lucide glyph. Every icon in the plugin goes through here. */
    function Icon(props) {
      const size = props.size || 14
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.stroke || 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: Object.assign({ display: 'block' }, props.style || null),
        },
        ...lucideParts(props.name),
      )
    }

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
      zoom: UI_SCALE,
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
          '@keyframes dsh-comfy-status-job{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}' +
          '@media (prefers-reduced-motion:reduce){@keyframes dsh-comfy-status-pulse{0%,100%{opacity:.85}50%{opacity:.5}}}',
      )
    }

    /** Running-job banner in the sidebar card, matching the viewer's one. */
    const STATUS_JOB = {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '7px 9px',
      borderRadius: 9,
      border: '1px solid rgba(255, 90, 90, 0.24)',
      background: 'rgba(255, 86, 86, 0.08)',
    }
    const STATUS_JOB_DOT = {
      width: 6,
      height: 6,
      flex: 'none',
      borderRadius: '50%',
      background: '#ff5a5a',
      animation: 'dsh-comfy-status-pulse 1.1s ease-in-out infinite',
    }
    const STATUS_JOB_TEXT = { fontSize: 10.5, fontWeight: 600, color: '#ff6b6b' }
    const STATUS_JOB_ELAPSED = {
      fontSize: 10,
      color: 'rgba(255, 107, 107, 0.8)',
      fontVariantNumeric: 'tabular-nums',
      fontFeatureSettings: '"tnum"',
    }
    const STATUS_JOB_TRACK = {
      height: 3,
      borderRadius: 99,
      background: 'var(--dsw-alias-bg-layer-2)',
      overflow: 'hidden',
    }
    const STATUS_JOB_BAR = {
      width: '35%',
      height: '100%',
      borderRadius: 99,
      background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
      animation: 'dsh-comfy-status-job 1.15s ease-in-out infinite',
    }

    function ComfyStatus(props) {
      const wide = !(props && props.wide === false)
      const [snap, error] = useSnapshot()

      const up = Boolean(snap && snap.up)
      const queue = (snap && snap.queue) || {}
      const running = queue.running || 0
      const pending = queue.pending || 0
      const queuedJob = up && (running > 0 || pending > 0)

      // The banner counts from the first poll that saw the queue busy; ComfyUI
      // has a start time of its own, but it costs a second request per tick.
      const [busySince, setBusySince] = useState(null)
      const [now, setNow] = useState(0)
      const [done, setDone] = useState(null)
      const busyRef = useRef(null)
      useEffect(() => {
        if (!queuedJob) {
          const since = busyRef.current
          busyRef.current = null
          if (since) {
            setDone({ seconds: Math.max(1, Math.round((Date.now() - since) / 1000)), at: Date.now() })
          }
          setBusySince(null)
          return undefined
        }
        const since = Date.now()
        busyRef.current = since
        setBusySince((value) => (value === null ? since : value))
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [queuedJob])

      // These jobs can finish in a few seconds — shorter than a poll interval —
      // so the finished state stays on screen briefly instead of vanishing.
      useEffect(() => {
        if (!done) return undefined
        const timer = setTimeout(() => setDone(null), 6000)
        return () => clearTimeout(timer)
      }, [done])

      const elapsed = busySince ? Math.max(0, Math.floor((now - busySince) / 1000)) : 0

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
          h(Icon, {
            name: 'cpu',
            size: 15,
            style: {
              color: tone,
              animation: busy ? 'dsh-comfy-status-pulse 1.4s ease-in-out infinite' : 'none',
            },
          }),
          h(
            'span',
            {
              style: Object.assign({}, SUB, NUM, {
                fontSize: 10,
                lineHeight: 1.15,
                fontWeight: 500,
                color: queuedJob ? '#ff5a5a' : up ? 'var(--dsw-alias-label-secondary)' : TONE.down,
              }),
            },
            railLabel,
          ),
          queuedJob
            ? h(
                'div',
                {
                  style: {
                    width: 18,
                    height: 2,
                    borderRadius: 1,
                    background: 'var(--dsw-alias-bg-layer-2)',
                    overflow: 'hidden',
                  },
                },
                h('div', {
                  style: {
                    width: '45%',
                    height: '100%',
                    background: '#ff5a5a',
                    animation: 'dsh-comfy-status-job 1.15s ease-in-out infinite',
                  },
                }),
              )
            : null,
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
          ? queuedJob
            ? h(
                'div',
                { style: STATUS_JOB },
                h(
                  'div',
                  { style: Object.assign({}, ROW, { gap: 6 }) },
                  h('span', { style: STATUS_JOB_DOT }),
                  h('span', { style: STATUS_JOB_TEXT }, running > 0 ? '正在生成' : '排队中'),
                  h('span', { style: STATUS_JOB_ELAPSED }, elapsed + 's'),
                  h('span', { style: { flex: 1 } }),
                  h(
                    'span',
                    { style: Object.assign({}, SUB, NUM) },
                    '运行 ' + running + ' / 等待 ' + pending,
                  ),
                ),
                h('div', { style: STATUS_JOB_TRACK }, h('div', { style: STATUS_JOB_BAR })),
              )
            : done
              ? h(
                  'div',
                  { style: Object.assign({}, ROW, { gap: 6 }) },
                  h('span', {
                    style: {
                      width: 6,
                      height: 6,
                      flex: 'none',
                      borderRadius: '50%',
                      background: 'var(--dsw-alias-state-success-primary)',
                    },
                  }),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: 'var(--dsw-alias-state-success-primary)',
                      },
                    },
                    '生成完成',
                  ),
                  h('span', { style: Object.assign({}, SUB, NUM) }, done.seconds + 's'),
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: Object.assign({}, SUB, NUM) }, '运行 0 / 等待 0'),
                )
              : h(
                  'div',
                  { style: Object.assign({}, ROW, { gap: 10 }) },
                  h(
                    'span',
                    { style: Object.assign({}, SUB, NUM) },
                    '运行 ',
                    h(
                      'span',
                      {
                        style: {
                          color: running > 0 ? 'var(--dsw-alias-label-primary)' : 'inherit',
                          fontWeight: running > 0 ? 600 : 400,
                        },
                      },
                      String(running),
                    ),
                  ),
                  h(
                    'span',
                    { style: Object.assign({}, SUB, NUM) },
                    '等待 ',
                    h(
                      'span',
                      { style: { color: pending > 0 ? 'var(--dsw-alias-label-primary)' : 'inherit' } },
                      String(pending),
                    ),
                  ),
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
      zoom: UI_SCALE,
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

    /** Full date and time, for the viewer's metadata strip. */
    function fmtDateTime(ms) {
      const value = Number(ms) || 0
      if (value <= 0) return ''
      const date = new Date(value)
      const pad = (n) => String(n).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
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
      return h(Icon, {
        name: 'layout-grid',
        size: (props && props.size) || 16,
        style: { flex: 'none' },
      })
    }

    /** Two panels side by side: "compare this one with another". */
    function CompareIcon(props) {
      return h(Icon, { name: 'columns-2', size: (props && props.size) || 12 })
    }

    /** Sun or crescent, depending on which theme the album is showing. */
    /**
     * Lucide sun/moon, stacked on top of each other so the swap can animate:
     * the leaving glyph spins out and fades while the entering one spins in.
     */
    function ThemeIcon(props) {
      const night = Boolean(props.night)
      return h(
        'span',
        { className: 'dshComfyAlbum-theme', 'aria-hidden': true },
        h(
          'svg',
          {
            className: 'dshComfyAlbum-theme-sun',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'data-on': night ? 'false' : 'true',
          },
          ...lucideParts('sun'),
        ),
        h(
          'svg',
          {
            className: 'dshComfyAlbum-theme-moon',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'data-on': night ? 'true' : 'false',
          },
          ...lucideParts('moon'),
        ),
      )
    }

    /**
     * Theme surfaces shared by the album page and the canvas page. Only the token
     * values are redefined here; every inner style keeps reading the same names.
     */
    const SURFACE_DARK_CSS =
      '.dshComfySurface-dark{color-scheme:dark;color:var(--dsw-alias-label-primary);--dsw-alias-label-primary:#e9e9ec;--dsw-alias-label-secondary:#9b9ba3;--dsw-alias-bg-base:#141416;--dsw-alias-bg-layer-1:#1b1b1e;--dsw-alias-bg-layer-2:#232327;--dsw-alias-bg-overlay:#0f0f11;--dsw-alias-border-l1:rgba(255,255,255,.07);--dsw-alias-border-l2:rgba(255,255,255,.12);--dsw-alias-state-error-primary:#ff8a8a;--dsw-alias-state-success-primary:#6fd08c;--dsw-alias-state-warn-primary:#f0c060;--dsw-alias-state-idle-primary:#7a7a82;--dsw-specific-sidebar-fill:#1a1a1d;--dshcomfy-on-brand:#ffffff;background:#141416}'
    const SURFACE_LIGHT_CSS =
      '.dshComfySurface-light{color-scheme:light;--dsw-alias-label-primary:#1e1e22;--dsw-alias-label-secondary:#6b6b74;--dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f5f5f7;--dsw-alias-bg-layer-2:#ececef;--dsw-alias-bg-overlay:#fafafb;--dsw-alias-border-l1:rgba(0,0,0,.07);--dsw-alias-border-l2:rgba(0,0,0,.12);--dsw-alias-state-error-primary:#c0392b;--dsw-alias-state-success-primary:#2e9e57;--dsw-alias-state-warn-primary:#b07d1a;--dsw-alias-state-idle-primary:#8a8a92;--dsw-specific-sidebar-fill:#f0f0f3;--dshcomfy-on-brand:#ffffff;background:#ffffff;color:#1e1e22}'

    /** Theme switch glyph sizing; both style sheets need it, the canvas lacks it otherwise. */
    const THEME_ICON_CSS =
      '.dshComfyAlbum-theme{position:relative;display:inline-block;width:12px;height:12px;vertical-align:middle}' +
      '.dshComfyAlbum-theme svg{position:absolute;inset:0;width:12px;height:12px;transition:opacity .2s ease,transform .32s cubic-bezier(0.23,1,0.32,1)}' +
      '.dshComfyAlbum-theme-sun[data-on="false"]{opacity:0;transform:rotate(-60deg) scale(.5)}' +
      '.dshComfyAlbum-theme-moon[data-on="false"]{opacity:0;transform:rotate(60deg) scale(.5)}' +
      '@media (prefers-reduced-motion:reduce){.dshComfyAlbum-theme svg{transition:none!important}}'

    function AlbumStyles() {
      return h(
        'style',
        null,
        [
          '.dshComfyAlbum-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.4;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
          SURFACE_LIGHT_CSS,
          SURFACE_DARK_CSS,
          // Switching themes cross-fades the token-driven colors instead of
          // hard-cutting the whole page.
          '.dshComfySurface-dark,.dshComfySurface-light{transition:background-color .3s ease,color .3s ease}',
          '.dshComfySurface-dark *,.dshComfySurface-light *{transition:background-color .26s ease,color .26s ease,border-color .26s ease}',
          '@media (prefers-reduced-motion:reduce){.dshComfySurface-dark,.dshComfySurface-light,.dshComfySurface-dark *,.dshComfySurface-light *{transition:none!important}}',
          THEME_ICON_CSS,
          '.dshComfyAlbum-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
          '.dshComfyAlbum-btn[data-dark="true"]{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:rgba(255,255,255,.72)}',
          '.dshComfyAlbum-btn[data-dark="true"]:hover{background:rgba(255,255,255,.13);color:#fff}',
          '.dshComfyAlbum-btn[data-dark="true"][data-on="true"]{background:rgba(255,255,255,.18);color:#fff}',
          '.dshComfyAlbum-btn[data-dark="true"][data-tone="primary"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dshcomfy-on-brand)}',
          '.dshComfyAlbum-btn[data-dark="true"][data-tone="primary"]:disabled{opacity:.45}',
          '.dshComfyViewer-generate{appearance:none;width:100%;box-sizing:border-box;margin-top:12px;padding:10px 12px;border:0;border-radius:10px;background:linear-gradient(135deg,#ff5c7a,#ff8a3d);color:#fff;font:inherit;font-size:12.5px;font-weight:600;line-height:1.4;cursor:pointer;box-shadow:0 0 20px rgba(255,92,122,.28),0 4px 14px rgba(0,0,0,.25);transition:transform .16s ease,box-shadow .16s ease,filter .16s ease}',
          '.dshComfyViewer-generate:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.07);box-shadow:0 0 30px rgba(255,92,122,.45),0 8px 20px rgba(0,0,0,.28)}',
          '.dshComfyViewer-generate:active:not(:disabled){transform:translateY(0);filter:brightness(.98)}',
          '.dshComfyViewer-generate:disabled{opacity:.5;cursor:default;box-shadow:0 0 12px rgba(255,92,122,.15)}',
          '@media (prefers-reduced-motion:reduce){.dshComfyViewer-generate:hover:not(:disabled){transform:none}}',
          '.dshComfyViewer-icon{display:inline-flex;align-items:center;justify-content:center;height:22px;padding:0 7px;text-decoration:none}',
          '.dshComfyViewer-resize:hover{background:rgba(255,255,255,.1)}',
          // The self-drawn dropdown lives in the canvas styles too; the album
          // viewer uses it as well, so its rules have to be present here.
          '.dshCanvasPicker{appearance:none;display:flex;align-items:center;width:100%;box-sizing:border-box;font:inherit;font-size:10.5px;padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}',
          '.dshCanvasPicker:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasPicker[data-dark="true"]{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:rgba(255,255,255,.9)}',
          '.dshCanvasPicker[data-dark="true"]:hover{background:rgba(255,255,255,.11)}',
          '.dshCanvasOption{appearance:none;display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:10.5px;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.dshCanvasOption:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasOption[data-on="true"]{background:var(--dsw-alias-brand-primary);color:var(--dshcomfy-on-brand)}',
          '.dshCanvasOption[data-dark="true"]{color:rgba(255,255,255,.88)}',
          '.dshCanvasOption[data-dark="true"]:hover{background:rgba(255,255,255,.1)}',
          '.dshCanvasOption[data-dark="true"][data-on="true"]{background:rgba(255,255,255,.18);color:#fff}',
          '@keyframes dshComfyViewerIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}',
          '@keyframes dshComfyViewerOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.97)}}',
          '@keyframes dshComfyViewerFadeIn{from{opacity:0}to{opacity:1}}',
          '@keyframes dshComfyViewerFadeOut{from{opacity:1}to{opacity:0}}',
          '@keyframes dshComfyJobSlide{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}',
          '@keyframes dshComfyJobPulse{0%,100%{opacity:.45}50%{opacity:1}}',
          '.dshComfyAlbum-thumb{appearance:none;padding:0;margin:0;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;overflow:hidden;display:block;width:100%;height:92px;line-height:0}',
          '.dshComfyAlbum-thumb:hover{opacity:.86}',
          '.dshComfyAlbum-thumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshComfyAlbum-cell{position:relative;min-width:0}',
          '.dshComfyAlbum-compare{position:absolute;right:5px;top:5px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;cursor:pointer;background:rgba(0,0,0,.55);color:#fff;opacity:0;transition:opacity .15s ease;backdrop-filter:blur(4px)}',
          '.dshComfyAlbum-cell:hover .dshComfyAlbum-compare{opacity:1}',
          '.dshComfyAlbum-compare[data-on="true"]{opacity:1;background:var(--dsw-alias-brand-primary);color:var(--dshcomfy-on-brand)}',
          '.dshComfyAlbum-compare:focus-visible{opacity:1;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
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
      margin: 0,
      padding: '8px 11px 9px 13px',
      borderRadius: 10,
      border: '1px solid rgba(255, 90, 90, 0.26)',
      background: 'var(--dsw-alias-bg-layer-1)',
      boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
    }

    /** The job panel floats over the stage instead of taking a row in the flow. */
    const RUNNING_FLOAT = {
      position: 'absolute',
      top: 12,
      left: 12,
      zIndex: 6,
      width: 280,
      maxWidth: 'calc(100% - 24px)',
      maxHeight: 'calc(100% - 24px)',
      overflowY: 'auto',
    }

    /** Same idea for the canvas sidebar, whose board is much narrower. */
    const RUNNING_FLOAT_SIDEBAR = {
      position: 'absolute',
      top: 8,
      left: 8,
      zIndex: 6,
      width: 214,
      maxWidth: 'calc(100% - 16px)',
      maxHeight: 'calc(100% - 16px)',
      overflowY: 'auto',
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
      const dark = Boolean(props.dark)
      const buttonTone = dark ? { 'data-dark': 'true' } : null

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
        { style: { marginTop: dark ? 12 : 14, position: 'relative', paddingLeft: 9 } },
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
          h(
            'span',
            {
              style: {
                fontSize: 10.5,
                fontWeight: 600,
                color: dark ? 'rgba(255, 255, 255, 0.55)' : 'var(--dsw-alias-label-secondary)',
              },
            },
            props.title,
          ),
          h('span', { style: { flex: 1 } }),
          value.structured
            ? h('button', Object.assign({ className: 'dshComfyAlbum-btn' }, buttonTone, {
                onClick: () => setShowRaw(!showRaw),
              }), showRaw ? '显示正文' : '原始 JSON')
            : null,
          h('button', Object.assign({ className: 'dshComfyAlbum-btn' }, buttonTone, { onClick: copy }), copied ? '已复制' : '复制'),
        ),
        h('pre', { style: dark ? Object.assign({}, PROMPT_BOX, PROMPT_BOX_DARK) : PROMPT_BOX }, text),
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
      // ComfyUI's queue timestamp is in seconds and inconsistent across builds,
      // so count from the first render of this job instead of mixing units.
      const [startedAt, setStartedAt] = useState(() => Date.now())
      const [now, setNow] = useState(() => Date.now())

      useEffect(() => {
        setStartedAt(Date.now())
        setNow(Date.now())
      }, [job && job.id])

      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [])

      const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
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
            background: '#ff5a5a',
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
              background: '#ff5a5a',
              animation: 'dshComfyJobPulse 1.1s ease-in-out infinite',
            },
          }),
          h('span', { style: { fontWeight: 600, fontSize: 11.5, color: '#ff6b6b' } }, '正在生成'),
          h(
            'span',
            {
              style: Object.assign({}, NUM, {
                fontSize: 10.5,
                color: 'rgba(255, 107, 107, 0.85)',
                whiteSpace: 'nowrap',
              }),
            },
            elapsed + 's',
          ),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dshComfyAlbum-btn', onClick: () => setExpanded(!expanded) }, expanded ? '收起' : '查看提示词'),
        ),
        samplerLine
          ? h(
              'div',
              {
                style: Object.assign({}, SUB, NUM, {
                  fontSize: 10,
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }),
              },
              samplerLine,
            )
          : null,
        h(
          'div',
          {
            style: {
              height: 3,
              marginTop: 7,
              borderRadius: 99,
              background: 'var(--dsw-alias-bg-layer-2)',
              overflow: 'hidden',
            },
          },
          h('div', {
            style: {
              width: '38%',
              height: '100%',
              borderRadius: 99,
              background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
              animation: 'dshComfyJobSlide 1.15s ease-in-out infinite',
            },
          }),
        ),
        !expanded && head
          ? h('div', { style: Object.assign({}, SUB, ELLIPSIS, { marginTop: 5, fontSize: 10.5 }) }, head)
          : null,
        h(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateRows: expanded ? '1fr' : '0fr',
              opacity: expanded ? 1 : 0,
              // grid rows animate without a hardcoded height: the row collapses
              // to 0fr and the inner box clips, so the prompt can be any length.
              transition: 'grid-template-rows 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 160ms ease',
            },
          },
          h(
            'div',
            { style: { minHeight: 0, overflow: 'hidden' } },
            h(
              'div',
              { style: { maxHeight: '30vh', overflowY: 'auto' } },
              h(PromptBlock, { title: '正向提示词', value: meta.positive }),
              h(PromptBlock, { title: '负向提示词', value: meta.negative }),
            ),
          ),
        ),
      )
    }

    const VIEWER_BACKDROP = {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'center',
      padding: 24,
      background: 'rgba(0, 0, 0, 0.86)',
      cursor: 'zoom-out',
    }
    /** Holds the stage and everything that floats over it. */
    const VIEWER_MAIN = {
      position: 'relative',
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }
    /** Wraps the stage so the entrance/exit motion never fights the zoom transform. */
    const VIEWER_ANIM = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      willChange: 'transform, opacity',
    }
    const VIEWER_IMAGE = {
      maxWidth: '100%',
      maxHeight: '100%',
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
      flexWrap: 'wrap',
      gap: '6px 10px',
      maxWidth: '92%',
      padding: '7px 12px',
      borderRadius: 12,
      border: '1px solid rgba(255, 255, 255, 0.08)',
      background: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      color: '#ffffff',
      cursor: 'default',
    }
    /** One fact in the bottom strip: a quiet label beside its value. */
    const VIEWER_FACT = { display: 'flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }
    /** A run of strip controls that must wrap as one unit, never splitting a button off alone. */
    const VIEWER_BAR_GROUP = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }
    const VIEWER_FACT_LABEL = { fontSize: 9.5, color: 'rgba(255, 255, 255, 0.5)' }
    const VIEWER_FACT_VALUE = { fontSize: 10.5, color: 'rgba(255, 255, 255, 0.92)', ...NUM }

    /** Right-hand column: the prompts and the parameters that produced this image. */
    const VIEWER_PANEL = {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderRadius: 14,
      border: '1px solid rgba(255, 255, 255, 0.1)',
      background: 'rgba(30, 30, 34, 0.82)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      color: 'rgba(255, 255, 255, 0.9)',
      cursor: 'default',
      overflow: 'hidden',
    }
    /** Drag strip on the panel's left edge; invisible until hovered. */
    const VIEWER_RESIZE_HANDLE = {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 7,
      zIndex: 3,
      cursor: 'col-resize',
      background: 'transparent',
      transition: 'background .15s ease',
    }
    const VIEWER_PANEL_HEAD = {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 12px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    }
    const VIEWER_PANEL_BODY = {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '0 12px 14px',
    }
    const VIEWER_PANEL_EMPTY = { fontSize: 11, color: 'rgba(255, 255, 255, 0.45)', padding: '12px 0' }
    const VIEWER_BLOCK = { marginTop: 14 }
    const VIEWER_BLOCK_TITLE = {
      fontSize: 10,
      fontWeight: 600,
      color: 'rgba(255, 255, 255, 0.5)',
      marginBottom: 6,
    }
    const VIEWER_PARAM_GRID = {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      columnGap: 16,
      rowGap: 4,
      fontSize: 10.5,
    }
    const VIEWER_PARAM = { display: 'flex', justifyContent: 'space-between', gap: 10, minWidth: 0 }
    const VIEWER_PARAM_LABEL = { color: 'rgba(255, 255, 255, 0.5)', flex: 'none' }
    const VIEWER_PARAM_VALUE = { color: 'rgba(255, 255, 255, 0.9)', ...NUM, ...ELLIPSIS }
    const VIEWER_MODEL_ROW = { display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' }
    const VIEWER_MODEL_ROLE = { flex: 'none', width: 62, color: 'rgba(255, 255, 255, 0.5)', fontSize: 10 }
    const VIEWER_MODEL_NAME = { color: 'rgba(255, 255, 255, 0.9)', fontSize: 10.5, ...ELLIPSIS }
    const VIEWER_MODEL_STRENGTH = {
      flex: 'none',
      fontSize: 10,
      color: 'rgba(255, 255, 255, 0.82)',
      fontVariantNumeric: 'tabular-nums',
    }
    const VIEWER_FILE = { fontSize: 10, color: 'rgba(255, 255, 255, 0.45)', ...ELLIPSIS, marginBottom: 2 }
    /** Prompt editing surface inside the viewer's side column. */
    const VIEWER_EDIT_AREA = {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: 64,
      maxHeight: 420,
      resize: 'vertical',
      padding: '7px 9px',
      borderRadius: 8,
      border: '1px solid rgba(255, 255, 255, 0.1)',
      background: 'rgba(255, 255, 255, 0.05)',
      color: 'rgba(255, 255, 255, 0.9)',
      fontSize: 10.5,
      lineHeight: 1.5,
      fontFamily: 'inherit',
      outline: 'none',
    }
    const VIEWER_EDIT_ROW = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }
    const VIEWER_EDIT_LABEL = { fontSize: 10, color: 'rgba(255, 255, 255, 0.5)', flex: 'none' }
    const VIEWER_EDIT_NUM = {
      width: 62,
      boxSizing: 'border-box',
      padding: '4px 6px',
      borderRadius: 6,
      border: '1px solid rgba(255, 255, 255, 0.1)',
      background: 'rgba(255, 255, 255, 0.05)',
      color: 'rgba(255, 255, 255, 0.9)',
      fontSize: 10.5,
      fontFamily: 'inherit',
      outline: 'none',
    }
    /** Keep a dragged editor height inside what the column can actually show. */
    function clampEditorHeight(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return 96
      return Math.min(420, Math.max(64, Math.round(n)))
    }

    /** Keep the info column wide enough to read, narrow enough to leave the picture room. */
    function clampPanelWidth(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return 360
      return Math.min(720, Math.max(260, Math.round(n)))
    }
    const VIEWER_EDIT_STATUS = { marginTop: 8, fontSize: 10.5, lineHeight: 1.5 }
    const VIEWER_EDIT_HINT = { marginTop: 6, fontSize: 9.5, lineHeight: 1.5, color: 'rgba(255, 255, 255, 0.38)' }
    /** Running-job banner: warm red, pinned above the scroll area so it stays visible. */
    const VIEWER_JOB_BOX = {
      flex: 'none',
      padding: '9px 12px 10px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      background: 'rgba(255, 86, 86, 0.09)',
    }
    const VIEWER_JOB_HEAD = { display: 'flex', alignItems: 'center', gap: 8 }
    const VIEWER_JOB_DOT = {
      width: 7,
      height: 7,
      flex: 'none',
      borderRadius: '50%',
      background: '#ff5a5a',
      boxShadow: '0 0 0 3px rgba(255, 90, 90, 0.2)',
      animation: 'dshComfyJobPulse 1.1s ease-in-out infinite',
    }
    const VIEWER_JOB_TEXT = { fontSize: 11, fontWeight: 600, color: '#ff9a9a' }
    const VIEWER_JOB_ELAPSED = {
      fontSize: 10.5,
      color: 'rgba(255, 179, 179, 0.85)',
      fontVariantNumeric: 'tabular-nums',
    }
    const VIEWER_JOB_TRACK = {
      height: 4,
      marginTop: 8,
      borderRadius: 99,
      background: 'rgba(255, 255, 255, 0.08)',
      overflow: 'hidden',
    }
    const VIEWER_JOB_BAR = {
      width: '35%',
      height: '100%',
      borderRadius: 99,
      background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
      animation: 'dshComfyJobSlide 1.15s ease-in-out infinite',
    }
    const VIEWER_JOB_CANCEL = {
      color: '#ffb3b3',
      borderColor: 'rgba(255, 120, 120, 0.45)',
    }
    const VIEWER_STAGE = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }
    const VIEWER_NAV = {
      position: 'absolute',
      top: '50%',
      transform: 'translateY(-50%)',
      width: 36,
      height: 56,
      border: 0,
      borderRadius: 10,
      background: 'rgba(0, 0, 0, 0.42)',
      color: '#ffffff',
      fontSize: 22,
      lineHeight: 1,
      cursor: 'pointer',
      zIndex: 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }
    const VIEWER_THUMBS = { display: 'flex', alignItems: 'center', gap: 3 }
    const VIEWER_THUMB = {
      width: 28,
      height: 28,
      objectFit: 'cover',
      borderRadius: 4,
      border: '1px solid rgba(255, 255, 255, 0.25)',
      opacity: 0.65,
      cursor: 'pointer',
    }
    /** The prompt surface once it sits on the dark viewer instead of the page. */
    const PROMPT_BOX_DARK = {
      border: '1px solid rgba(255, 255, 255, 0.1)',
      background: 'rgba(255, 255, 255, 0.06)',
      color: 'rgba(255, 255, 255, 0.88)',
      maxHeight: 220,
    }

    /**
     * Bounds the pan so the zoomed image never leaves the stage: the visible
     * overflow is the only room it has to move. At 1x the overflow is zero, so
     * the offset stays centred.
     */
    function clampViewerOffset(offset, scale, stageRect, image) {
      // offset and stageRect are visual pixels (pointer space); offsetWidth is
      // layout pixels, which the plugin-wide zoom has already scaled on screen.
      const maxX = Math.max(0, (image.offsetWidth * UI_SCALE * scale - stageRect.width) / 2)
      const maxY = Math.max(0, (image.offsetHeight * UI_SCALE * scale - stageRect.height) / 2)
      return {
        x: Math.min(maxX, Math.max(-maxX, offset.x)),
        y: Math.min(maxY, Math.max(-maxY, offset.y)),
      }
    }

    /** "Expand this image" — Lucide maximize. */
    function ZoomIcon(props) {
      return h(Icon, { name: 'maximize', size: (props && props.size) || 14 })
    }

    /**
     * Right-hand column of the viewer: what was written, and what made the
     * picture. The short facts stay on the strip over the image; this holds the
     * text, which needs room a floating strip cannot give it.
     */
    /**
     * One shared tracker for the job the user started from the album.
     *
     * It lives at module scope on purpose. A completion chime has to survive the
     * viewer being closed — and an AudioContext owned by a component gets closed
     * exactly when that component unmounts, which is why the chime came and went.
     */
    const jobStore = (() => {
      let state = null
      let timer = null
      let ctx = null
      const listeners = new Set()

      const notify = () => {
        for (const listener of [...listeners]) listener()
      }

      const ensureAudio = () => {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext
          if (!Ctx) return null
          if (!ctx) ctx = new Ctx()
          if (ctx.state === 'suspended') ctx.resume()
          return ctx
        } catch {
          return null
        }
      }

      const ding = () => {
        const audio = ensureAudio()
        if (!audio) return
        try {
          const now = audio.currentTime
          const gain = audio.createGain()
          gain.gain.setValueAtTime(0.0001, now)
          gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)
          const osc = audio.createOscillator()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(880, now)
          osc.frequency.setValueAtTime(1318, now + 0.09)
          osc.connect(gain)
          gain.connect(audio.destination)
          osc.start(now)
          osc.stop(now + 0.6)
        } catch {
          // An audio device that refuses to play is not worth failing the job over.
        }
      }

      const stopTimer = () => {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }

      let tick // assigned below; set() runs only after module load

      const set = (next) => {
        state = next
        notify()
        if (!next || next.status === 'done' || next.status === 'error') {
          stopTimer()
        } else if (!timer) {
          tick()
          timer = setInterval(tick, 3000)
        }
      }

      tick = async () => {
        const current = state
        if (!current || !current.id) return
        if (current.status === 'done' || current.status === 'error') return
        try {
          const snapRes = await fetch(SNAPSHOT, { cache: 'no-store' })
          const snap = await snapRes.json()
          const last = snap && snap.last
          if (last && last.promptId === current.id && last.status === 'error') {
            set({ status: 'error', message: 'ComfyUI 执行失败', id: current.id, at: current.at })
            return
          }
          // A failed job may never produce an image, so the album alone cannot
          // tell us it is over; stop waiting after five minutes regardless.
          if (current.at && Date.now() - current.at > 300000) {
            set({ status: 'error', message: '超时未检测到结果，请查看 ComfyUI 控制台', id: current.id, at: current.at })
            return
          }
          const queue = (snap && snap.queue) || {}
          const runningIds = Array.isArray(queue.runningIds) ? queue.runningIds : []
          const pendingIds = Array.isArray(queue.pendingIds) ? queue.pendingIds : []
          if (runningIds.indexOf(current.id) >= 0) {
            if (current.status !== 'running') set({ ...current, status: 'running', message: '正在生成…' })
            return
          }
          if (pendingIds.indexOf(current.id) >= 0) {
            if (current.status !== 'queued') set({ ...current, status: 'queued', message: '排队中…' })
            return
          }
          const albumRes = await fetch(ALBUM_ENDPOINT, { cache: 'no-store' })
          const album = await albumRes.json()
          const item = (album.items || []).find((entry) => entry.id === current.id)
          if (!item) return
          if (item.completed) {
            const first = Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null
            set({
              status: 'done',
              message: '生成完成，已加入相册',
              id: current.id,
              at: current.at,
              origin: current.origin,
              imageUrl: first ? first.url : '',
              filename: first ? first.filename : '',
            })
            if (pluginPrefs.get().sound !== false) ding()
          } else if (item.status === 'error') {
            set({ status: 'error', message: 'ComfyUI 执行失败', id: current.id, at: current.at, origin: current.origin })
          }
        } catch {
          // A transient network failure: the next tick retries.
        }
      }

      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        start(promptId, origin) {
          set({
            status: 'queued',
            message: '已交给 ComfyUI，等待生成…',
            id: promptId,
            at: Date.now(),
            origin: origin || 'album',
          })
        },
        fail(message) {
          set({ status: 'error', message })
        },
        ensureAudio,
      }
    })()

    /** Ask ComfyUI to drop the tracked job: queue delete when pending, interrupt when running. */
    async function cancelTrackedJob() {
      const job = jobStore.get()
      if (!job || !job.id) return
      try {
        const res = await fetch('/plugin/comfy-status/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ promptId: job.id }),
        })
        if (res.ok) jobStore.fail('已终止')
      } catch {
        // The queue poll notices the disappearance on its own.
      }
    }

    function ViewerInfoPanel(props) {
      const meta = props.meta || {}
      const sampler = meta.sampler || null
      const models = meta.models || []
      const hasPrompts = Boolean(meta.positive || meta.negative)
      const params = []
      if (sampler) {
        if (sampler.name) params.push(['采样器', sampler.name])
        if (sampler.scheduler) params.push(['调度', sampler.scheduler])
        if (sampler.steps !== null && sampler.steps !== undefined) params.push(['步数', String(sampler.steps)])
        if (sampler.cfg !== null && sampler.cfg !== undefined) params.push(['CFG', String(sampler.cfg)])
        if (sampler.seed !== null && sampler.seed !== undefined) params.push(['种子', String(sampler.seed)])
        if (sampler.denoise !== null && sampler.denoise !== undefined) params.push(['降噪', String(sampler.denoise)])
      }

      const [editing, setEditing] = useState(false)
      const [initialPositive, setInitialPositive] = useState('')
      const [initialNegative, setInitialNegative] = useState('')
      const [seedMode, setSeedMode] = useState('keep')
      const [job, setJob] = useState(() => jobStore.get())
      const [cancelling, setCancelling] = useState(false)
      const [clock, setClock] = useState(0)
      const [soundOn, setSoundOn] = usePref('sound')
      const [positiveHeight, setPositiveHeight] = usePref('editorPositiveHeight')
      const [negativeHeight, setNegativeHeight] = usePref('editorNegativeHeight')
      const [samplerValue, setSamplerValue] = useState('')
      const [schedulerValue, setSchedulerValue] = useState('')
      const [stepsValue, setStepsValue] = useState('')
      const [cfgValue, setCfgValue] = useState('')
      const [paramOptions, setParamOptions] = useState(null)
      const positiveRef = useRef(null)
      const negativeRef = useRef(null)

      const canEdit = Boolean(props.promptId) && hasPrompts
      const busy = job !== null && (job.status === 'sending' || job.status === 'queued' || job.status === 'running')
      const active = job !== null && (job.status === 'queued' || job.status === 'running')

      // The tracker is shared, so the viewer mirrors it instead of owning it.
      useEffect(() => jobStore.subscribe(() => setJob(jobStore.get())), [])

      // Paging to another picture must not leave one prompt's draft pointed at
      // another record's node ids.
      useEffect(() => {
        setEditing(false)
      }, [props.promptId])

      // Seconds since the job was accepted, ticking while the banner is up.
      useEffect(() => {
        if (!active) return undefined
        setClock(Date.now())
        const timer = setInterval(() => setClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])

      /** Store the height the user just dragged the editor to. */
      const rememberHeight = (ref, setter) => {
        const node = ref.current
        if (!node) return
        const height = Math.round(node.offsetHeight)
        if (Number.isFinite(height)) setter(clampEditorHeight(height))
      }

      const startEdit = () => {
        setInitialPositive(meta.positive ? meta.positive.raw || meta.positive.text : '')
        setInitialNegative(meta.negative ? meta.negative.raw || meta.negative.text : '')
        const sampler = meta.sampler || {}
        setSamplerValue(sampler.name || '')
        setSchedulerValue(sampler.scheduler || '')
        setStepsValue(sampler.steps !== null && sampler.steps !== undefined ? String(sampler.steps) : '')
        setCfgValue(sampler.cfg !== null && sampler.cfg !== undefined ? String(sampler.cfg) : '')
        setEditing(true)
      }

      // The sampler and scheduler lists come from ComfyUI itself, so a custom
      // node pack never offers a value the server would reject.
      useEffect(() => {
        if (!editing || paramOptions) return undefined
        let alive = true
        fetch('/plugin/comfy-status/sampler-options', { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (alive && data && Array.isArray(data.samplers)) setParamOptions(data)
          })
          .catch(() => {
            // The dropdowns fall back to the record's current value.
          })
        return () => {
          alive = false
        }
      }, [editing, paramOptions])

      const send = async () => {
        if (!props.promptId || busy) return
        // Unlock audio while the click is still a user gesture; the chime itself
        // fires much later, from the tracker's timer.
        jobStore.ensureAudio()
        try {
          const res = await fetch('/plugin/comfy-status/regenerate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              promptId: props.promptId,
              positive: positiveRef.current ? positiveRef.current.value : initialPositive,
              negative: negativeRef.current ? negativeRef.current.value : initialNegative,
              seed: seedMode,
              sampler: samplerValue,
              scheduler: schedulerValue,
              steps: Number(stepsValue) || undefined,
              cfg: Number(cfgValue) || undefined,
            }),
          })
          const data = await res.json().catch(() => null)
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'HTTP ' + res.status)
          }
          jobStore.start(data.promptId)
        } catch (error) {
          const message = String((error && error.message) || error)
          jobStore.fail(
            message === 'not found' || /HTTP 404/.test(message)
              ? '插件 Host 还没重载：toggle 一次 bundle 再试'
              : message,
          )
        }
      }

      const cancel = async () => {
        if (!job || !job.id || cancelling) return
        const target = job
        setCancelling(true)
        try {
          const res = await fetch('/plugin/comfy-status/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ promptId: target.id }),
          })
          const data = await res.json().catch(() => null)
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'HTTP ' + res.status)
          }
          jobStore.fail(
            data.removed && data.removed.length > 0 ? '已终止这次生成' : '任务已结束，无需终止',
          )
        } catch (error) {
          const message = String((error && error.message) || error)
          jobStore.fail(
            message === 'not found' || /HTTP 404/.test(message)
              ? '插件 Host 还没重载：toggle 一次 bundle 再试'
              : '终止失败：' + message,
          )
        } finally {
          setCancelling(false)
        }
      }

      const elapsed = job && job.at && clock ? Math.max(0, Math.floor((clock - job.at) / 1000)) : 0

      // The current value is prepended when the engine list is unavailable or
      // does not contain it, so the control never renders blank.
      const buildChoices = (values, current) => {
        const list = (Array.isArray(values) ? values : []).map((value) => ({ value, label: value }))
        if (current && !list.some((option) => option.value === current)) {
          list.unshift({ value: current, label: current })
        }
        return list
      }
      const samplerChoices = buildChoices(paramOptions && paramOptions.samplers, samplerValue)
      const schedulerChoices = buildChoices(paramOptions && paramOptions.schedulers, schedulerValue)

      const statusColor =
        job && job.status === 'error'
          ? '#ff9a9a'
          : job && job.status === 'done'
            ? '#8fe3a0'
            : 'rgba(255, 255, 255, 0.7)'

      return h(
        'aside',
        {
          style: VIEWER_PANEL,
          'aria-label': '生成信息',
          onClick: (event) => event.stopPropagation(),
        },
        h(
          'div',
          { style: VIEWER_PANEL_HEAD },
          h('span', { style: { fontSize: 12, fontWeight: 600 } }, '生成信息'),
          h('span', { style: { flex: 1 } }),
          canEdit
            ? h(
                'button',
                {
                  className: 'dshComfyAlbum-btn',
                  'data-dark': 'true',
                  onClick: editing
                    ? () => {
                        setEditing(false)
                      }
                    : startEdit,
                  title: editing ? '退出编辑' : '改提示词并重新生成',
                },
                editing ? '退出' : '编辑',
              )
            : null,
          h(
            'button',
            {
              className: 'dshComfyAlbum-btn dshComfyViewer-icon',
              'data-dark': 'true',
              onClick: () => setSoundOn(!soundOn),
              title: soundOn ? '完成提示音：开' : '完成提示音：关',
              'aria-label': soundOn ? '关闭完成提示音' : '开启完成提示音',
            },
            h(SoundGlyph, { on: soundOn }),
          ),
          h(
            'button',
            Object.assign(
              { className: 'dshComfyAlbum-btn', 'data-dark': 'true', title: '收起信息栏（i）' },
              { onClick: props.onClose },
            ),
            '收起',
          ),
        ),
        active
          ? h(
              'div',
              { style: VIEWER_JOB_BOX },
              h(
                'div',
                { style: VIEWER_JOB_HEAD },
                h('span', { style: VIEWER_JOB_DOT }),
                h(
                  'span',
                  { style: VIEWER_JOB_TEXT },
                  cancelling ? '正在终止…' : job.status === 'running' ? '正在生成…' : '排队中…',
                ),
                h('span', { style: VIEWER_JOB_ELAPSED }, elapsed + 's'),
                h('span', { style: { flex: 1 } }),
                h(
                  'button',
                  {
                    className: 'dshComfyAlbum-btn',
                    'data-dark': 'true',
                    style: VIEWER_JOB_CANCEL,
                    disabled: cancelling,
                    onClick: cancel,
                    title: '停止这次生成',
                  },
                  cancelling ? '终止中…' : '终止',
                ),
              ),
              h('div', { style: VIEWER_JOB_TRACK }, h('div', { style: VIEWER_JOB_BAR })),
            )
          : null,
        h(
          'div',
          { style: VIEWER_PANEL_BODY },
          h('div', { style: VIEWER_FILE, title: props.filename }, props.filename),
          editing
            ? h(
                'div',
                null,
                h('div', { style: VIEWER_BLOCK_TITLE }, '正向提示词'),
                h('textarea', {
                  ref: positiveRef,
                  defaultValue: initialPositive,
                  style: Object.assign({}, VIEWER_EDIT_AREA, { height: clampEditorHeight(positiveHeight) }),
                  onMouseUp: () => rememberHeight(positiveRef, setPositiveHeight),
                  onTouchEnd: () => rememberHeight(positiveRef, setPositiveHeight),
                  spellCheck: false,
                }),
                h('div', { style: Object.assign({}, VIEWER_BLOCK_TITLE, { marginTop: 10 }) }, '负向提示词'),
                h('textarea', {
                  ref: negativeRef,
                  defaultValue: initialNegative,
                  style: Object.assign({}, VIEWER_EDIT_AREA, { height: clampEditorHeight(negativeHeight) }),
                  onMouseUp: () => rememberHeight(negativeRef, setNegativeHeight),
                  onTouchEnd: () => rememberHeight(negativeRef, setNegativeHeight),
                  spellCheck: false,
                }),
                h(
                  'div',
                  { style: VIEWER_EDIT_ROW },
                  h('span', { style: VIEWER_EDIT_LABEL }, '种子'),
                  h(
                    'button',
                    {
                      className: 'dshComfyAlbum-btn',
                      'data-dark': 'true',
                      'data-on': seedMode === 'keep' ? 'true' : 'false',
                      onClick: () => setSeedMode('keep'),
                    },
                    '沿用',
                  ),
                  h(
                    'button',
                    {
                      className: 'dshComfyAlbum-btn',
                      'data-dark': 'true',
                      'data-on': seedMode === 'random' ? 'true' : 'false',
                      onClick: () => setSeedMode('random'),
                    },
                    '随机',
                  ),
                ),
                h(
                  'div',
                  { style: VIEWER_EDIT_ROW },
                  h('span', { style: VIEWER_EDIT_LABEL }, '采样器'),
                  h(Dropdown, {
                    options: samplerChoices,
                    value: samplerValue,
                    onPick: setSamplerValue,
                    title: '采样器',
                    dark: true,
                  }),
                  h('span', { style: Object.assign({}, VIEWER_EDIT_LABEL, { marginLeft: 4 }) }, '调度'),
                  h(Dropdown, {
                    options: schedulerChoices,
                    value: schedulerValue,
                    onPick: setSchedulerValue,
                    title: '调度',
                    dark: true,
                  }),
                ),
                h(
                  'div',
                  { style: VIEWER_EDIT_ROW },
                  h('span', { style: VIEWER_EDIT_LABEL }, '步数'),
                  h('input', {
                    type: 'number',
                    min: 1,
                    max: 200,
                    value: stepsValue,
                    style: VIEWER_EDIT_NUM,
                    onChange: (event) => setStepsValue(event.target.value),
                  }),
                  h('span', { style: VIEWER_EDIT_LABEL }, 'CFG'),
                  h('input', {
                    type: 'number',
                    min: 0,
                    step: 0.1,
                    value: cfgValue,
                    style: VIEWER_EDIT_NUM,
                    onChange: (event) => setCfgValue(event.target.value),
                  }),
                  h('span', { style: { flex: 1 } }),
                ),
                h(
                  'button',
                  {
                    className: 'dshComfyViewer-generate',
                    disabled: busy,
                    onClick: send,
                    title: '把改过的提示词直接交给 ComfyUI',
                  },
                  busy ? '正在生成…' : '生成',
                ),
                job && !active
                  ? h('div', { style: Object.assign({}, VIEWER_EDIT_STATUS, { color: statusColor }) }, job.message)
                  : null,
                h('div', { style: VIEWER_EDIT_HINT }, '生成会直接提交到 ComfyUI，结果出现在相册里。'),
              )
            : hasPrompts
              ? [
                  h(PromptBlock, {
                    key: 'prompt-positive',
                    title: '正向提示词',
                    value: meta.positive,
                    accent: 'var(--dsw-alias-brand-primary)',
                    dark: true,
                  }),
                  h(PromptBlock, {
                    key: 'prompt-negative',
                    title: '负向提示词',
                    value: meta.negative,
                    accent: 'rgba(255, 255, 255, 0.22)',
                    dark: true,
                  }),
                ]
              : h('div', { style: VIEWER_PANEL_EMPTY }, '这条记录没有提示词'),
          models.length > 0
            ? h(
                'div',
                { style: VIEWER_BLOCK },
                h('div', { style: VIEWER_BLOCK_TITLE }, '模型'),
                ...models.map((model) =>
                  h(
                    'div',
                    { key: model.role + '\u0000' + model.name, style: VIEWER_MODEL_ROW },
                    h('span', { style: VIEWER_MODEL_ROLE }, model.role),
                    h('span', { style: VIEWER_MODEL_NAME, title: model.name }, model.name),
                    typeof model.strength === 'number'
                      ? h(
                          'span',
                          {
                            style: VIEWER_MODEL_STRENGTH,
                            title:
                              typeof model.strengthClip === 'number'
                                ? '模型强度 ' + model.strength + '，CLIP 强度 ' + model.strengthClip
                                : '强度 ' + model.strength,
                          },
                          model.strength +
                            (typeof model.strengthClip === 'number' ? ' / ' + model.strengthClip : ''),
                        )
                      : null,
                  ),
                ),
              )
            : null,
          params.length > 0
            ? h(
                'div',
                { style: VIEWER_BLOCK },
                h('div', { style: VIEWER_BLOCK_TITLE }, '采样'),
                h(
                  'div',
                  { style: VIEWER_PARAM_GRID },
                  ...params.map((pair) =>
                    h(
                      'div',
                      { key: pair[0], style: VIEWER_PARAM },
                      h('span', { style: VIEWER_PARAM_LABEL }, pair[0]),
                      h('span', { style: VIEWER_PARAM_VALUE, title: pair[1] }, pair[1]),
                    ),
                  ),
                ),
              )
            : null,
        ),
      )
    }

    /** Small glyphs for the viewer's icon-only actions, so the strip fits on one line. */
    function ViewerGlyph(props) {
      const kind = props.kind
      if (kind === 'close') return h(Icon, { name: 'x', size: 11 })
      if (kind === 'info') return h(Icon, { name: 'info', size: 13 })
      return h(Icon, { name: 'external-link', size: 12 })
    }

    /** Bell glyph; the slash appears while the completion sound is muted. */
    function SoundGlyph(props) {
      return h(Icon, { name: props.on ? 'bell' : 'bell-off', size: 13 })
    }

    /** Full-viewport image viewer; Escape or a backdrop click closes it. */
    function ImageViewer(props) {
      const images = props.images && props.images.length ? props.images : [{ url: props.src, filename: props.filename }]
      const [index, setIndex] = useState(props.startIndex || 0)
      const [scale, setScale] = useState(1)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const [dragging, setDragging] = useState(false)
      const [showInfo, setShowInfo] = useState(true)
      const [natural, setNatural] = useState(null)
      const [closing, setClosing] = useState(false)
      const [panelWidth, setPanelWidthPref] = usePref('viewerPanelWidth')
      const [livePanelWidth, setLivePanelWidth] = useState(null)
      // Read once: the preference does not change mid-gesture.
      const [reducedMotion] = useState(
        () =>
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
      const stageRef = useRef(null)
      const imgRef = useRef(null)
      const dragRef = useRef(null)
      const closingRef = useRef(false)
      const closeTimer = useRef(null)
      const panelDragRef = useRef(null)
      const livePanelRef = useRef(null)
      const panelHandlersRef = useRef(null)
      // Mirror of the zoom pair, so the wheel and pointer handlers read the live
      // value instead of a stale render closure.
      const viewRef = useRef({ scale: 1, offset: { x: 0, y: 0 } })
      const onClose = props.onClose

      // The viewer unmounts only after the exit animation, so the timer must not
      // outlive the component.
      useEffect(
        () => () => {
          if (closeTimer.current) clearTimeout(closeTimer.current)
        },
        [],
      )

      // A width drag listens on window; drop those listeners with the viewer.
      useEffect(
        () => () => {
          const handlers = panelHandlersRef.current
          if (!handlers) return
          window.removeEventListener('pointermove', handlers.move)
          window.removeEventListener('pointerup', handlers.up)
          window.removeEventListener('pointercancel', handlers.up)
        },
        [],
      )

      const requestClose = () => {
        if (closingRef.current) return
        closingRef.current = true
        setClosing(true)
        closeTimer.current = setTimeout(() => {
          if (onClose) onClose()
        }, 170)
      }

      // Between pointerdown and pointerup the live width wins; the stored one is
      // written once the drag ends, so a drag does not hammer localStorage.
      const panelPx = clampPanelWidth(livePanelWidth === null ? panelWidth : livePanelWidth)

      const onPanelHandleMove = (event) => {
        const drag = panelDragRef.current
        if (!drag) return
        const limit = Math.max(260, Math.min(720, window.innerWidth - 320))
        const next = Math.min(limit, Math.max(260, drag.startWidth - (event.clientX - drag.startX)))
        livePanelRef.current = next
        setLivePanelWidth(next)
      }

      const onPanelHandleUp = () => {
        if (!panelDragRef.current) return
        panelDragRef.current = null
        window.removeEventListener('pointermove', onPanelHandleMove)
        window.removeEventListener('pointerup', onPanelHandleUp)
        window.removeEventListener('pointercancel', onPanelHandleUp)
        if (livePanelRef.current !== null) setPanelWidthPref(clampPanelWidth(livePanelRef.current))
        livePanelRef.current = null
        setLivePanelWidth(null)
      }

      const onPanelHandleDown = (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        panelDragRef.current = { startX: event.clientX, startWidth: panelPx }
        livePanelRef.current = panelPx
        setLivePanelWidth(panelPx)
        panelHandlersRef.current = { move: onPanelHandleMove, up: onPanelHandleUp }
        window.addEventListener('pointermove', onPanelHandleMove)
        window.addEventListener('pointerup', onPanelHandleUp)
        window.addEventListener('pointercancel', onPanelHandleUp)
      }

      const fadeAnimation = closing
        ? 'dshComfyViewerFadeOut 160ms ease-out both'
        : 'dshComfyViewerFadeIn 200ms ease-out both'
      const stageAnimation = reducedMotion
        ? 'none'
        : closing
          ? 'dshComfyViewerOut 160ms ease-out both'
          : 'dshComfyViewerIn 240ms cubic-bezier(0.23, 1, 0.32, 1) both'
      const current = images[index] || images[0]
      // A sliding window of five thumbnails that keeps the current picture in
      // the middle: without it the strip freezes on the newest five and paging
      // past them leaves the strip pointing at nothing.
      const recent = (() => {
        const size = Math.min(images.length, 5)
        const start = Math.max(0, Math.min(index - Math.floor(size / 2), images.length - size))
        return images.slice(start, start + size).map((image, at) => ({ image, at: start + at }))
      })()

      const meta = current.meta || {}
      const hasPanel = Boolean(
        meta.positive || meta.negative || (meta.models && meta.models.length) || meta.sampler,
      )
      const resolution = natural && natural.width
        ? natural.width + ' × ' + natural.height
        : current.width && current.height
          ? current.width + ' × ' + current.height
          : meta.size && meta.size.width
            ? meta.size.width + ' × ' + meta.size.height
            : ''
      const timeText = fmtDateTime(current.startedAt)
      const durationText = fmtDuration(current.durationMs)

      const applyView = (nextScale, nextOffset) => {
        viewRef.current = { scale: nextScale, offset: nextOffset }
        setScale(nextScale)
        setOffset(nextOffset)
      }

      const resetView = () => applyView(1, { x: 0, y: 0 })

      const go = (delta) => {
        if (images.length < 2) return
        setIndex((value) => (value + delta + images.length) % images.length)
        // In compare mode the zoom is the point: flipping to the other picture
        // keeps the same magnification and pan so details line up.
        if (!props.compare) resetView()
        setNatural(null)
      }

      useEffect(() => {
        const onKey = (event) => {
          if (event.isComposing) return
          if (event.key === 'Escape') requestClose()
          const target = event.target
          const editing =
            target &&
            (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
          if (editing) return
          if (event.key === 'ArrowLeft') go(-1)
          if (event.key === 'ArrowRight') go(1)
          if (event.key === 'i' || event.key === 'I') setShowInfo((value) => !value)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
        // go only calls state setters and reads images.length.
      }, [images.length])

      // React's onWheel is passive, so preventDefault needs a native listener.
      useEffect(() => {
        const node = stageRef.current
        if (!node) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const img = imgRef.current
          const view = viewRef.current
          const next = Math.min(5, Math.max(1, view.scale + (event.deltaY < 0 ? 0.2 : -0.2)))
          if (next === view.scale) return
          if (next === 1 || !img) {
            applyView(1, { x: 0, y: 0 })
            return
          }
          // Pin the point under the cursor: the new offset has to compensate for
          // the scale ratio around the cursor's distance from the stage centre.
          const rect = node.getBoundingClientRect()
          const vx = event.clientX - (rect.left + rect.width / 2)
          const vy = event.clientY - (rect.top + rect.height / 2)
          const ratio = next / view.scale
          const anchor = {
            x: vx - ratio * (vx - view.offset.x),
            y: vy - ratio * (vy - view.offset.y),
          }
          applyView(next, clampViewerOffset(anchor, next, rect, img))
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [])

      // Panning only exists once the image is zoomed in; at 1x the pointer goes
      // through untouched so a plain click still closes the viewer.
      const onImagePointerDown = (event) => {
        if (event.button !== 0 || viewRef.current.scale <= 1) return
        event.preventDefault()
        event.stopPropagation()
        const img = event.currentTarget
        if (img.setPointerCapture) img.setPointerCapture(event.pointerId)
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          origin: viewRef.current.offset,
        }
        setDragging(true)
      }

      const onImagePointerMove = (event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const node = stageRef.current
        const img = imgRef.current
        if (!node || !img) return
        const view = viewRef.current
        const next = {
          x: drag.origin.x + event.clientX - drag.startX,
          y: drag.origin.y + event.clientY - drag.startY,
        }
        applyView(view.scale, clampViewerOffset(next, view.scale, node.getBoundingClientRect(), img))
      }

      const endDrag = (event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const img = event.currentTarget
        if (img.hasPointerCapture && img.hasPointerCapture(event.pointerId)) {
          img.releasePointerCapture(event.pointerId)
        }
        dragRef.current = null
        setDragging(false)
      }

      return h(
        'div',
        {
          style: Object.assign({}, VIEWER_BACKDROP, { animation: fadeAnimation }),
          onClick: requestClose,
          role: 'presentation',
        },
        h(
          'div',
          { style: VIEWER_MAIN },
          images.length > 1
            ? h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, VIEWER_NAV, { left: 16 }),
                  'aria-label': '上一张',
                  onClick: (event) => {
                    event.stopPropagation()
                    go(-1)
                  },
                },
                '‹',
              )
            : null,
          images.length > 1
            ? h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, VIEWER_NAV, { right: 16 }),
                  'aria-label': '下一张',
                  onClick: (event) => {
                    event.stopPropagation()
                    go(1)
                  },
                },
                '›',
              )
            : null,
          h(
            'div',
            { style: Object.assign({}, VIEWER_ANIM, { animation: stageAnimation }) },
            h(
              'div',
              { ref: stageRef, style: VIEWER_STAGE },
              h('img', {
                ref: imgRef,
                src: current.url,
                alt: current.filename,
                draggable: false,
                style: Object.assign({}, VIEWER_IMAGE, {
                  transform:
                    'translate3d(' +
                    offset.x / UI_SCALE +
                    'px, ' +
                    offset.y / UI_SCALE +
                    'px, 0) scale(' +
                    scale +
                    ')',
                  transition: dragging ? 'none' : 'transform 120ms ease',
                  cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
                  touchAction: 'none',
                  userSelect: 'none',
                }),
                onClick: (event) => event.stopPropagation(),
                onPointerDown: onImagePointerDown,
                onPointerMove: onImagePointerMove,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
                onDragStart: (event) => event.preventDefault(),
                onLoad: (event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  }),
              }),
            ),
          ),
          h(
            'div',
            { style: VIEWER_BAR, onClick: (event) => event.stopPropagation() },
            h(
              'div',
              { style: VIEWER_BAR_GROUP },
              resolution
                ? h(
                    'span',
                    { style: VIEWER_FACT },
                    h('span', { style: VIEWER_FACT_LABEL }, '分辨率'),
                    h('span', { style: VIEWER_FACT_VALUE }, resolution),
                  )
                : null,
              timeText
                ? h(
                    'span',
                    { style: VIEWER_FACT },
                    h('span', { style: VIEWER_FACT_LABEL }, '生成'),
                    h('span', { style: VIEWER_FACT_VALUE }, timeText),
                  )
                : null,
              durationText !== '—'
                ? h(
                    'span',
                    { style: VIEWER_FACT },
                    h('span', { style: VIEWER_FACT_LABEL }, '耗时'),
                    h('span', { style: VIEWER_FACT_VALUE }, durationText),
                  )
                : null,
              h(
                'span',
                { style: VIEWER_FACT },
                h('span', { style: VIEWER_FACT_LABEL }, '缩放'),
                h('span', { style: VIEWER_FACT_VALUE }, scale.toFixed(1) + '×'),
              ),
              images.length > 1
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 10,
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      },
                    },
                    index + 1 + ' / ' + images.length,
                  )
                : null,
            ),
            recent.length > 1
              ? h(
                  'div',
                  { style: VIEWER_THUMBS },
                  ...recent.map((entry) =>
                    h('img', {
                      key: entry.at,
                      src: entry.image.url,
                      alt: entry.image.filename,
                      title: entry.image.filename,
                      onClick: () => {
                        setIndex(entry.at)
                        if (!props.compare) resetView()
                        setNatural(null)
                      },
                      style: Object.assign(
                        {},
                        VIEWER_THUMB,
                        entry.at === index ? { opacity: 1, borderColor: 'rgba(255, 255, 255, 0.9)' } : null,
                      ),
                    }),
                  ),
                )
              : null,
            h(
              'div',
              { style: VIEWER_BAR_GROUP },
              h('button', { className: 'dshComfyAlbum-btn', 'data-dark': 'true', onClick: resetView }, '还原'),
              h(
                'a',
                {
                  className: 'dshComfyAlbum-btn dshComfyViewer-icon',
                  'data-dark': 'true',
                  href: current.url,
                  target: '_blank',
                  rel: 'noreferrer',
                  title: '新标签打开',
                  'aria-label': '新标签打开',
                },
                h(ViewerGlyph, { kind: 'open' }),
              ),
              hasPanel
                ? h(
                    'button',
                    {
                      className: 'dshComfyAlbum-btn dshComfyViewer-icon',
                      'data-dark': 'true',
                      onClick: () => setShowInfo(!showInfo),
                      title: showInfo ? '收起信息栏（i）' : '展开信息栏（i）',
                      'aria-label': showInfo ? '收起信息栏' : '展开信息栏',
                    },
                    h(ViewerGlyph, { kind: 'info' }),
                  )
                : null,
              h(
                'button',
                {
                  className: 'dshComfyAlbum-btn dshComfyViewer-icon',
                  'data-dark': 'true',
                  onClick: requestClose,
                  title: '关闭（Esc）',
                  'aria-label': '关闭',
                },
                h(ViewerGlyph, { kind: 'close' }),
              ),
            ),
          ),
        ),
        hasPanel
          ? h(
              'div',
              {
                style: {
                  position: 'relative',
                  flex: 'none',
                  // A flex child defaults to min-width:auto, which would keep the
                  // collapsed pane at its content width instead of 0.
                  minWidth: 0,
                  width: showInfo ? panelPx / UI_SCALE : 0,
                  marginLeft: showInfo ? 16 : 0,
                  overflow: 'hidden',
                  // While dragging, the width follows the pointer directly; the
                  // transition only exists for the collapse/expand animation.
                  transition:
                    livePanelWidth !== null || reducedMotion
                      ? 'none'
                      : 'width 260ms cubic-bezier(0.32, 0.72, 0, 1), margin-left 260ms cubic-bezier(0.32, 0.72, 0, 1)',
                },
              },
              h(
                'div',
                {
                  style: {
                    width: panelPx / UI_SCALE,
                    height: '100%',
                    transform: showInfo ? 'translateX(0)' : 'translateX(100%)',
                    opacity: showInfo ? 1 : 0,
                    transition: reducedMotion
                      ? 'opacity 160ms ease'
                      : 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms ease',
                  },
                },
                h(ViewerInfoPanel, {
                  meta,
                  filename: current.filename,
                  promptId: current.itemId,
                  onClose: () => setShowInfo(false),
                }),
              ),
              showInfo
                ? h('div', {
                    className: 'dshComfyViewer-resize',
                    style: VIEWER_RESIZE_HANDLE,
                    onPointerDown: onPanelHandleDown,
                    onClick: (event) => event.stopPropagation(),
                    title: '拖动调整宽度',
                  })
                : null,
            )
          : null,
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

      // Same rows as the full-screen viewer: role on the left, file name in the
      // middle, LoRA strength on the right.
      const modelRows =
        models.length > 0
          ? h(
              'div',
              null,
              ...models.map((model) =>
                h(
                  'div',
                  {
                    key: model.role + '\u0000' + model.name,
                    style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' },
                  },
                  h(
                    'span',
                    {
                      style: {
                        flex: 'none',
                        width: 52,
                        fontSize: 10,
                        color: 'var(--dsw-alias-label-secondary)',
                      },
                    },
                    model.role,
                  ),
                  h(
                    'span',
                    { style: Object.assign({}, ELLIPSIS, { flex: 1, fontSize: 10.5 }), title: model.name },
                    model.name,
                  ),
                  typeof model.strength === 'number'
                    ? h(
                        'span',
                        {
                          style: {
                            flex: 'none',
                            fontSize: 10,
                            color: 'var(--dsw-alias-label-secondary)',
                            fontVariantNumeric: 'tabular-nums',
                          },
                          title:
                            typeof model.strengthClip === 'number'
                              ? '模型强度 ' + model.strength + '，CLIP 强度 ' + model.strengthClip
                              : '强度 ' + model.strength,
                        },
                        model.strength +
                          (typeof model.strengthClip === 'number' ? ' / ' + model.strengthClip : ''),
                      )
                    : null,
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
          modelRows ? h('div', null, h('div', { style: CARD_LABEL }, '模型'), modelRows) : null,
          sampling
            ? h(
                'div',
                { style: modelRows ? CARD_SECTION : null },
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
          modelRows || h('div', { style: EMPTY_GROUP }, '未记录'),
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
          ? (() => {
              // Compare mode narrows the viewer to the two picked pictures, so
              // paging and the arrow keys flip between them instead of walking
              // the whole gallery.
              const compare = Array.isArray(props.compare) ? props.compare : null
              const usingCompare = Boolean(
                compare && compare.some((entry) => entry && entry.url === image.url),
              )
              const pool = usingCompare
                ? compare
                : props.gallery && props.gallery.length
                  ? props.gallery
                  : [image]
              return h(ImageViewer, {
                images: pool,
                startIndex: Math.max(0, pool.findIndex((entry) => entry && entry.url === image.url)),
                filename: image.filename,
                compare: usingCompare,
                onClose: () => setZoomed(false),
              })
            })()
          : null,
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
        // Same order as the full-screen viewer: prompts first, then models and
        // sampler facts.
        h(InfoCard, { item, wide }),
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
      const [albumTheme, setAlbumTheme] = usePref('albumTheme')
      const nightTheme = albumTheme !== 'light'
      // Compare mode: pick one picture, then another, and the viewer pages only
      // between those two.
      const [compareA, setCompareA] = useState(null)
      const [compareB, setCompareB] = useState(null)
      const comparing = Boolean(compareA && compareB)
      const wide = paneWidth >= WIDE_BREAKPOINT

      // A clear only hides what already existed at that moment; the next render
      // still lands past the watermark and shows up.
      const items = (album && album.items) || []
      const visible = items.filter((item) => (item.startedAt || 0) > clearedBefore)
      const running = (album && album.running) || []
      const groups = groupByDay(visible)
      const selected = visible.find((item) => item.id === picked) || visible[0] || null
      // One flat strip of every image, newest first: feeds viewer paging and the
      // recent thumbnails at its bottom. Each entry carries its owning job so the
      // viewer can show the prompt without a second lookup.
      const galleryImages = []
      for (const item of visible) {
        for (const image of item.images || []) {
          galleryImages.push({
            ...image,
            itemId: item.id,
            startedAt: item.startedAt,
            durationMs: item.durationMs,
            meta: item.meta,
          })
        }
      }
      const galleryByUrl = new Map(galleryImages.map((image) => [image.url, image]))

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

      const imageCompared = (image) =>
        Boolean((compareA && compareA.url === image.url) || (compareB && compareB.url === image.url))

      const toggleCompare = (image) => {
        if (comparing) {
          setCompareA(null)
          setCompareB(null)
          return
        }
        if (!compareA) {
          setCompareA(image)
          return
        }
        if (compareA.url === image.url) {
          setCompareA(null)
          return
        }
        setCompareB(image)
      }

      const thumbOf = (item) => {
        const image = galleryByUrl.get(item.images[0].url) || item.images[0]
        const compared = imageCompared(image)
        return h(
          'div',
          { key: item.id, className: 'dshComfyAlbum-cell' },
          h(
            'button',
            {
              className: 'dshComfyAlbum-thumb',
              title: image.filename,
              onClick: () => setPicked(item.id),
              style:
                selected && selected.id === item.id
                  ? { outline: '2px solid var(--dsw-alias-brand-primary)', outlineOffset: 1 }
                  : null,
            },
            h('img', { src: image.url, loading: 'lazy', alt: image.filename, style: ALBUM_IMG }),
          ),
          h(
            'button',
            {
              className: 'dshComfyAlbum-compare',
              'data-on': compared ? 'true' : 'false',
              title: comparing ? '结束对比' : compared ? '取消选择' : '加入对比',
              onClick: (event) => {
                event.stopPropagation()
                toggleCompare(image)
              },
            },
            h(CompareIcon, { size: 12 }),
          ),
        )
      }

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
            {
              style: Object.assign({}, wide ? DETAIL_PANE : ALBUM_DETAIL, { position: 'relative' }),
            },
            running.length > 0
              ? h('div', { style: RUNNING_FLOAT }, h(RunningBlock, { job: running[0] }))
              : null,
            selected
              ? h(
                  'div',
                  { style: wide ? { maxWidth: DETAIL_MAX_WIDTH } : null },
                  h(AlbumDetail, {
                    item: selected,
                    wide,
                    gallery: galleryImages,
                    compare: comparing ? [compareA, compareB] : null,
                  }),
                )
              : null,
          ),
        )

      return h(
        'div',
        {
          style: ALBUM_SHELL,
          className: nightTheme ? 'dshComfySurface-dark' : 'dshComfySurface-light',
          ref: shellRef,
        },
        h(AlbumStyles),
        h(PulseKeyframes),
        h(
          'div',
          { style: ALBUM_HEAD },
          h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, '相册'),
          h('span', { style: Object.assign({}, SUB, NUM, { fontSize: 11 }) }, visible.length + ' 张'),
          comparing
            ? h(
                'span',
                { style: { fontSize: 10, color: 'var(--dsw-alias-brand-primary)', whiteSpace: 'nowrap' } },
                '对比 2 张',
              )
            : null,
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
          h(
            'button',
            {
              className: 'dshComfyAlbum-btn',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              },
              title: nightTheme ? '切换到日间' : '切换到夜间',
              'aria-label': nightTheme ? '切换到日间' : '切换到夜间',
              onClick: () => setAlbumTheme(nightTheme ? 'light' : 'dark'),
            },
            h(ThemeIcon, { night: nightTheme }),
          ),
          h('button', { className: 'dshComfyAlbum-btn', onClick: reload }, '刷新'),
        ),
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
      const [workspaceOn, setWorkspaceOn] = usePref('canvasWorkspace')

      if (props.view === 'summary') {
        return h(
          'span',
          { style: { zoom: UI_SCALE, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          '侧边栏状态' +
            (statusOn ? '开' : '关') +
            ' · 相册' +
            (albumOn ? '开' : '关') +
            ' · 画板MOSS' +
            (canvasOn ? '开' : '关') +
            ' · 工作台' +
            (workspaceOn ? '开' : '关'),
        )
      }

      return h(
        'div',
        { style: { zoom: UI_SCALE } },
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
        h(ModuleRow, {
          title: '独立画板工作台',
          description: '在左侧边栏「自动化任务」下加入口，点开是全屏画板工作台，不依赖右侧标签页。',
          checked: workspaceOn,
          onChange: setWorkspaceOn,
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
      zoom: UI_SCALE,
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
      maxHeight: 260,
      display: 'flex',
      flexDirection: 'column',
      padding: 4,
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    }

    /** Filter row shown on long lists (model pickers) at the top of the menu. */
    const DROPDOWN_SEARCH = {
      flex: 'none',
      width: '100%',
      boxSizing: 'border-box',
      marginBottom: 4,
      fontSize: 10.5,
      padding: '5px 7px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      outline: 'none',
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
      // Percentages instead of vw/vh: the overlay is zoomed, and viewport units
      // would be scaled a second time and overflow the screen.
      width: '94%',
      height: '92%',
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
      overflowY: 'auto',
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
    /** Whole-image caption under the box list, so the overlay works standalone. */
    const ZOOM_SUMMARY = {
      flex: 'none',
      padding: '8px 10px 10px',
      borderTop: '1px solid var(--dsw-alias-border-l2)',
    }
    const ZOOM_SUMMARY_AREA = {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: 40,
      maxHeight: 240,
      resize: 'vertical',
      padding: '5px 7px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 10.5,
      lineHeight: 1.5,
      fontFamily: 'inherit',
      outline: 'none',
    }
    /** Drag strip on the overlay side column's left edge. */
    const ZOOM_RESIZE_HANDLE = {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 7,
      zIndex: 3,
      cursor: 'col-resize',
      background: 'transparent',
      transition: 'background .15s ease',
    }

    /** Reference image + resolution controls, stated inline in the header row. */
    const ZOOM_TOOL_LABEL = {
      flex: 'none',
      fontSize: 10,
      color: 'var(--dsw-alias-label-secondary)',
    }

    /** Keep a dragged editor height inside what the panel can show. */
    function clampZoomHeight(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return 68
      return Math.min(240, Math.max(40, Math.round(n)))
    }

    /** Keep the overlay side column wide enough to read, narrow enough to leave the board room. */
    function clampZoomSide(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return 260
      return Math.min(480, Math.max(200, Math.round(n)))
    }

    /** Tick marks for one axis, spaced so around a dozen labels fit the canvas. */
    function buildRulerTicks(logical) {
      if (!logical) return []
      const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000]
      const step = steps.find((value) => value >= logical / 12) || 1000
      const ticks = []
      for (let value = 0; value <= logical; value += step) {
        ticks.push({ ratio: value / logical, label: value })
      }
      return ticks
    }

    /**
     * Ruler strips and layout guides drawn over one canvas wrapper.
     *
     * The host mounts it INSIDE the element whose rect is the picture, so every
     * position is relative CSS — no measuring, and ticks always point outwards.
     */
    function RulerLayer(props) {
      const width = props.width
      const height = props.height
      const [guideDraft, setGuideDraft] = useState(null)
      const wrapOf = () => (props.wrapRef ? props.wrapRef.current : null)

      const toLogical = (axis, event) => {
        const wrap = wrapOf()
        if (!wrap) return 0
        const rect = wrap.getBoundingClientRect()
        if (axis === 'h') {
          return Math.round(clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * height, 0, height))
        }
        return Math.round(clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * width, 0, width))
      }

      const insideBoard = (event) => {
        const wrap = wrapOf()
        if (!wrap) return false
        const rect = wrap.getBoundingClientRect()
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        )
      }

      /** Pull a fresh guide out of a ruler; releasing outside the board cancels it. */
      const startGuide = (axis, event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        if (!wrapOf()) return
        setGuideDraft({ axis, pos: toLogical(axis, event) })
        const move = (e) => setGuideDraft({ axis, pos: toLogical(axis, e) })
        const up = (e) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          const pos = toLogical(axis, e)
          setGuideDraft(null)
          if (insideBoard(e) && props.onGuidesChange) {
            props.onGuidesChange([...(props.guides || []), { axis, pos }])
          }
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }

      /** Move an existing guide; dragging it off the board removes it. */
      const dragGuide = (index, event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const guide = (props.guides || [])[index]
        if (!wrapOf() || !guide) return
        setGuideDraft({ axis: guide.axis, pos: guide.pos })
        const move = (e) => setGuideDraft({ axis: guide.axis, pos: toLogical(guide.axis, e) })
        const up = (e) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          const pos = toLogical(guide.axis, e)
          setGuideDraft(null)
          if (!props.onGuidesChange) return
          const next = (props.guides || []).slice()
          if (insideBoard(e)) next[index] = { axis: guide.axis, pos }
          else next.splice(index, 1)
          props.onGuidesChange(next)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }

      if (!props.rulerOn) return null

      return h(
        React.Fragment,
        null,
        h(
          'div',
          {
            style: {
              position: 'absolute',
              left: 0,
              top: -22,
              width: '100%',
              height: 22,
              pointerEvents: 'auto',
              cursor: 'row-resize',
              zIndex: 4,
            },
            title: '拖动拉出水平参考线',
            onPointerDown: (event) => startGuide('h', event),
          },
          ...buildRulerTicks(width).map((tick) =>
            h('div', {
              key: 'ruler-h-' + tick.label,
              style: {
                position: 'absolute',
                left: tick.ratio * 100 + '%',
                bottom: 0,
                width: 1,
                height: 5,
                background: 'var(--dsw-alias-label-secondary)',
                opacity: 0.45,
              },
            }),
          ),
          ...buildRulerTicks(width).map((tick) =>
            h(
              'span',
              {
                key: 'ruler-h-label-' + tick.label,
                style: {
                  position: 'absolute',
                  left: 'calc(' + tick.ratio * 100 + '% + 3px)',
                  bottom: 7,
                  fontSize: 8.5,
                  lineHeight: 1,
                  color: 'var(--dsw-alias-label-secondary)',
                  opacity: 0.7,
                  whiteSpace: 'nowrap',
                },
              },
              tick.label,
            ),
          ),
        ),
        h(
          'div',
          {
            style: {
              position: 'absolute',
              left: -22,
              top: 0,
              width: 22,
              height: '100%',
              pointerEvents: 'auto',
              cursor: 'col-resize',
              zIndex: 4,
            },
            title: '拖动拉出垂直参考线',
            onPointerDown: (event) => startGuide('v', event),
          },
          ...buildRulerTicks(height).map((tick) =>
            h('div', {
              key: 'ruler-v-' + tick.label,
              style: {
                position: 'absolute',
                top: tick.ratio * 100 + '%',
                right: 0,
                width: 5,
                height: 1,
                background: 'var(--dsw-alias-label-secondary)',
                opacity: 0.45,
              },
            }),
          ),
          ...buildRulerTicks(height).map((tick) =>
            h(
              'span',
              {
                key: 'ruler-v-label-' + tick.label,
                style: {
                  position: 'absolute',
                  top: 'calc(' + tick.ratio * 100 + '% - 4px)',
                  right: 7,
                  fontSize: 8.5,
                  lineHeight: 1,
                  color: 'var(--dsw-alias-label-secondary)',
                  opacity: 0.7,
                  whiteSpace: 'nowrap',
                  textAlign: 'right',
                },
              },
              tick.label,
            ),
          ),
        ),
        ...(props.guides || []).map((guide, index) =>
          h(
            'div',
            {
              key: 'guide-' + index,
              style: {
                position: 'absolute',
                ...(guide.axis === 'h'
                  ? {
                      left: 0,
                      width: '100%',
                      top: 'calc(' + (guide.pos / Math.max(1, height)) * 100 + '% - 4px)',
                      height: 8,
                    }
                  : {
                      top: 0,
                      height: '100%',
                      left: 'calc(' + (guide.pos / Math.max(1, width)) * 100 + '% - 4px)',
                      width: 8,
                    }),
                zIndex: 5,
                pointerEvents: 'auto',
                cursor: guide.axis === 'h' ? 'row-resize' : 'col-resize',
              },
              title: '拖动移动参考线，拖出画布删除',
              onPointerDown: (event) => dragGuide(index, event),
            },
            h('div', {
              style:
                guide.axis === 'h'
                  ? {
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 3,
                      height: 1,
                      background: '#3b82f6',
                      opacity: 0.9,
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: 3,
                      width: 1,
                      background: '#3b82f6',
                      opacity: 0.9,
                    },
            }),
          ),
        ),
        guideDraft
          ? h('div', {
              style: {
                position: 'absolute',
                ...(guideDraft.axis === 'h'
                  ? {
                      left: 0,
                      right: 0,
                      top: (guideDraft.pos / Math.max(1, height)) * 100 + '%',
                      height: 1,
                    }
                  : {
                      top: 0,
                      bottom: 0,
                      left: (guideDraft.pos / Math.max(1, width)) * 100 + '%',
                      width: 1,
                    }),
                background: '#3b82f6',
                opacity: 0.6,
                zIndex: 6,
                pointerEvents: 'none',
              },
            })
          : null,
      )
    }

    const MODAL_BACKDROP = {
      position: 'fixed',
      inset: 0,
      zIndex: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'rgba(0, 0, 0, 0.45)',
    }
    const MODAL_PANEL = {
      width: 380,
      maxWidth: 'calc(100vw - 32px)',
      // No overflow clipping: the dropdown menus open beyond this panel and must
      // not be cut off by it.
      overflow: 'visible',
      boxSizing: 'border-box',
      padding: 16,
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      border: '1px solid var(--dsw-alias-border-l2)',
      boxShadow: '0 18px 48px rgba(0, 0, 0, 0.4)',
    }

    /** Model + LoRA picker, shared by the canvas tab and the zoom overlay. */
    function ModelSettingsDialog(props) {
      const [options, setOptions] = useState(null)
      const [samplerChoices, setSamplerChoices] = useState(null)
      const models = props.models || {}
      const night = Boolean(props.night)
      const open = Boolean(props.open)

      useEffect(() => {
        if (!open || options) return undefined
        let alive = true
        fetch('/plugin/comfy-canvas/model-options', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (alive && data && data.ok) setOptions(data)
          })
          .catch(() => {
            // The pickers still show whatever is stored.
          })
        return () => {
          alive = false
        }
      }, [open, options])

      useEffect(() => {
        if (!open || samplerChoices) return undefined
        let alive = true
        fetch('/plugin/comfy-status/sampler-options', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (alive && data && Array.isArray(data.samplers) && data.samplers.length > 0) {
              setSamplerChoices(data)
            }
          })
          .catch(() => {
            // Keep the stored values; the dropdowns still show them.
          })
        return () => {
          alive = false
        }
      }, [open, samplerChoices])

      // The dialog keeps rendering through its exit animation; the parent only
      // flips `open`, so closing stays smooth instead of snapping away.
      const [visible, setVisible] = useState(open)
      const [closing, setClosing] = useState(false)
      const visibleRef = useRef(open)

      useEffect(() => {
        if (open) {
          visibleRef.current = true
          setVisible(true)
          setClosing(false)
          return undefined
        }
        if (!visibleRef.current) return undefined
        setClosing(true)
        const timer = setTimeout(() => {
          visibleRef.current = false
          setVisible(false)
          setClosing(false)
        }, 190)
        return () => clearTimeout(timer)
      }, [open])

      if (!visible) return null

      const overlayAnimation = closing
        ? 'dshComfyOverlayOut 160ms ease-out both'
        : 'dshComfyOverlayIn 200ms ease-out both'
      const panelAnimation = closing
        ? 'dshComfyPanelOut 160ms ease-out both'
        : 'dshComfyPanelIn 220ms cubic-bezier(0.23, 1, 0.32, 1) both'

      const rows = [
        ['unet', 'UNET'],
        ['clip', 'CLIP'],
        ['vae', 'VAE'],
      ]
      const update = (patch) => {
        if (props.onChange) props.onChange(Object.assign({}, models, patch))
      }
      const sampling = models.sampling || {}
      const setSampling = (patch) => update({ sampling: Object.assign({}, sampling, patch) })
      return h(
        'div',
        {
          style: Object.assign({}, MODAL_BACKDROP, { animation: overlayAnimation }),
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        h(
          'div',
          {
            className: night ? 'dshComfySurface-dark' : 'dshComfySurface-light',
            style: Object.assign({}, MODAL_PANEL, { animation: panelAnimation }),
            onClick: (event) => event.stopPropagation(),
          },
          h('div', { style: { fontWeight: 600, fontSize: 12.5, marginBottom: 4 } }, '生成设置'),
          h(
            'div',
            { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 } },
            '只影响画板的快速生成；未安装的模型会在提交前被拦下。',
          ),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 10 } },
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                disabled: !props.referenceMeta,
                title: props.referenceMeta
                  ? '用参考图的生成参数填写模型与 LoRA'
                  : '当前没有参考图',
                onClick: () => {
                  const meta = props.referenceMeta
                  if (!meta || !Array.isArray(meta.models)) return
                  const next = Object.assign({}, models)
                  meta.models.forEach((entry) => {
                    const role = String(entry.role || '').toLowerCase()
                    if (role === 'unet') next.unet = entry.name
                    else if (role === 'clip') next.clip = entry.name
                    else if (role === 'vae') next.vae = entry.name
                  })
                  next.loras = meta.models
                    .filter((entry) => entry.role === 'LoRA')
                    .slice(0, 4)
                    .map((entry) => ({
                      name: entry.name,
                      strength: typeof entry.strength === 'number' ? entry.strength : 1,
                    }))
                  update(next)
                },
              },
              '读取参考图',
            ),
          ),
          options === null
            ? h(
                'div',
                { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10 } },
                '正在读取 ComfyUI 的模型列表…',
              )
            : null,
          ...rows.map(([key, label]) => {
            const list = (options && options[key]) || []
            const value = models[key] || ''
            const missing = list.length > 0 && value && list.indexOf(value) < 0
            return h(
              'div',
              { key, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
              h(
                'span',
                {
                  style: {
                    flex: 'none',
                    width: 44,
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                label,
              ),
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(Dropdown, {
                  title: label + ' 模型',
                  placeholder: '选择模型',
                  value,
                  options: list.map((entry) => ({ value: entry, label: entry })),
                  onPick: (next) => update({ [key]: next }),
                  dark: night,
                }),
              ),
              missing
                ? h(
                    'span',
                    { style: { flex: 'none', fontSize: 9.5, color: 'var(--dsw-alias-state-error-primary)' } },
                    '未安装',
                  )
                : null,
            )
          }),
          ...(Array.isArray(models.loras) ? models.loras : []).map((entry, index) =>
            h(
              'div',
              { key: 'lora-' + index, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
              h(
                'span',
                {
                  style: {
                    flex: 'none',
                    width: 44,
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                index === 0 ? 'LoRA' : '',
              ),
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(Dropdown, {
                  title: 'LoRA ' + (index + 1),
                  placeholder: '选择 LoRA',
                  value: entry.name || '',
                  options: ((options && options.lora) || []).map((value) => ({ value, label: value })),
                  onPick: (next) => {
                    const copy = (Array.isArray(models.loras) ? models.loras : []).slice()
                    copy[index] = Object.assign({}, copy[index], { name: next })
                    update({ loras: copy })
                  },
                  dark: night,
                }),
              ),
              h('input', {
                type: 'number',
                step: 0.05,
                value: entry.strength,
                title: 'LoRA 强度',
                style: {
                  flex: 'none',
                  width: 62,
                  boxSizing: 'border-box',
                  fontSize: 10.5,
                  padding: '5px 7px',
                  borderRadius: 6,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  color: 'var(--dsw-alias-label-primary)',
                  fontFamily: 'inherit',
                },
                onChange: (event) => {
                  const next = Number(event.target.value)
                  if (!Number.isFinite(next)) return
                  const copy = (Array.isArray(models.loras) ? models.loras : []).slice()
                  copy[index] = Object.assign({}, copy[index], { strength: next })
                  update({ loras: copy })
                },
              }),
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  title: '移除这个 LoRA',
                  onClick: () => {
                    const copy = (Array.isArray(models.loras) ? models.loras : []).slice()
                    copy.splice(index, 1)
                    update({ loras: copy })
                  },
                },
                '删除',
              ),
            ),
          ),
          (Array.isArray(models.loras) ? models.loras.length : 0) < 4
            ? h(
                'div',
                { style: { marginBottom: 8 } },
                h(
                  'button',
                  {
                    className: 'dshCanvasBtn',
                    onClick: () =>
                      update({
                        loras: [...(Array.isArray(models.loras) ? models.loras : []), { name: '', strength: 1 }],
                      }),
                  },
                  '+ 添加 LoRA',
                ),
              )
            : null,
          h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '2px 0 10px' } }),
          h('div', { style: { fontWeight: 600, fontSize: 11, marginBottom: 8 } }, '采样'),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h(
              'span',
              {
                style: {
                  flex: 'none',
                  width: 44,
                  fontSize: 10.5,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              '步数',
            ),
            h('input', {
              type: 'number',
              min: 1,
              max: 100,
              step: 1,
              value: sampling.steps,
              style: {
                flex: 'none',
                width: 64,
                boxSizing: 'border-box',
                fontSize: 10.5,
                padding: '5px 7px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
                fontFamily: 'inherit',
              },
              onChange: (event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) setSampling({ steps: next })
              },
            }),
            h(
              'span',
              {
                style: {
                  flex: 'none',
                  width: 44,
                  fontSize: 10.5,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              'CFG',
            ),
            h('input', {
              type: 'number',
              min: 0,
              max: 30,
              step: 0.1,
              value: sampling.cfg,
              style: {
                flex: 'none',
                width: 64,
                boxSizing: 'border-box',
                fontSize: 10.5,
                padding: '5px 7px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
                fontFamily: 'inherit',
              },
              onChange: (event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) setSampling({ cfg: next })
              },
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h(
              'span',
              {
                style: {
                  flex: 'none',
                  width: 44,
                  fontSize: 10.5,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              '采样器',
            ),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(Dropdown, {
                title: '采样器',
                placeholder: sampling.sampler || '采样器',
                value: sampling.sampler || '',
                options: ((samplerChoices && samplerChoices.samplers) || []).map((value) => ({
                  value,
                  label: value,
                })),
                onPick: (next) => setSampling({ sampler: next }),
                dark: night,
              }),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h(
              'span',
              {
                style: {
                  flex: 'none',
                  width: 44,
                  fontSize: 10.5,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              '调度',
            ),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(Dropdown, {
                title: '调度',
                placeholder: sampling.scheduler || '调度',
                value: sampling.scheduler || '',
                options: ((samplerChoices && samplerChoices.schedulers) || []).map((value) => ({
                  value,
                  label: value,
                })),
                onPick: (next) => setSampling({ scheduler: next }),
                dark: night,
              }),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 } },
            h('button', { className: 'dshCanvasBtn', onClick: props.onClose }, '完成'),
          ),
        ),
      )
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
      borderRadius: 6,
      padding: '5px 8px',
      fontSize: 10.5,
      fontWeight: 500,
      lineHeight: 1.35,
      fontFamily: 'inherit',
      cursor: 'pointer',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      transition: 'background .15s ease, color .15s ease, box-shadow .15s ease',
    }
    // The selected segment reads as a filled blue pill: the wrapper supplies the
    // inset track, so the active half needs its own colour, not a background swap.
    const SEGMENT_ON = Object.assign({}, SEGMENT, {
      background: '#3b82f6',
      color: '#ffffff',
      fontWeight: 600,
      cursor: 'default',
      boxShadow: '0 1px 3px rgba(59, 130, 246, 0.35)',
    })

    /** Segmented control whose blue thumb slides between the options. */
    function SegmentToggle(props) {
      const options = props.options || []
      const found = options.findIndex((option) => option.value === props.value)
      const index = found >= 0 ? found : 0
      const width = 'calc((100% - 6px) / ' + Math.max(1, options.length) + ')'
      return h(
        'div',
        { style: Object.assign({}, SEGMENT_WRAP, { position: 'relative' }) },
        h('div', {
          style: {
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 3,
            width,
            borderRadius: 6,
            background: '#3b82f6',
            boxShadow: '0 1px 3px rgba(59, 130, 246, 0.35)',
            transform: 'translateX(' + index * 100 + '%)',
            transition: 'transform .22s cubic-bezier(0.23, 1, 0.32, 1)',
            pointerEvents: 'none',
          },
        }),
        ...options.map((option, at) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              style: Object.assign({}, SEGMENT, {
                position: 'relative',
                zIndex: 1,
                background: 'transparent',
                color: at === index ? '#ffffff' : 'var(--dsw-alias-label-secondary)',
                fontWeight: at === index ? 600 : 500,
                cursor: at === index ? 'default' : 'pointer',
                transition: 'color .18s ease',
              }),
              onClick: () => {
                if (at !== index) props.onChange(option.value)
              },
            },
            option.label,
          ),
        ),
      )
    }
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
          '.dshCanvasBtn{transition:transform 160ms cubic-bezier(0.23,1,0.32,1)}',
          '.dshCanvasBtn:active:not(:disabled){transform:scale(.97) translateY(1px)}',
          '@media (prefers-reduced-motion:reduce){.dshCanvasBtn{transition:none}.dshCanvasBtn:active:not(:disabled){transform:none}}',
          '.dshCanvasBtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
          '.dshCanvasBtn:disabled{opacity:.4;cursor:default}',
          '.dshCanvasBtn[data-tone="primary"]{background:var(--dsw-alias-brand-primary);color:var(--dshcomfy-on-brand);border-color:var(--dsw-alias-brand-primary)}',
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
          '.dshCanvasOption[data-on="true"]{background:var(--dsw-alias-brand-primary);color:var(--dshcomfy-on-brand)}',
          '.dshCanvasBoxItem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshCanvasBoxItem{appearance:none;display:flex;align-items:center;gap:5px;width:100%;box-sizing:border-box;font:inherit;font-size:10px;padding:3px 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;outline:none}',
          '.dshCanvasBoxItem:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasBoxItem:focus{outline:none}',
          '.dshCanvasBoxItem[data-on="true"]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
          '@keyframes dshComfyOverlayIn{from{opacity:0}to{opacity:1}}',
          '@keyframes dshComfyOverlayOut{from{opacity:1}to{opacity:0}}',
          '@keyframes dshComfyPanelIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}',
          '@keyframes dshComfyPanelOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.98)}}',
          '@keyframes dshComfyDropIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
          '@keyframes dshComfyJobSlide{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}',
          '@keyframes dshComfyJobPulse{0%,100%{opacity:.45}50%{opacity:1}}',
          '@keyframes dshComfyGlowInBlue{from{box-shadow:0 0 0 rgba(59,130,246,0)}to{box-shadow:0 0 18px rgba(59,130,246,.72)}}',
          '@keyframes dshComfyGlowBreatheBlue{0%,100%{box-shadow:0 0 18px rgba(59,130,246,.72)}50%{box-shadow:0 0 8px rgba(59,130,246,.35)}}',
          '@keyframes dshComfyGlowInRed{from{box-shadow:0 0 0 rgba(239,68,68,0)}to{box-shadow:0 0 18px rgba(239,68,68,.68)}}',
          '@keyframes dshComfyGlowBreatheRed{0%,100%{box-shadow:0 0 18px rgba(239,68,68,.68)}50%{box-shadow:0 0 8px rgba(239,68,68,.3)}}',
          '.dshComfyGenBlue:hover:not(:disabled){animation:dshComfyGlowInBlue .28s ease-out forwards,dshComfyGlowBreatheBlue 2.4s ease-in-out .28s infinite}',
          '.dshComfyGenRed:hover:not(:disabled){animation:dshComfyGlowInRed .28s ease-out forwards,dshComfyGlowBreatheRed 2.4s ease-in-out .28s infinite}',
          '@media (prefers-reduced-motion:reduce){.dshComfyGenBlue:hover,.dshComfyGenRed:hover{animation:none!important}}',
          '.dshCanvasBtn:hover:not(:disabled){filter:brightness(1.08)}',
          '.dshComfyAlbum-card{transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease}',
          '.dshComfyAlbum-card:hover{border-color:#3b82f6;transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,0,0,.12)}',
          '.dshComfyAlbum-card img{transition:transform .22s ease}',
          '.dshComfyAlbum-card:hover img{transform:scale(1.04)}',
          SURFACE_LIGHT_CSS,
          SURFACE_DARK_CSS,
          THEME_ICON_CSS,
          '.dshComfyZoom-resize:hover{background:rgba(128,128,128,.18)}',
          '.dshComfySurface-dark,.dshComfySurface-light{transition:background-color .3s ease,color .3s ease}',
          '.dshComfySurface-dark *,.dshComfySurface-light *{transition:background-color .26s ease,color .26s ease,border-color .26s ease}',
          '@media (prefers-reduced-motion:reduce){.dshComfySurface-dark,.dshComfySurface-light,.dshComfySurface-dark *,.dshComfySurface-light *{transition:none!important}}',
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
     * Bottom-right grab handle on the selected box: a small rounded key with a
     * diagonal-resize glyph, so it reads as a control rather than a stray pixel.
     */
    const HANDLE = {
      position: 'absolute',
      right: -3,
      bottom: -3,
      width: 16,
      height: 16,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      border: '1px solid var(--dsw-alias-brand-primary)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-brand-primary)',
      cursor: 'nwse-resize',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    /** A guide is { axis: 'h' | 'v', pos } in canvas pixels; anything else is dropped. */
    function normalizeGuide(entry) {
      if (!entry || typeof entry !== 'object') return null
      const axis = entry.axis === 'v' ? 'v' : entry.axis === 'h' ? 'h' : null
      const pos = Number(entry.pos)
      if (!axis || !Number.isFinite(pos)) return null
      return { axis, pos: Math.round(pos) }
    }

    /**
     * Snap a dragged box to guides, canvas edges/center and other boxes.
     * The threshold arrives already converted from screen pixels to canvas pixels.
     */
    function snapBoxMove(x, y, width, height, context) {
      const threshold = context.threshold
      const xTargets = []
      const yTargets = []
      for (const guide of context.guides || []) {
        if (guide.axis === 'v') xTargets.push(guide.pos)
        else yTargets.push(guide.pos)
      }
      xTargets.push(0, context.size.width / 2, context.size.width)
      yTargets.push(0, context.size.height / 2, context.size.height)
      ;(context.boxes || []).forEach((box, index) => {
        if (index === context.index) return
        xTargets.push(box.x, box.x + box.width / 2, box.x + box.width)
        yTargets.push(box.y, box.y + box.height / 2, box.y + box.height)
      })

      const pick = (ownValues, targets) => {
        let best = null
        for (const target of targets) {
          for (const own of ownValues) {
            const delta = target - own
            if (Math.abs(delta) > threshold) continue
            if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
              best = { delta, target }
            }
          }
        }
        return best
      }

      const lines = []
      let nextX = x
      let nextY = y
      const bestX = pick([x, x + width / 2, x + width], xTargets)
      if (bestX) {
        nextX = x + bestX.delta
        lines.push({ axis: 'v', pos: bestX.target })
      }
      const bestY = pick([y, y + height / 2, y + height], yTargets)
      if (bestY) {
        nextY = y + bestY.delta
        lines.push({ axis: 'h', pos: bestY.target })
      }
      return { x: nextX, y: nextY, lines }
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
      const [snapLines, setSnapLines] = useState(null)

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
            let nextWidth = clamp(drag.origW + dx, minimum, maxWidth)
            let nextHeight = clamp(drag.origH + dy, minimum, maxHeight)
            // Resizing snaps to guides only (not to canvas edges or other boxes):
            // the right/bottom edge is what the handle actually moves.
            if (!event.shiftKey) {
              const scale = rect.width / Math.max(1, props.width)
              const threshold = 4 / Math.max(0.01, scale)
              const lines = []
              let bestX = null
              let bestY = null
              for (const guide of props.guides || []) {
                if (guide.axis === 'v') {
                  const delta = guide.pos - (box.x + nextWidth)
                  if (Math.abs(delta) <= threshold && (bestX === null || Math.abs(delta) < Math.abs(bestX.delta))) {
                    bestX = { delta, target: guide.pos }
                  }
                } else {
                  const delta = guide.pos - (box.y + nextHeight)
                  if (Math.abs(delta) <= threshold && (bestY === null || Math.abs(delta) < Math.abs(bestY.delta))) {
                    bestY = { delta, target: guide.pos }
                  }
                }
              }
              if (bestX) {
                nextWidth = clamp(bestX.target - box.x, minimum, maxWidth)
                lines.push({ axis: 'v', pos: bestX.target })
              }
              if (bestY) {
                nextHeight = clamp(bestY.target - box.y, minimum, maxHeight)
                lines.push({ axis: 'h', pos: bestY.target })
              }
              setSnapLines(lines.length > 0 ? lines : null)
            } else {
              setSnapLines(null)
            }
            props.onChange(drag.index, {
              width: Math.round(nextWidth),
              height: Math.round(nextHeight),
            })
            return
          }
          const rawX = clamp(drag.origX + dx, 0, props.width - box.width)
          const rawY = clamp(drag.origY + dy, 0, props.height - box.height)
          const scale = rect.width / Math.max(1, props.width)
          const snapped = event.shiftKey
            ? { x: rawX, y: rawY, lines: [] }
            : snapBoxMove(rawX, rawY, box.width, box.height, {
                size: { width: props.width, height: props.height },
                boxes: props.boxes,
                guides: props.guides,
                index: drag.index,
                threshold: 4 / Math.max(0.01, scale),
              })
          setSnapLines(snapped.lines)
          props.onChange(drag.index, {
            x: Math.round(clamp(snapped.x, 0, props.width - box.width)),
            y: Math.round(clamp(snapped.y, 0, props.height - box.height)),
          })
        }
        const onUp = () => {
          setDrag(null)
          setSnapLines(null)
        }
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
          style: Object.assign(
            {},
            BOARD,
            props.fill
              ? { width: '100%', height: '100%' }
              : {
                  // Width capped by BOTH the stage width and the ratio at max
                  // height: a portrait board sized `100%` wide is taller than its
                  // max height, which pushed its top edge past the stage.
                  width: 'min(100%, calc(' + (props.maxHeight || BOARD_MAX_HEIGHT) + ' * ' + ratio + '))',
                  aspectRatio: props.width + ' / ' + props.height,
                },
          ),
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
          onDoubleClick: (event) => {
            // Only empty space: box double clicks stop propagation themselves.
            if (props.preview || event.target !== boardRef.current) return
            if (!props.onAddAt || !boardRef.current) return
            const rect = boardRef.current.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return
            const x = ((event.clientX - rect.left) / rect.width) * props.width
            const y = ((event.clientY - rect.top) / rect.height) * props.height
            props.onAddAt(x, y)
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
                // Preview shows the picture at its own opacity, with the boxes gone.
                opacity: props.preview ? 1 : props.reference.opacity,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })
          : null,
        ...(snapLines || []).map((line, index) =>
          h('div', {
            key: 'snap-line-' + index,
            style: {
              position: 'absolute',
              ...(line.axis === 'h'
                ? { left: 0, right: 0, top: (line.pos / Math.max(1, props.height)) * 100 + '%', height: 1 }
                : { top: 0, bottom: 0, left: (line.pos / Math.max(1, props.width)) * 100 + '%', width: 1 }),
              background: '#ec4899',
              opacity: 0.9,
              pointerEvents: 'none',
              zIndex: 30,
            },
          }),
        ),
        ...(props.preview ? [] : props.boxes.map((box, index) =>
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
              ? h(
                  'div',
                  {
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
                  },
                  h(Icon, { name: 'move-diagonal', size: 10 }),
                )
              : null,
          ),
        )),
      )
    }

    /**
     * A self-drawn dropdown. A native <select> renders its open list itself, so
     * newly fetched options cannot appear until it is reopened; this one re-renders
     * from React state while open.
     */
    function Dropdown(props) {
      const dark = Boolean(props.dark)
      const [open, setOpen] = useState(false)
      const [reducedMotion] = useState(
        () =>
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
      const boxRef = useRef(null)
      const [query, setQuery] = useState('')

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

      const choices = props.options || []
      const normalized = query.trim().toLowerCase()
      const filtered = normalized
        ? choices.filter((option) => String(option.label).toLowerCase().indexOf(normalized) >= 0)
        : choices
      const current = choices.find((option) => option.value === props.value)
      const menuSkin = dark
        ? {
            border: '1px solid rgba(255, 255, 255, 0.14)',
            background: 'rgba(30, 30, 34, 0.98)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
          }
        : null

      return h(
        'div',
        { ref: boxRef, style: { position: 'relative', flex: '1 1 0', minWidth: 96 } },
        h(
          'button',
          {
            type: 'button',
            className: 'dshCanvasPicker',
            'data-dark': dark ? 'true' : undefined,
            title: props.title,
            // A flex row with an empty label collapses to its padding; keep the
            // trigger at a usable height even before a value is picked.
            style: { minHeight: 22 },
            onClick: () => {
              if (!open) {
                setQuery('')
                if (props.onOpen) props.onOpen()
              }
              setOpen(!open)
            },
          },
          h(
            'span',
            { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            current ? current.label : props.placeholder || '',
          ),
        ),
        open
          ? h(
              'div',
              {
                style: Object.assign({}, DROPDOWN, menuSkin, {
                  // Long names (workflow files, model files) need a wider menu
                  // than the trigger can afford.
                  minWidth: props.menuMinWidth || undefined,
                  animation: reducedMotion
                    ? 'dshComfyOverlayIn 120ms ease both'
                    : 'dshComfyDropIn 140ms cubic-bezier(0.23, 1, 0.32, 1) both',
                }),
              },
              choices.length > 8
                ? h('input', {
                    type: 'search',
                    value: query,
                    placeholder: '搜索…',
                    autoFocus: true,
                    style: DROPDOWN_SEARCH,
                    onChange: (event) => setQuery(event.target.value),
                    onKeyDown: (event) => {
                      if (event.isComposing) return
                      if (event.key === 'Enter' && filtered.length > 0) {
                        event.preventDefault()
                        props.onPick(filtered[0].value)
                        setOpen(false)
                      }
                    },
                  })
                : null,
              h(
                'div',
                {
                  style: {
                    overflowY: 'auto',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  },
                },
                ...filtered.map((option) =>
                  h(
                    'button',
                    {
                      key: option.value,
                      type: 'button',
                      className: 'dshCanvasOption',
                      'data-on': option.value === props.value ? 'true' : 'false',
                      'data-dark': dark ? 'true' : undefined,
                      title: option.label,
                      // The flex column would otherwise shrink every row and
                      // squeeze the labels together.
                      style: { flex: 'none' },
                      onClick: () => {
                        props.onPick(option.value)
                        setOpen(false)
                      },
                    },
                    option.label,
                  ),
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
      const [overlayTheme] = usePref('albumTheme')
      const overlayNight = overlayTheme !== 'light'
      const [localEditing, setLocalEditing] = useState(null)
      const [localDraft, setLocalDraft] = useState('')
      const [confirmRemove, setConfirmRemove] = useState(false)
      const [closing, setClosing] = useState(false)
      // Read once: the preference does not change mid-gesture.
      const [reducedMotion] = useState(
        () =>
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
      const closingRef = useRef(false)
      const closeTimer = useRef(null)
      const [summaryHeight, setSummaryHeight] = usePref('zoomSummaryHeight')
      const [descHeight, setDescHeight] = usePref('zoomDescHeight')
      const [sideWidth, setSideWidthPref] = usePref('zoomPanelWidth')
      const [liveSideWidth, setLiveSideWidth] = useState(null)
      const sideDragRef = useRef(null)
      const liveSideRef = useRef(null)
      const sideHandlersRef = useRef(null)
      const [preview, setPreview] = useState(false)
      const [rulerOn, setRulerOn] = usePref('canvasRuler')
      const boardWrapRef = useRef(null)
      const [canvasModels, setCanvasModels] = usePref('canvasModels')
      const [modelPanel, setModelPanel] = useState(false)
      const [job, setJob] = useState(() => jobStore.get())
      const [jobClock, setJobClock] = useState(() => Date.now())
      const jobActive = job !== null && (job.status === 'queued' || job.status === 'running')
      const summaryRef = useRef(null)
      const descRef = useRef(null)

      // The overlay unmounts only after the exit animation, so the timer must not
      // outlive the component.
      useEffect(
        () => () => {
          if (closeTimer.current) clearTimeout(closeTimer.current)
        },
        [],
      )

      // A side-width drag listens on window; drop those listeners with the overlay.
      useEffect(
        () => () => {
          const handlers = sideHandlersRef.current
          if (!handlers) return
          window.removeEventListener('pointermove', handlers.move)
          window.removeEventListener('pointerup', handlers.up)
          window.removeEventListener('pointercancel', handlers.up)
        },
        [],
      )

      useEffect(() => jobStore.subscribe(() => setJob(jobStore.get())), [])

      useEffect(() => {
        if (!jobActive) return undefined
        setJobClock(Date.now())
        const timer = setInterval(() => setJobClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [jobActive])

      const jobElapsed = job && job.at && jobClock ? Math.max(0, Math.floor((jobClock - job.at) / 1000)) : 0


      const missingModels = Array.isArray(props.missingModels) ? props.missingModels : null

      // Native textarea resize does not reliably fire mouseup on the element, so
      // the settled height is read off the box itself instead of the event.
      useEffect(() => {
        const node = summaryRef.current
        if (!node) return undefined
        let timer = null
        const observer = new ResizeObserver(() => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const height = Math.round(node.offsetHeight)
            if (height > 0) setSummaryHeight(clampZoomHeight(height))
          }, 250)
        })
        observer.observe(node)
        return () => {
          observer.disconnect()
          if (timer) clearTimeout(timer)
        }
      }, [])

      useEffect(() => {
        const node = descRef.current
        if (!node) return undefined
        let timer = null
        const observer = new ResizeObserver(() => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const height = Math.round(node.offsetHeight)
            if (height > 0) setDescHeight(clampZoomHeight(height))
          }, 250)
        })
        observer.observe(node)
        return () => {
          observer.disconnect()
          if (timer) clearTimeout(timer)
        }
      }, [props.selected])

      const requestClose = () => {
        if (closingRef.current) return
        closingRef.current = true
        setClosing(true)
        closeTimer.current = setTimeout(() => {
          if (onClose) onClose()
        }, 190)
      }

      // Between pointerdown and pointerup the live width wins; the stored one is
      // written once the drag ends.
      const sidePx = clampZoomSide(liveSideWidth === null ? sideWidth : liveSideWidth)

      const onSideMove = (event) => {
        const drag = sideDragRef.current
        if (!drag) return
        const limit = Math.max(200, Math.min(480, window.innerWidth * 0.5))
        const next = Math.min(limit, Math.max(200, drag.startWidth - (event.clientX - drag.startX)))
        liveSideRef.current = next
        setLiveSideWidth(next)
      }

      const onSideUp = () => {
        if (!sideDragRef.current) return
        sideDragRef.current = null
        window.removeEventListener('pointermove', onSideMove)
        window.removeEventListener('pointerup', onSideUp)
        window.removeEventListener('pointercancel', onSideUp)
        if (liveSideRef.current !== null) setSideWidthPref(clampZoomSide(liveSideRef.current))
        liveSideRef.current = null
        setLiveSideWidth(null)
      }

      const onSideDown = (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        sideDragRef.current = { startX: event.clientX, startWidth: sidePx }
        liveSideRef.current = sidePx
        setLiveSideWidth(sidePx)
        sideHandlersRef.current = { move: onSideMove, up: onSideUp }
        window.addEventListener('pointermove', onSideMove)
        window.addEventListener('pointerup', onSideUp)
        window.addEventListener('pointercancel', onSideUp)
      }

      const overlayAnimation = closing
        ? 'dshComfyOverlayOut 160ms ease-out both'
        : 'dshComfyOverlayIn 200ms ease-out both'
      const panelAnimation = reducedMotion
        ? 'none'
        : closing
          ? 'dshComfyPanelOut 160ms ease-out both'
          : 'dshComfyPanelIn 220ms cubic-bezier(0.23, 1, 0.32, 1) both'

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
          if (event.key === 'Escape') requestClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [])

      const selectedBox = props.selected !== null ? props.boxes[props.selected] : null

      return h(
        'div',
        {
          style: Object.assign({}, OVERLAY, { animation: overlayAnimation, zoom: UI_SCALE }),
          // Only a click on the backdrop itself closes the overlay. Clicks that
          // bubble out of the panel (or a floating dialog) must not.
          onClick: (event) => {
            if (event.target === event.currentTarget) requestClose()
          },
          role: 'presentation',
        },
        h(
          'div',
          {
            style: Object.assign({}, PANEL, { animation: panelAnimation }),
            className: overlayNight ? 'dshComfySurface-dark' : 'dshComfySurface-light',
            role: 'dialog',
            'aria-label': 'MOSS 画框大视图',
            onClick: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { style: PANEL_HEAD },
            h(
              'span',
              { style: { fontWeight: 600, whiteSpace: 'nowrap' } },
              '画框 MOSS · ' + props.width + ' × ' + props.height,
            ),
            jobActive
              ? h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' } },
                  h('span', {
                    style: {
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      flex: 'none',
                      background: '#ff5a5a',
                      animation: 'dshComfyJobPulse 1.1s ease-in-out infinite',
                    },
                  }),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: '#ff6b6b',
                        whiteSpace: 'nowrap',
                      },
                    },
                    job.status === 'running' ? '正在生成' : '排队中',
                  ),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 10,
                        color: 'rgba(255, 107, 107, 0.85)',
                        fontVariantNumeric: 'tabular-nums',
                      },
                    },
                    jobElapsed + 's',
                  ),
                  h(
                    'div',
                    {
                      style: {
                        width: 64,
                        height: 3,
                        borderRadius: 99,
                        background: 'var(--dsw-alias-bg-layer-2)',
                        overflow: 'hidden',
                        flex: 'none',
                      },
                    },
                    h('div', {
                      style: {
                        width: '40%',
                        height: '100%',
                        borderRadius: 99,
                        background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
                        animation: 'dshComfyJobSlide 1.15s ease-in-out infinite',
                      },
                    }),
                  ),
                  h(
                    'button',
                    {
                      className: 'dshCanvasBtn',
                      style: {
                        flexShrink: 0,
                        padding: '2px 8px',
                        color: '#ff6b6b',
                        borderColor: 'rgba(255, 90, 90, 0.5)',
                      },
                      title: '停止任务',
                      onClick: cancelTrackedJob,
                    },
                    '停止',
                  ),
                )
              : props.status
                ? h(
                    'span',
                    {
                      style: Object.assign({}, CANVAS_SUB, {
                        fontSize: 10.5,
                        maxWidth: 170,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }),
                    },
                    props.status,
                  )
                : null,
            h('span', { style: { flex: 1 } }),
            h('span', { style: ZOOM_TOOL_LABEL }, '参考'),
            h(
              'div',
              { style: { flex: '0 1 200px', minWidth: 120 } },
              h(Dropdown, {
                title: '参考图（来自 ComfyUI 相册）',
                placeholder: '选择参考图',
                value: props.referenceUrl || '',
                options: [
                  { value: '', label: '无' },
                  ...(props.referenceOptions || []).map((option) => ({ value: option.url, label: option.label })),
                  ...(props.referenceKind === 'file' && props.referenceUrl
                    ? [{ value: props.referenceUrl, label: '本地 · ' + (props.referenceName || '') }]
                    : []),
                ],
                onOpen: () => {
                  if (props.onRefreshReference) props.onRefreshReference()
                },
                onPick: (value) => {
                  if (props.onReferencePick) props.onReferencePick(value)
                },
                dark: overlayNight,
              }),
            ),
            h('span', { style: ZOOM_TOOL_LABEL }, '比例'),
            h(
              'div',
              { style: { flex: 'none', width: 150 } },
              h(Dropdown, {
                title: '画面比例',
                placeholder: '比例',
                value: props.ratio || (props.ratioOptions && props.ratioOptions[0]) || '',
                options: (props.ratioOptions || []).map((option) => ({ value: option, label: option })),
                onPick: (value) => {
                  if (props.onRatioChange) props.onRatioChange(value)
                },
                dark: overlayNight,
              }),
            ),
            h('input', {
              type: 'number',
              value: props.megapixels || 1,
              min: props.mpMeta && typeof props.mpMeta.min === 'number' ? props.mpMeta.min : 0.1,
              max: props.mpMeta && typeof props.mpMeta.max === 'number' ? props.mpMeta.max : 16,
              step: props.mpMeta && typeof props.mpMeta.step === 'number' ? props.mpMeta.step : 0.1,
              style: Object.assign({}, RES_MP, NUM),
              title: '百万像素',
              onChange: (event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next) && next > 0 && props.onMegapixelsChange) {
                  props.onMegapixelsChange(next)
                }
              },
            }),
            h('span', { style: ZOOM_TOOL_LABEL }, 'MP'),
            h('span', { style: ZOOM_TOOL_LABEL }, '种子'),
            h('input', {
              type: 'number',
              value: (canvasModels.sampling && canvasModels.sampling.seed) || 0,
              disabled: (canvasModels.sampling && canvasModels.sampling.seedMode) === 'random',
              title:
                (canvasModels.sampling && canvasModels.sampling.seedMode) === 'random'
                  ? '随机模式：每次快速生成自动换种子'
                  : '固定种子',
              style: {
                flex: 'none',
                width: 92,
                boxSizing: 'border-box',
                fontSize: 10.5,
                padding: '5px 7px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
                fontFamily: 'inherit',
                opacity: (canvasModels.sampling && canvasModels.sampling.seedMode) === 'random' ? 0.55 : 1,
              },
              onChange: (event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                const sampling = Object.assign({}, canvasModels.sampling, {
                  seed: Math.max(0, Math.floor(next)),
                })
                setCanvasModels(Object.assign({}, canvasModels, { sampling }))
              },
            }),
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                title:
                  (canvasModels.sampling && canvasModels.sampling.seedMode) === 'random'
                    ? '随机模式已开启：每次快速生成换一个种子'
                    : '开启随机模式：每次快速生成自动换种子',
                style: Object.assign(
                  {
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  },
                  (canvasModels.sampling && canvasModels.sampling.seedMode) === 'random'
                    ? { background: '#3b82f6', borderColor: '#3b82f6', color: '#ffffff', fontWeight: 600 }
                    : null,
                ),
                onClick: () => {
                  const sampling = canvasModels.sampling || {}
                  const nextMode = sampling.seedMode === 'random' ? 'fixed' : 'random'
                  const patch = { seedMode: nextMode }
                  if (nextMode === 'random') patch.seed = Math.floor(Math.random() * 1e15)
                  setCanvasModels(Object.assign({}, canvasModels, { sampling: Object.assign({}, sampling, patch) }))
                },
              },
              h(Icon, { name: 'shuffle', size: 12 }),
              h('span', null, '随机'),
            ),
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                title: '从参考图读取种子',
                style: { flexShrink: 0 },
                disabled: !props.referenceMeta,
                onClick: () => {
                  const meta = props.referenceMeta
                  const seed =
                    meta && meta.sampler && typeof meta.sampler.seed === 'number' ? meta.sampler.seed : null
                  if (seed === null) return
                  const sampling = Object.assign({}, canvasModels.sampling, { seed, seedMode: 'fixed' })
                  setCanvasModels(Object.assign({}, canvasModels, { sampling }))
                },
              },
              '读取',
            ),
            h(
              'span',
              { style: Object.assign({}, CANVAS_SUB, { fontSize: 10.5, whiteSpace: 'nowrap' }) },
              props.boxes.length + ' 个框',
            ),
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                title: '标尺',
                style: { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 },
                onClick: () => setRulerOn(!rulerOn),
              },
              h(Icon, { name: 'ruler', size: 12 }),
              h('span', null, '标尺'),
            ),
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                title: '生成设置：模型 / LoRA / 采样',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                },
                onClick: () => setModelPanel(true),
              },
              h(Icon, { name: 'sliders-horizontal', size: 12 }),
              h('span', null, '模型'),
            ),
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                onClick: () => {
                  if (props.onAdd) props.onAdd()
                },
              },
              props.boxes.length === 0 ? '加第一个框' : '加框',
            ),
            h(
              'button',
              {
                className: 'dshCanvasBtn dshComfyGenBlue',
                disabled: props.boxes.length === 0,
                title: '不经过 agent，直接把当前版式提交给 ComfyUI',
                style: {
                  background: '#3b82f6',
                  borderColor: '#3b82f6',
                  color: '#ffffff',
                  fontWeight: 600,
                  opacity: props.boxes.length === 0 ? 0.45 : 1,
                },
                onClick: () => {
                  if (props.onGenerate) props.onGenerate()
                },
              },
              '快速生成',
            ),
            h(
              'button',
              {
                className: 'dshCanvasBtn dshComfyGenRed',
                disabled: props.boxes.length === 0,
                style: {
                  background: '#ef4444',
                  borderColor: '#ef4444',
                  color: '#ffffff',
                  fontWeight: 600,
                  opacity: props.boxes.length === 0 ? 0.45 : 1,
                },
                onClick: () => {
                  if (props.onSend) props.onSend()
                },
              },
              props.confirmSend ? '确认发送？' : '发给 agent',
            ),
            h('button', { className: 'dshCanvasBtn', onClick: requestClose }, '关闭'),
          ),
          h(
            'div',
            { style: PANEL_BODY },
            h(
              'div',
              {
                // Size containment lets the board's width cap read the stage's
                // own height via cqh, instead of guessing from the viewport.
                style: Object.assign({}, PANEL_STAGE, { containerType: 'size', position: 'relative' }),
              },
              h(
                'div',
                {
                  ref: boardWrapRef,
                  style: {
                    position: 'relative',
                    flex: 'none',
                    width: 'min(100%, calc(100cqh * ' + (props.width / props.height) + '))',
                    aspectRatio: props.width + ' / ' + props.height,
                    display: 'flex',
                  },
                },
                h(RulerLayer, {
                  width: props.width,
                  height: props.height,
                  rulerOn,
                  guides: props.guides,
                  onGuidesChange: props.onGuidesChange,
                  wrapRef: boardWrapRef,
                }),
                h(Board, {
                  width: props.width,
                  height: props.height,
                  boxes: props.boxes,
                  selected: props.selected,
                  onSelect: props.onSelect,
                  onChange: props.onChange,
                  onRemove: props.onRemove,
                  onAddAt: props.onAddAt,
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
                  preview,
                  fill: true,
                  guides: props.guides,
                }),
              ),
              h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    bottom: 12,
                    fontSize: 10,
                    lineHeight: 1,
                    color: 'var(--dsw-alias-label-secondary)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    padding: '5px 10px',
                    borderRadius: 99,
                    opacity: 0.85,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                  },
                },
                '双击空白加框 · 双击框编辑 · 拖动移动 · 右下角缩放',
              ),
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  style: {
                    position: 'absolute',
                    right: 18,
                    bottom: 18,
                    zIndex: 20,
                    // Fixed footprint: toggling the label must not resize the
                    // button and make it jump around.
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    width: 96,
                    height: 30,
                    padding: 0,
                    boxSizing: 'border-box',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08), 0 3px 10px rgba(0, 0, 0, 0.07)',
                  },
                  title: preview ? '退出预览，显示画框' : '隐藏画框，按实际画面预览',
                  onClick: () => setPreview(!preview),
                },
                h(Icon, { name: preview ? 'eye-off' : 'eye', size: 14 }),
                h('span', null, preview ? '退出预览' : '预览'),
              ),
            ),
            h(
              'div',
              { style: Object.assign({}, PANEL_SIDE, { position: 'relative', width: sidePx }) },
              h('div', {
                className: 'dshComfyZoom-resize',
                style: ZOOM_RESIZE_HANDLE,
                onPointerDown: onSideDown,
                title: '拖动调整宽度',
              }),
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
                      h(SegmentToggle, {
                        value: isText ? 'text' : 'obj',
                        options: [
                          { value: 'obj', label: '画面元素' },
                          { value: 'text', label: '文字' },
                        ],
                        onChange: (value) => patch({ type: value }),
                      }),
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
                      h(
                        'div',
                        { style: { marginTop: 2 } },
                        h(
                          'label',
                          {
                            style: {
                              display: 'block',
                              fontSize: 10,
                              color: 'var(--dsw-alias-label-secondary)',
                              marginBottom: 4,
                            },
                          },
                          '描述',
                        ),
                        h('textarea', {
                          key: 'zoom-desc-' + String(props.selected),
                          ref: descRef,
                          defaultValue: meta.desc || '',
                          style: Object.assign({}, ZOOM_SUMMARY_AREA, { height: clampZoomHeight(descHeight) }),
                          onMouseUp: (event) => setDescHeight(clampZoomHeight(event.currentTarget.offsetHeight)),
                          onChange: (event) => patch({ desc: event.target.value }),
                        }),
                      ),
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
                : h(
                    'div',
                    { style: EMPTY },
                    props.boxes.length === 0 ? '点上方「加第一个框」开始' : '点选一个框',
                  ),
              h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 6,
                    padding: '8px 10px 10px',
                    borderTop: '1px solid var(--dsw-alias-border-l2)',
                  },
                },
                h(
                  'div',
                  null,
                  h(
                    'label',
                    {
                      style: {
                        display: 'block',
                        fontSize: 10.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        marginBottom: 4,
                      },
                    },
                    '正面提示词',
                  ),
                  h('textarea', {
                    ref: summaryRef,
                    defaultValue: props.summary || '',
                    style: Object.assign({}, ZOOM_SUMMARY_AREA, { height: clampZoomHeight(summaryHeight) }),
                    onMouseUp: (event) => setSummaryHeight(clampZoomHeight(event.currentTarget.offsetHeight)),
                    onChange: (event) => {
                      if (props.onSummaryChange) props.onSummaryChange(event.target.value)
                    },
                  }),
                ),
                h(
                  'div',
                  null,
                  h(
                    'label',
                    {
                      style: {
                        display: 'block',
                        fontSize: 10.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        marginBottom: 4,
                      },
                    },
                    '负面提示词',
                  ),
                  h('textarea', {
                    defaultValue: props.negative || '',
                    placeholder: '留空则沿用模板',
                    style: Object.assign({}, ZOOM_SUMMARY_AREA, { height: 64 }),
                    onChange: (event) => {
                      if (props.onNegativeChange) props.onNegativeChange(event.target.value)
                    },
                  }),
                ),
              ),
            ),
          ),
          h(ModelSettingsDialog, {
            open: modelPanel,
            models: canvasModels,
            onChange: setCanvasModels,
            onClose: () => setModelPanel(false),
            night: overlayNight,
            referenceMeta: props.referenceMeta,
          }),
          missingModels && missingModels.length > 0
            ? h(
                'div',
                {
                  style: {
                    position: 'fixed',
                    inset: 0,
                    zIndex: 61,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.45)',
                  },
                  onClick: (event) => {
                    if (event.target !== event.currentTarget) return
                    if (props.onClearMissing) props.onClearMissing()
                  },
                },
                h(
                  'div',
                  {
                    className: overlayNight ? 'dshComfySurface-dark' : 'dshComfySurface-light',
                    style: {
                      width: 400,
                      maxWidth: 'calc(100vw - 32px)',
                      boxSizing: 'border-box',
                      padding: 16,
                      borderRadius: 12,
                      background: 'var(--dsw-alias-bg-base)',
                      color: 'var(--dsw-alias-label-primary)',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      boxShadow: '0 18px 48px rgba(0, 0, 0, 0.4)',
                    },
                    onClick: (event) => event.stopPropagation(),
                  },
                  h(
                    'div',
                    {
                      style: {
                        fontWeight: 600,
                        fontSize: 12.5,
                        marginBottom: 8,
                        color: 'var(--dsw-alias-state-error-primary)',
                      },
                    },
                    '缺少模型，无法生成',
                  ),
                  ...missingModels.map((entry, index) =>
                    h(
                      'div',
                      { key: index, style: { fontSize: 11, marginBottom: 4 } },
                      String(entry && entry.kind ? entry.kind.toUpperCase() : '模型') +
                        '：' +
                        String((entry && entry.file) || ''),
                    ),
                  ),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 10.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        lineHeight: 1.5,
                        margin: '8px 0 12px',
                      },
                    },
                    '把这些文件放进 ComfyUI 的 models 对应目录，或在「模型」里换一个已安装的模型。',
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
                    h(
                      'button',
                      {
                        className: 'dshCanvasBtn',
                        onClick: () => {
                          if (props.onClearMissing) props.onClearMissing()
                          setModelPanel(true)
                        },
                      },
                      '去设置',
                    ),
                    h(
                      'button',
                      {
                        className: 'dshCanvasBtn',
                        'data-tone': 'primary',
                        onClick: () => {
                          if (props.onClearMissing) props.onClearMissing()
                        },
                      },
                      '知道了',
                    ),
                  ),
                ),
              )
            : null,
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
      const notify = () => {
        for (const listener of [...listeners]) listener()
      }
      return {
        get: () => state,
        set(next) {
          state = next
          notify()
        },
        /** Open or close without discarding the working copy the canvas published. */
        setOpen(open) {
          if (!state) return
          state = Object.assign({}, state, { open: Boolean(open) })
          notify()
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
          h(SegmentToggle, {
            value: type,
            options: [
              { value: 'obj', label: '画面元素' },
              { value: 'text', label: '文字' },
            ],
            onChange: (value) => patchMeta({ type: value }),
          }),
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
      // Layout guides: { axis: 'h' | 'v', pos } in canvas pixels.
      const [guides, setGuides] = useState([])
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
      const [reloadNonce, setReloadNonce] = useState(0)
      const [lastRemoved, setLastRemoved] = useState(null)
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState('')
      const [referenceOptions, setReferenceOptions] = useState([])
      // Album item meta keyed by image URL, so the canvas can read the settings
      // (seed, models, LoRA) of whatever picture it is tracing.
      const [albumMetaByUrl, setAlbumMetaByUrl] = useState({})
      const [referenceUrl, setReferenceUrl] = useState('')
      const [referenceKind, setReferenceKind] = useState('')
      const [referenceName, setReferenceName] = useState('')
      const [referenceOpacity, setReferenceOpacity] = useState(55)
      const [negative, setNegative] = useState('')
      /** Set by the polling effect so opening the dropdown can refresh on demand. */
      const refreshAlbum = useRef(null)
      const [canvasTheme, setCanvasTheme] = usePref('albumTheme')
      const canvasNight = canvasTheme !== 'light'
      const [canvasModels, setCanvasModels] = usePref('canvasModels')
      const [modelPanel, setModelPanel] = useState(false)
      const [preview, setPreview] = useState(false)
      const [trackedJob, setTrackedJob] = useState(() => jobStore.get())
      const [quickMissing, setQuickMissing] = useState(null)
      // Generation meta of the picture currently used as the reference.
      const referenceMeta = referenceUrl && albumMetaByUrl[referenceUrl] ? albumMetaByUrl[referenceUrl] : null

      useEffect(() => jobStore.subscribe(() => setTrackedJob(jobStore.get())), [])

      const [jobClock, setJobClock] = useState(() => Date.now())
      const trackedActive =
        trackedJob !== null && (trackedJob.status === 'queued' || trackedJob.status === 'running')

      useEffect(() => {
        if (!trackedActive) return undefined
        setJobClock(Date.now())
        const timer = setInterval(() => setJobClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [trackedActive])

      const trackedElapsed =
        trackedJob && trackedJob.at ? Math.max(0, Math.floor((jobClock - trackedJob.at) / 1000)) : 0

      // A canvas-initiated render replaces the reference with its own result, so
      // the next iteration starts from what just came out.
      useEffect(() => {
        if (!trackedJob || trackedJob.status !== 'done') return
        if (trackedJob.origin !== 'canvas' || !trackedJob.imageUrl) return
        setReferenceUrl(trackedJob.imageUrl)
        setReferenceKind('album')
        setReferenceName(trackedJob.filename || '')
        setDirty(true)
      }, [trackedJob])

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
            const metaByUrl = {}
            for (const item of items) {
              for (const image of item.images || []) {
                if (image && image.url) {
                  options.push({ url: image.url, label: image.filename || image.url })
                  metaByUrl[image.url] = item.meta || null
                }
              }
            }
            setAlbumMetaByUrl(metaByUrl)
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
        // Reset means a blank board. Reloading the workflow would pull its sample
        // caption and preset boxes straight back in, so clear the working copy.
        setBoxes([])
        setSelected(null)
        setEditing(null)
        setSummary('')
        setDirty(false)
        setStatus('已重置为空白画板')
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
            // The template's preset boxes are intentionally ignored: a fresh board
            // starts empty and the user adds boxes from the toolbar.
            const draft = readDraft(file)
            const useWidth = draft && typeof draft.width === 'number' ? draft.width : width
            const useHeight = draft && typeof draft.height === 'number' ? draft.height : height
            const useBoxes = draft ? draft.boxes : []

            setNodeId(node.id)
            setSize({ width: useWidth, height: useHeight })
            setRatio(draft && typeof draft.ratio === 'string' ? draft.ratio : wfRatio)
            setMegapixels(draft && typeof draft.megapixels === 'number' ? draft.megapixels : wfMegapixels)
            setMultiple(draft && typeof draft.multiple === 'number' ? draft.multiple : wfMultiple)
            setSummary(draft && typeof draft.summary === 'string' ? draft.summary : wfSummary)
            setBoxes(sanitizeBoxes(useBoxes, useWidth, useHeight))
            setGuides(Array.isArray(draft && draft.guides) ? draft.guides.map(normalizeGuide).filter(Boolean) : [])
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
            setNegative(draft && typeof draft.negative === 'string' ? draft.negative : '')
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
            guides,
            referenceUrl,
            referenceKind,
            referenceName,
            referenceOpacity,
            negative,
          })
        }, 400)
        return () => clearTimeout(timer)
      }, [file, nodeId, dirty, size, ratio, megapixels, multiple, summary, boxes, guides, referenceUrl, referenceKind, referenceName, referenceOpacity, negative])

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

      /** A double click on empty board space drops a 100×100 box centred there. */
      const addBoxAt = (x, y) => {
        const side = 100
        const next = {
          x: Math.round(clamp(x - side / 2, 0, Math.max(0, size.width - side))),
          y: Math.round(clamp(y - side / 2, 0, Math.max(0, size.height - side))),
          width: side,
          height: side,
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
        setGuides((current) =>
          current.map((guide) => ({
            ...guide,
            pos: Math.round(guide.pos * (guide.axis === 'h' ? sy : sx)),
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

      /** Direct preview: hand the current layout to ComfyUI without the agent. */
      const quickGenerate = async () => {
        if (boxes.length === 0) {
          setStatus('画布上还没有框')
          return
        }
        const layout = buildMossLayout(summary, size.width, size.height, boxes)
        const stored = pluginPrefs.get().canvasModels || {}
        let sampling = stored.sampling || {}
        if (sampling.seedMode === 'random') {
          // Random mode: a fresh seed per submission, then shown in the field so
          // the run can be reproduced.
          sampling = Object.assign({}, sampling, { seed: Math.floor(Math.random() * 1e15) })
          setCanvasModels(Object.assign({}, stored, { sampling }))
        }
        const models = Object.assign({}, stored, { sampling })
        setStatus('正在提交…')
        try {
          const res = await fetch('/plugin/comfy-canvas/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              layout,
              models,
              width: size.width,
              height: size.height,
              negative,
            }),
          })
          const data = await res.json().catch(() => null)
          if (data && data.code === 'missing-models') {
            setQuickMissing(Array.isArray(data.missing) ? data.missing : [])
            setStatus('缺少模型，查看提示')
            return
          }
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'HTTP ' + res.status)
          }
          setQuickMissing(null)
          jobStore.start(data.promptId, 'canvas')
          setStatus('已提交，正在生成')
        } catch (error) {
          setStatus('提交失败：' + String((error && error.message) || error))
        }
      }

      const hasNode = nodeId !== null

      /** Publish the working copy to the overlay store; `open` is explicit so the
       *  open button hands over the freshest data the moment it opens. */
      const publishZoom = (open) => {
        zoomStore.set({
          open: Boolean(open),
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
          onAddAt: addBoxAt,
          onClose: () => zoomStore.setOpen(false),
          summary,
          onSummaryChange: (value) => {
            setSummary(value)
            setDirty(true)
          },
          negative,
          onNegativeChange: (value) => {
            setNegative(value)
            setDirty(true)
          },
          onSend: sendToAgent,
          onGenerate: quickGenerate,
          confirmSend,
          status,
          referenceUrl,
          referenceKind,
          referenceName,
          referenceOptions,
          onReferencePick: chooseReference,
          onRefreshReference: () => {
            if (refreshAlbum.current) refreshAlbum.current()
          },
          ratioOptions,
          ratio,
          megapixels,
          mpMeta,
          onRatioChange: (value) => applyResolution(value, megapixels),
          onMegapixelsChange: (value) => applyResolution(ratio || ratioOptions[0], value),
          missingModels: quickMissing,
          onClearMissing: () => setQuickMissing(null),
          referenceMeta,
          guides,
          onGuidesChange: (next) => {
            setGuides(Array.isArray(next) ? next : [])
            setDirty(true)
          },
        })
      }

      // Hand the working copy to the frame-wide overlay host. It renders outside
      // this pane, so a fixed overlay here would be clipped by the column.
      useEffect(() => {
        publishZoom(Boolean(zoomStore.get() && zoomStore.get().open))
      }, [
        size.width,
        size.height,
        boxes,
        selected,
        editing,
        draft,
        referenceUrl,
        referenceOpacity,
        summary,
        confirmSend,
        status,
        referenceKind,
        referenceName,
        referenceOptions,
        ratioOptions,
        ratio,
        megapixels,
        mpMeta,
        quickMissing,
        referenceMeta,
        guides,
      ])

      // The overlay owns its open flag in the store: unmounting this tab (an agent
      // turn, a tab switch) must not slam the working view shut.
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
                      'div',
                      { style: { flex: 'none', width: 150 } },
                      h(Dropdown, {
                        title: '画布比例',
                        placeholder: '选择比例',
                        value: ratio || ratioOptions[0] || '',
                        options: ratioOptions.map((option) => ({ value: option, label: option })),
                        onPick: (value) => applyResolution(value, megapixels),
                      }),
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
                placeholder: '选择参考图',
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
              { style: Object.assign({}, STAGE_MAIN, { position: 'relative' }) },
              h('div', { style: BOARD_WRAP }, h(Board, {
                width: size.width,
                height: size.height,
                boxes,
                selected,
                onSelect: setSelected,
                onChange: changeBox,
                onRemove: removeBox,
                onAddAt: addBoxAt,
                editing,
                draft,
                reference: referenceUrl ? { url: referenceUrl, opacity: referenceOpacity / 100 } : null,
                onReferenceError: clearReference,
                onEditStart: startEdit,
                onDraftChange: setDraft,
                onEditCommit: commitEdit,
                onEditCancel: cancelEdit,
                preview,
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
              trackedActive
                ? h(
                    'div',
                    { style: RUNNING_FLOAT_SIDEBAR },
                    h(
                      'div',
                      { style: RUNNING_BOX },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                        h('span', {
                          style: {
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            flex: 'none',
                            background: '#ff5a5a',
                            animation: 'dshComfyJobPulse 1.1s ease-in-out infinite',
                          },
                        }),
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: '#ff6b6b',
                              whiteSpace: 'nowrap',
                            },
                          },
                          trackedJob.status === 'running' ? '正在生成' : '排队中',
                        ),
                        h(
                          'span',
                          {
                            style: {
                              fontSize: 10,
                              color: 'rgba(255, 107, 107, 0.85)',
                              fontVariantNumeric: 'tabular-nums',
                            },
                          },
                          trackedElapsed + 's',
                        ),
                        h('span', { style: { flex: 1 } }),
                        h(
                          'button',
                          {
                            className: 'dshCanvasBtn',
                            style: {
                              flexShrink: 0,
                              padding: '2px 8px',
                              color: '#ff6b6b',
                              borderColor: 'rgba(255, 90, 90, 0.5)',
                            },
                            onClick: cancelTrackedJob,
                          },
                          '停止',
                        ),
                      ),
                      h(
                        'div',
                        {
                          style: {
                            marginTop: 6,
                            height: 3,
                            borderRadius: 99,
                            background: 'var(--dsw-alias-bg-layer-2)',
                            overflow: 'hidden',
                          },
                        },
                        h('div', {
                          style: {
                            width: '40%',
                            height: '100%',
                            borderRadius: 99,
                            background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
                            animation: 'dshComfyJobSlide 1.15s ease-in-out infinite',
                          },
                        }),
                      ),
                    ),
                  )
                : null,
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  style: {
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    zIndex: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    width: 84,
                    height: 26,
                    padding: 0,
                    boxSizing: 'border-box',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08), 0 3px 10px rgba(0, 0, 0, 0.07)',
                  },
                  title: preview ? '退出预览，显示画框' : '隐藏画框，按实际画面预览',
                  onClick: () => setPreview(!preview),
                },
                h(Icon, { name: preview ? 'eye-off' : 'eye', size: 12 }),
                h('span', null, preview ? '退出预览' : '预览'),
              ),
            ),
            h(
              'div',
              { style: STAGE_META },
              h('span', { style: NUM }, size.width + ' × ' + size.height),
              h('span', null, boxes.length + ' 个框'),
              h('span', { style: { flex: 1 } }),
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  style: {
                    background: 'linear-gradient(135deg, #ff5c7a, #ff8a3d)',
                    borderColor: 'transparent',
                    color: '#fff',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    boxShadow: '0 0 14px rgba(255, 92, 122, 0.3)',
                  },
                  onClick: () => publishZoom(true),
                },
                h(Icon, { name: 'maximize', size: 12 }),
                '放大',
              ),
              h('button', { className: 'dshCanvasBtn', onClick: addBox }, '加框'),
            ),
            h(
              'div',
              {
                style: {
                  marginTop: 8,
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: 'var(--dsw-alias-label-secondary)',
                  opacity: 0.7,
                },
              },
              '双击画布空白加框；点「放大」进入大视图，可拖动调整、双击编辑、换参考图与比例。',
            ),
          ),
          h(
            'div',
            {
              style: {
                flex: 'none',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                padding: '0 14px 12px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
              },
            },
            h(
              'div',
              null,
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
                placeholder: '整张图讲什么',
                onChange: (event) => {
                  setSummary(event.target.value)
                  setDirty(true)
                },
              }),
            ),
            h(
              'div',
              null,
              h('label', { style: FIELD_LABEL }, '负面提示词'),
              h('textarea', {
                value: negative,
                style: SUMMARY_AREA,
                placeholder: '留空则沿用模板',
                onChange: (event) => {
                  setNegative(event.target.value)
                  setDirty(true)
                },
              }),
            ),
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
        {
          style: SHELL,
          className: canvasNight ? 'dshComfySurface-dark' : 'dshComfySurface-light',
        },
        h(Styles),
        h(
          'div',
          { style: HEAD },
          h(
            'div',
            { style: { flex: '0 1 150px', minWidth: 84 } },
            h(Dropdown, {
              title: '选择工作流',
              placeholder: files && files.length > 0 ? '选择工作流' : '无工作流',
              value: file || '',
              options: (files || []).map((item) => ({ value: item.name, label: item.name })),
              onPick: (value) => setFile(value),
              dark: canvasNight,
              menuMinWidth: 260,
            }),
          ),
          // Everything after this spacer sits flush right; the file picker keeps
          // the left edge.
          h('span', { style: { flex: 1 } }),
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
            {
              className: 'dshCanvasBtn dshComfyGenBlue',
              disabled: !hasNode || boxes.length === 0,
              title: '不经过 agent，直接把当前版式提交给 ComfyUI',
              style: {
                background: '#3b82f6',
                borderColor: '#3b82f6',
                color: '#ffffff',
                fontWeight: 600,
                flexShrink: 0,
                opacity: !hasNode || boxes.length === 0 ? 0.45 : 1,
              },
              onClick: quickGenerate,
            },
            '快速生成',
          ),
          h(
            'button',
            {
              className: 'dshCanvasBtn dshComfyGenRed',
              disabled: !hasNode,
              style: {
                background: '#ef4444',
                borderColor: '#ef4444',
                color: '#ffffff',
                fontWeight: 600,
                flexShrink: 0,
                opacity: !hasNode ? 0.45 : 1,
              },
              onClick: sendToAgent,
            },
            confirmSend ? '确认发送？' : '发给 agent',
          ),
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              title: '生成设置：模型 / LoRA / 采样',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              },
              onClick: () => setModelPanel(true),
            },
            h(Icon, { name: 'sliders-horizontal', size: 12 }),
            h('span', null, '模型'),
          ),
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              },
              title: canvasNight ? '切换到日间' : '切换到夜间',
              'aria-label': canvasNight ? '切换到日间' : '切换到夜间',
              onClick: () => setCanvasTheme(canvasNight ? 'light' : 'dark'),
            },
            h(ThemeIcon, { night: canvasNight }),
          ),
        ),
        body,
        h(ModelSettingsDialog, {
          open: modelPanel,
          models: canvasModels,
          onChange: setCanvasModels,
          onClose: () => setModelPanel(false),
          night: canvasNight,
          referenceMeta,
        }),
      )
    }

    function CanvasTitle() {
      return h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h(Icon, { name: 'scan', size: 14, style: { flex: 'none' } }),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 'ComfyUI 画框 MOSS'),
      )
    }

    function CanvasIcon(props) {
      return h(Icon, { name: 'scan', size: (props && props.size) || 16 })
    }

    const WORKSPACE_KEY = 'dsh-comfy-workspace'
    const WORKSPACE_SHELL = {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      fontSize: 12,
      color: 'var(--dsw-alias-label-primary)',
    }
    const WORKSPACE_TOOLBAR = {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 14px',
      borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    const WORKSPACE_BODY = { flex: 1, minHeight: 0, display: 'flex' }
    const WORKSPACE_STAGE = {
      flex: 1,
      minHeight: 0,
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      containerType: 'size',
    }
    const WORKSPACE_SIDE = {
      flex: 'none',
      width: 280,
      minHeight: 0,
      borderLeft: '1px solid var(--dsw-alias-border-l2)',
      display: 'flex',
      flexDirection: 'column',
    }
    const WORKSPACE_AREA = {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '10px 12px',
    }
    const WORKSPACE_AREA_INPUT = {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: 90,
      resize: 'vertical',
      padding: '6px 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 11,
      lineHeight: 1.5,
      fontFamily: 'inherit',
      outline: 'none',
    }
    const WORKSPACE_LABEL = {
      flex: 'none',
      fontSize: 10,
      color: 'var(--dsw-alias-label-secondary)',
    }
    const WORKSPACE_FIELD = {
      flex: 'none',
      boxSizing: 'border-box',
      fontSize: 10.5,
      padding: '4px 7px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      outline: 'none',
    }
    const WORKSPACE_PARAM_TITLE = { fontSize: 10.5, fontWeight: 600, margin: '10px 0 4px' }
    const WORKSPACE_PARAM_BODY = {
      fontSize: 10.5,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-label-secondary)',
      wordBreak: 'break-word',
    }

    /**
     * Full-screen canvas workspace opened from the left sidebar entry.
     *
     * It owns a working copy of its own, sharing the per-file draft storage with
     * the right-side canvas tab so both surfaces see the same edits.
     */
    function CanvasWorkspace() {
      const [enabled] = usePref('canvasWorkspace')
      const [canvasTheme] = usePref('albumTheme')
      const canvasNight = canvasTheme !== 'light'
      const [canvasModels, setCanvasModels] = usePref('canvasModels')
      const [rulerOn, setRulerOn] = usePref('canvasRuler')
      const [files, setFiles] = useState(null)
      const [file, setFile] = useState('')
      const [size, setSize] = useState({ width: 1024, height: 1024 })
      const [ratio, setRatio] = useState('')
      const [ratioOptions, setRatioOptions] = useState([])
      const [megapixels, setMegapixels] = useState(1)
      const [multiple, setMultiple] = useState(16)
      const [summary, setSummary] = useState('')
      const [boxes, setBoxes] = useState([])
      const [guides, setGuides] = useState([])
      const [selected, setSelected] = useState(null)
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState('')
      const [dirty, setDirty] = useState(false)
      const [status, setStatus] = useState('')
      const [error, setError] = useState('')
      const [preview, setPreview] = useState(false)
      const [modelPanel, setModelPanel] = useState(false)
      const [albumOpen, setAlbumOpen] = useState(false)
      const [albumClosing, setAlbumClosing] = useState(false)
      const [quickMissing, setQuickMissing] = useState(null)
      const [job, setJob] = useState(() => jobStore.get())
      const [jobClock, setJobClock] = useState(() => Date.now())
      const [referenceUrl, setReferenceUrl] = useState('')
      const [referenceOptions, setReferenceOptions] = useState([])
      const [referenceOpacity, setReferenceOpacity] = useState(55)
      const [negative, setNegative] = useState('')
      const [panelWidth, setPanelWidthPref] = usePref('workspacePanelWidth')
      const [livePanelWidth, setLivePanelWidth] = useState(null)
      const panelDragRef = useRef(null)
      const [albumMetaByUrl, setAlbumMetaByUrl] = useState({})
      const [albumPick, setAlbumPick] = useState('')
      const [albumSource, setAlbumSource] = useState('plugin')
      const [outputFiles, setOutputFiles] = useState([])
      const boardWrapRef = useRef(null)

      const filesEffect = (load) => load
      useEffect(() => {
        let alive = true
        fetch(API + '/workflows', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive) return
            if (!data.ok) throw new Error(data.error || '无法读取工作流目录')
            const list = data.files || []
            setFiles(list)
            if (list.length > 0) setFile((current) => current || list[0].name)
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        let alive = true
        fetch(API + '/resolutions', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive || !data.ok) return
            setRatioOptions(Array.isArray(data.ratios) ? data.ratios : [])
          })
          .catch(() => {
            // Without the list the canvas keeps whatever the file records.
          })
        return () => {
          alive = false
        }
      }, [])

      // Album images for the reference underlay, refreshed on the same cadence as
      // the canvas tab so the two surfaces stay in sync.
      useEffect(() => {
        let alive = true
        let timer = null
        const load = async () => {
          try {
            const res = await fetch('/plugin/comfy-status/album', { cache: 'no-store' })
            const data = await res.json()
            if (!alive || !data) return
            const options = []
            const metaByUrl = {}
            for (const item of data.items || []) {
              for (const image of item.images || []) {
                if (image && image.url) {
                  options.push({ url: image.url, label: image.filename || image.url })
                  metaByUrl[image.url] = item.meta || null
                }
              }
            }
            setReferenceOptions(options)
            setAlbumMetaByUrl(metaByUrl)
          } catch {
            // The album plugin may be off; the reference picker just stays empty.
          } finally {
            if (alive) timer = setTimeout(load, 15000)
          }
        }
        load()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      // The engine's own output folder, fetched lazily the first time it is shown.
      useEffect(() => {
        if (!albumOpen || albumSource !== 'output') return undefined
        let alive = true
        fetch('/plugin/comfy-status/outputs', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (alive && data && data.ok && Array.isArray(data.files)) {
              setOutputFiles(data.files.map((file) => ({ url: file.url, label: file.name })))
            }
          })
          .catch(() => {
            // The engine may be offline; the grid simply stays empty.
          })
        return () => {
          alive = false
        }
      }, [albumOpen, albumSource])

      // Output-folder images carry their parameters in the PNG itself; read them
      // lazily when one is opened in the preview.
      useEffect(() => {
        if (!albumPick || albumMetaByUrl[albumPick]) return undefined
        if (albumPick.indexOf('type=output') < 0) return undefined
        let parsed = null
        try {
          parsed = new URL(albumPick, window.location.origin)
        } catch {
          return undefined
        }
        const filename = parsed.searchParams.get('filename')
        if (!filename) return undefined
        let alive = true
        fetch('/plugin/comfy-status/output-meta?filename=' + encodeURIComponent(filename), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (alive && data && data.ok && data.meta) {
              setAlbumMetaByUrl((current) => Object.assign({}, current, { [albumPick]: data.meta }))
            }
          })
          .catch(() => {
            // No embedded prompt (e.g. JPEG output); the panel just stays empty.
          })
        return () => {
          alive = false
        }
      }, [albumPick, albumMetaByUrl])

      // Esc steps back one level: preview → grid, grid → closed.
      useEffect(() => {
        if (!albumOpen) return undefined
        const onKey = (event) => {
          if (event.isComposing) return
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          if (albumPick) setAlbumPick('')
          else closeAlbum()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [albumOpen, albumPick])

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
              setError('这个工作流里没有 CreateBoundingBoxes 节点')
              setBoxes([])
              setGuides([])
              setSelected(null)
              setSummary('')
              return
            }
            const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
            const width = typeof values[0] === 'number' ? values[0] : 1024
            const height = typeof values[1] === 'number' ? values[1] : 1024
            const resolver = (wf.nodes || []).find((item) => item.type === 'ResolutionSelector')
            const resolverValues = resolver && Array.isArray(resolver.widgets_values) ? resolver.widgets_values : []
            const wfRatio = typeof resolverValues[0] === 'string' ? resolverValues[0] : ''
            const wfMegapixels = typeof resolverValues[1] === 'number' ? resolverValues[1] : 1
            const wfMultiple = typeof resolverValues[2] === 'number' ? resolverValues[2] : 16
            const layoutNode = (wf.nodes || []).find((item) => item.type === 'MOSSImageLayoutPrompt')
            const wfSummary =
              layoutNode && Array.isArray(layoutNode.widgets_values) && typeof layoutNode.widgets_values[0] === 'string'
                ? layoutNode.widgets_values[0]
                : ''
            const stored = readDraft(file)
            const useWidth = stored && typeof stored.width === 'number' ? stored.width : width
            const useHeight = stored && typeof stored.height === 'number' ? stored.height : height
            setSize({ width: useWidth, height: useHeight })
            setRatio(stored && typeof stored.ratio === 'string' ? stored.ratio : wfRatio)
            setMegapixels(stored && typeof stored.megapixels === 'number' ? stored.megapixels : wfMegapixels)
            setMultiple(stored && typeof stored.multiple === 'number' ? stored.multiple : wfMultiple)
            setSummary(stored && typeof stored.summary === 'string' ? stored.summary : wfSummary)
            setBoxes(sanitizeBoxes(stored ? stored.boxes : [], useWidth, useHeight))
            setGuides(Array.isArray(stored && stored.guides) ? stored.guides.map(normalizeGuide).filter(Boolean) : [])
            // Whatever picture was being traced comes back with the draft.
            setReferenceUrl(stored && typeof stored.referenceUrl === 'string' ? stored.referenceUrl : '')
            setReferenceOpacity(
              stored && typeof stored.referenceOpacity === 'number' ? clamp(stored.referenceOpacity, 0, 100) : 55,
            )
            setNegative(stored && typeof stored.negative === 'string' ? stored.negative : '')
            setSelected(null)
            setDirty(Boolean(stored))
            if (stored) setStatus('已恢复上次未发送的编辑')
          })
          .catch((err) => {
            if (alive) setError(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [file])

      useEffect(() => {
        if (!file || !dirty) return undefined
        const timer = setTimeout(() => {
          writeDraft(file, {
            width: size.width,
            height: size.height,
            ratio,
            megapixels,
            multiple,
            summary,
            boxes,
            guides,
            referenceUrl,
            referenceOpacity,
            negative,
          })
        }, 400)
        return () => clearTimeout(timer)
      }, [file, dirty, size, ratio, megapixels, multiple, summary, boxes, guides, referenceUrl, referenceOpacity, negative])

      useEffect(() => jobStore.subscribe(() => setJob(jobStore.get())), [])

      const jobActive = job !== null && (job.status === 'queued' || job.status === 'running')
      useEffect(() => {
        if (!jobActive) return undefined
        setJobClock(Date.now())
        const timer = setInterval(() => setJobClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [jobActive])
      const jobElapsed = job && job.at ? Math.max(0, Math.floor((jobClock - job.at) / 1000)) : 0

      const changeBox = (index, patch) => {
        setBoxes((current) => current.map((box, at) => (at === index ? Object.assign({}, box, patch) : box)))
        setDirty(true)
      }
      const removeBox = (index) => {
        setBoxes((current) => current.filter((_, at) => at !== index))
        setSelected(null)
        setEditing(null)
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
      const addBoxAt = (x, y) => {
        const side = 100
        const next = {
          x: Math.round(clamp(x - side / 2, 0, Math.max(0, size.width - side))),
          y: Math.round(clamp(y - side / 2, 0, Math.max(0, size.height - side))),
          width: side,
          height: side,
          metadata: { type: 'obj', text: '', desc: '', palette: [] },
        }
        setBoxes((current) => [...current, next])
        setSelected(boxes.length)
        setDirty(true)
      }
      const startEdit = (index) => {
        const box = boxes[index]
        if (!box) return
        const meta = box.metadata || {}
        setSelected(index)
        setEditing(index)
        setDraft(meta.type === 'text' ? meta.text || '' : meta.desc || '')
      }
      const commitEdit = () => {
        if (editing === null) return
        const box = boxes[editing]
        if (box) {
          const meta = box.metadata || {}
          changeBox(editing, {
            metadata: Object.assign({}, meta, meta.type === 'text' ? { text: draft } : { desc: draft }),
          })
        }
        setEditing(null)
      }
      const cancelEdit = () => setEditing(null)
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
        setGuides((current) =>
          current.map((guide) => ({
            ...guide,
            pos: Math.round(guide.pos * (guide.axis === 'h' ? sy : sx)),
          })),
        )
        setSize(target)
        setRatio(nextRatio)
        setMegapixels(nextMegapixels)
        setDirty(true)
      }

      const quickGenerate = async () => {
        if (boxes.length === 0) {
          setStatus('画布上还没有框')
          return
        }
        const layout = buildMossLayout(summary, size.width, size.height, boxes)
        const stored = pluginPrefs.get().canvasModels || {}
        let sampling = stored.sampling || {}
        if (sampling.seedMode === 'random') {
          sampling = Object.assign({}, sampling, { seed: Math.floor(Math.random() * 1e15) })
          setCanvasModels(Object.assign({}, stored, { sampling }))
        }
        setStatus('正在提交…')
        try {
          const res = await fetch('/plugin/comfy-canvas/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              layout,
              models: Object.assign({}, stored, { sampling }),
              width: size.width,
              height: size.height,
              negative,
            }),
          })
          const data = await res.json().catch(() => null)
          if (data && data.code === 'missing-models') {
            const missing = Array.isArray(data.missing) ? data.missing : []
            setQuickMissing(missing)
            setStatus('缺少模型：' + missing.map((entry) => entry.file).join('、'))
            return
          }
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'HTTP ' + res.status)
          }
          setQuickMissing(null)
          jobStore.start(data.promptId, 'canvas')
          setStatus('已提交，正在生成')
        } catch (err) {
          setStatus('提交失败：' + String((err && err.message) || err))
        }
      }

      const sampling = canvasModels.sampling || {}
      // Sidebar can be dragged wider; the value persists as a preference.
      const sidePx = clamp(livePanelWidth === null ? panelWidth : livePanelWidth, 220, 560)
      const onPanelMove = (event) => {
        const drag = panelDragRef.current
        if (!drag) return
        setLivePanelWidth(clamp(drag.startWidth + (drag.startX - event.clientX), 220, 560))
      }
      const onPanelUp = () => {
        if (!panelDragRef.current) return
        panelDragRef.current = null
        window.removeEventListener('pointermove', onPanelMove)
        window.removeEventListener('pointerup', onPanelUp)
        window.removeEventListener('pointercancel', onPanelUp)
        setLivePanelWidth((current) => {
          if (current !== null) setPanelWidthPref(clamp(current, 220, 560))
          return null
        })
      }
      const onPanelDown = (event) => {
        event.preventDefault()
        panelDragRef.current = { startX: event.clientX, startWidth: sidePx }
        setLivePanelWidth(sidePx)
        window.addEventListener('pointermove', onPanelMove)
        window.addEventListener('pointerup', onPanelUp)
        window.addEventListener('pointercancel', onPanelUp)
      }
      // The engine's folder can hold hundreds of files; cap what the grid mounts.
      const albumList = albumSource === 'output' ? outputFiles.slice(0, 120) : referenceOptions
      /** Close the album with its exit animation instead of snapping shut. */
      const closeAlbum = () => {
        if (albumClosing) return
        setAlbumClosing(true)
        window.setTimeout(() => {
          setAlbumOpen(false)
          setAlbumPick('')
          setAlbumClosing(false)
        }, 150)
      }
      /** ComfyUI serves a cheap webp preview when asked; grids must not decode
       *  full-size outputs. */
      const thumbOf = (url) =>
        typeof url === 'string' && url.indexOf('/view?') >= 0 ? url + '&preview=webp' : url

      if (!enabled) {
        return h('div', { style: EMPTY }, '独立画板工作台已在插件设置中关闭')
      }

      const stageContent = error
        ? h('div', { style: EMPTY }, error)
        : files !== null && files.length === 0
          ? h('div', { style: EMPTY }, '工作流目录是空的')
          : h(
              'div',
              {
                ref: boardWrapRef,
                style: {
                  position: 'relative',
                  flex: 'none',
                  width: 'min(100%, calc(100cqh * ' + (size.width / Math.max(1, size.height)) + '))',
                  aspectRatio: size.width + ' / ' + size.height,
                  display: 'flex',
                },
              },
              h(RulerLayer, {
                width: size.width,
                height: size.height,
                rulerOn,
                guides,
                onGuidesChange: (next) => {
                  setGuides(next)
                  setDirty(true)
                },
                wrapRef: boardWrapRef,
              }),
              h(Board, {
                width: size.width,
                height: size.height,
                boxes,
                selected,
                onSelect: setSelected,
                onChange: changeBox,
                onRemove: removeBox,
                onAddAt: addBoxAt,
                editing,
                draft,
                onEditStart: startEdit,
                onDraftChange: setDraft,
                onEditCommit: commitEdit,
                onEditCancel: cancelEdit,
                preview,
                fill: true,
                guides,
                reference: referenceUrl ? { url: referenceUrl, opacity: referenceOpacity / 100 } : null,
              }),
            )

      return h(
        'div',
        {
          style: WORKSPACE_SHELL,
          className: canvasNight ? 'dshComfySurface-dark' : 'dshComfySurface-light',
        },
        h(Styles),
        h(
          'div',
          { style: WORKSPACE_TOOLBAR },
          h(
            'div',
            { style: { flex: 'none', width: 180 } },
            h(Dropdown, {
              title: '选择工作流',
              placeholder: files && files.length > 0 ? '选择工作流' : '无工作流',
              value: file || '',
              options: (files || []).map((item) => ({ value: item.name, label: item.name })),
              onPick: (value) => setFile(value),
              dark: canvasNight,
              menuMinWidth: 260,
            }),
          ),
          h('span', { style: WORKSPACE_LABEL }, '参考'),
          h(
            'div',
            { style: { flex: 'none', width: 160 } },
            h(Dropdown, {
              title: '参考图（来自 ComfyUI 相册）',
              placeholder: '参考图',
              value: referenceUrl || '',
              options: [
                { value: '', label: '无' },
                ...referenceOptions.map((option) => ({ value: option.url, label: option.label })),
              ],
              onPick: (value) => {
                setReferenceUrl(value)
                setDirty(true)
              },
              dark: canvasNight,
            }),
          ),
          referenceUrl
            ? h(
                React.Fragment,
                null,
                h('span', { style: WORKSPACE_LABEL }, '不透明'),
                h('input', {
                  type: 'number',
                  value: referenceOpacity,
                  min: 0,
                  max: 100,
                  step: 5,
                  style: Object.assign({}, WORKSPACE_FIELD, { width: 48 }),
                  onChange: (event) => {
                    const next = Number(event.target.value)
                    if (!Number.isFinite(next)) return
                    setReferenceOpacity(clamp(next, 0, 100))
                    setDirty(true)
                  },
                }),
                h('span', { style: WORKSPACE_LABEL }, '%'),
              )
            : null,
          ratioOptions.length > 0
            ? h(
                React.Fragment,
                null,
                h('span', { style: WORKSPACE_LABEL }, '比例'),
                h(
                  'div',
                  { style: { flex: 'none', width: 140 } },
                  h(Dropdown, {
                    title: '画布比例',
                    placeholder: '选择比例',
                    value: ratio || ratioOptions[0] || '',
                    options: ratioOptions.map((option) => ({ value: option, label: option })),
                    onPick: (value) => applyResolution(value, megapixels),
                    dark: canvasNight,
                  }),
                ),
                h('span', { style: WORKSPACE_LABEL }, 'MP'),
                h('input', {
                  type: 'number',
                  value: megapixels,
                  min: 0.1,
                  max: 16,
                  step: 0.1,
                  style: Object.assign({}, WORKSPACE_FIELD, { width: 52 }),
                  onChange: (event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) applyResolution(ratio || ratioOptions[0], next)
                  },
                }),
              )
            : null,
          h('span', { style: WORKSPACE_LABEL }, '种子'),
          h('input', {
            type: 'number',
            value: sampling.seed || 0,
            disabled: sampling.seedMode === 'random',
            style: Object.assign({}, WORKSPACE_FIELD, {
              width: 92,
              opacity: sampling.seedMode === 'random' ? 0.55 : 1,
            }),
            onChange: (event) => {
              const next = Number(event.target.value)
              if (!Number.isFinite(next)) return
              setCanvasModels(
                Object.assign({}, canvasModels, {
                  sampling: Object.assign({}, sampling, { seed: Math.max(0, Math.floor(next)) }),
                }),
              )
            },
          }),
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              title:
                sampling.seedMode === 'random'
                  ? '随机模式已开启：每次快速生成换一个种子'
                  : '开启随机模式：每次快速生成自动换种子',
              style: Object.assign(
                { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 },
                sampling.seedMode === 'random'
                  ? { background: '#3b82f6', borderColor: '#3b82f6', color: '#ffffff', fontWeight: 600 }
                  : null,
              ),
              onClick: () => {
                const nextMode = sampling.seedMode === 'random' ? 'fixed' : 'random'
                const patch = { seedMode: nextMode }
                if (nextMode === 'random') patch.seed = Math.floor(Math.random() * 1e15)
                setCanvasModels(
                  Object.assign({}, canvasModels, { sampling: Object.assign({}, sampling, patch) }),
                )
              },
            },
            h(Icon, { name: 'shuffle', size: 12 }),
            h('span', null, '随机'),
          ),
          jobActive
            ? h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' } },
                h('span', {
                  style: {
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    flex: 'none',
                    background: '#ff5a5a',
                    animation: 'dshComfyJobPulse 1.1s ease-in-out infinite',
                  },
                }),
                h(
                  'span',
                  { style: { fontSize: 10.5, fontWeight: 600, color: '#ff6b6b', whiteSpace: 'nowrap' } },
                  job.status === 'running' ? '正在生成' : '排队中',
                ),
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10,
                      color: 'rgba(255, 107, 107, 0.85)',
                      fontVariantNumeric: 'tabular-nums',
                    },
                  },
                  jobElapsed + 's',
                ),
                h(
                  'div',
                  {
                    style: {
                      width: 64,
                      height: 3,
                      borderRadius: 99,
                      background: 'var(--dsw-alias-bg-layer-2)',
                      overflow: 'hidden',
                      flex: 'none',
                    },
                  },
                  h('div', {
                    style: {
                      width: '40%',
                      height: '100%',
                      borderRadius: 99,
                      background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
                      animation: 'dshComfyJobSlide 1.15s ease-in-out infinite',
                    },
                  }),
                ),
                h(
                  'button',
                  {
                    className: 'dshCanvasBtn',
                    style: {
                      flexShrink: 0,
                      padding: '2px 8px',
                      color: '#ff6b6b',
                      borderColor: 'rgba(255, 90, 90, 0.5)',
                    },
                    onClick: cancelTrackedJob,
                  },
                  '停止',
                ),
              )
            : status
              ? h(
                  'span',
                  {
                    style: {
                      fontSize: 10.5,
                      color: 'var(--dsw-alias-label-secondary)',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  status,
                )
              : null,
          h('span', { style: { flex: 1 } }),
          h(
            'span',
            {
              style: Object.assign({}, WORKSPACE_LABEL, {
                fontSize: 10.5,
                fontVariantNumeric: 'tabular-nums',
              }),
            },
            size.width + ' × ' + size.height,
          ),
          h(
            'span',
            { style: Object.assign({}, WORKSPACE_LABEL, { fontSize: 10.5 }) },
            boxes.length + ' 个框',
          ),
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              style: { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 },
              title: '标尺',
              onClick: () => setRulerOn(!rulerOn),
            },
            h(Icon, { name: 'ruler', size: 12 }),
            h('span', null, '标尺'),
          ),
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              style: { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 },
              title: '生成设置：模型 / LoRA / 采样',
              onClick: () => setModelPanel(true),
            },
            h(Icon, { name: 'sliders-horizontal', size: 12 }),
            h('span', null, '模型'),
          ),
          h('button', { className: 'dshCanvasBtn', style: { flexShrink: 0 }, onClick: addBox }, '加框'),
          h(
            'button',
            {
              className: 'dshCanvasBtn dshComfyGenBlue',
              style: {
                flexShrink: 0,
                background: '#3b82f6',
                borderColor: '#3b82f6',
                color: '#ffffff',
                fontWeight: 600,
                opacity: boxes.length === 0 ? 0.45 : 1,
              },
              disabled: boxes.length === 0,
              onClick: quickGenerate,
            },
            '快速生成',
          ),
        ),
        h(
          'div',
          { style: WORKSPACE_BODY },
          h(
            'div',
            { style: WORKSPACE_STAGE },
            stageContent,
            h(
              'button',
              {
                className: 'dshCanvasBtn',
                style: {
                  position: 'absolute',
                  right: 18,
                  bottom: 18,
                  zIndex: 20,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                },
                title: '相册',
                onClick: () => setAlbumOpen(true),
              },
              h(Icon, { name: 'images', size: 14 }),
              h('span', null, '相册'),
            ),
          ),
          h(
            'div',
            { style: Object.assign({}, WORKSPACE_SIDE, { width: sidePx, position: 'relative' }) },
            h('div', {
              style: {
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                cursor: 'col-resize',
                zIndex: 5,
              },
              title: '拖动调整宽度（双击恢复默认）',
              onPointerDown: onPanelDown,
              onDoubleClick: () => setPanelWidthPref(280),
            }),
            h(
              'div',
              { style: WORKSPACE_AREA },
              boxes.length === 0
                ? h('div', { style: EMPTY }, '在画布上双击空白加框')
                : h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 } },
                    ...boxes.map((box, index) =>
                      h(
                        'button',
                        {
                          key: index,
                          type: 'button',
                          className: 'dshCanvasOption',
                          'data-on': selected === index ? 'true' : 'false',
                          style: { textAlign: 'left', padding: '4px 8px' },
                          onClick: () => setSelected(index),
                        },
                        String(index + 1) + '. ' + (boxLabel(box) || '未命名'),
                      ),
                    ),
                  ),
              selected !== null && boxes[selected]
                ? (() => {
                    const meta = boxes[selected].metadata || {}
                    const isText = meta.type === 'text'
                    return h(
                      'div',
                      {
                        style: {
                          marginBottom: 10,
                          paddingBottom: 10,
                          borderBottom: '1px solid var(--dsw-alias-border-l2)',
                        },
                      },
                      h(
                        'div',
                        { style: { fontSize: 10.5, fontWeight: 600, marginBottom: 6 } },
                        '第 ' + (selected + 1) + ' 个框',
                      ),
                      h(
                        'div',
                        { style: { marginBottom: 6 } },
                        h(SegmentToggle, {
                          value: isText ? 'text' : 'obj',
                          options: [
                            { value: 'obj', label: '画面元素' },
                            { value: 'text', label: '文字' },
                          ],
                          onChange: (value) =>
                            changeBox(selected, {
                              metadata: Object.assign({}, meta, { type: value }),
                            }),
                        }),
                      ),
                      h('textarea', {
                        value: meta.desc || '',
                        style: Object.assign({}, WORKSPACE_AREA_INPUT, { minHeight: 60 }),
                        onChange: (event) =>
                          changeBox(selected, {
                            metadata: Object.assign({}, meta, { desc: event.target.value }),
                          }),
                      }),
                    )
                  })()
                : null,
              h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginTop: 8,
                  },
                },
                h(
                  'div',
                  null,
                  h(
                    'label',
                    {
                      style: {
                        display: 'block',
                        fontSize: 10.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        marginBottom: 4,
                      },
                    },
                    '正面提示词',
                  ),
                  h('textarea', {
                    value: summary,
                    style: WORKSPACE_AREA_INPUT,
                    onChange: (event) => {
                      setSummary(event.target.value)
                      setDirty(true)
                    },
                  }),
                ),
                h(
                  'div',
                  null,
                  h(
                    'label',
                    {
                      style: {
                        display: 'block',
                        fontSize: 10.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        marginBottom: 4,
                      },
                    },
                    '负面提示词',
                  ),
                  h('textarea', {
                    value: negative,
                    style: Object.assign({}, WORKSPACE_AREA_INPUT, { minHeight: 60 }),
                    placeholder: '留空则沿用模板',
                    onChange: (event) => {
                      setNegative(event.target.value)
                      setDirty(true)
                    },
                  }),
                ),
              ),
            ),
            h(
              'div',
              {
                style: {
                  flex: 'none',
                  padding: '8px 10px',
                  borderTop: '1px solid var(--dsw-alias-border-l2)',
                },
              },
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    width: '100%',
                    height: 28,
                    boxSizing: 'border-box',
                  },
                  title: preview ? '退出预览，显示画框' : '隐藏画框，按实际画面预览',
                  onClick: () => setPreview(!preview),
                },
                h(Icon, { name: preview ? 'eye-off' : 'eye', size: 13 }),
                h('span', null, preview ? '退出预览' : '预览'),
              ),
            ),
          ),
        ),
        albumOpen
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  inset: 0,
                  zIndex: 40,
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--dsw-alias-bg-base)',
                  animation: albumClosing
                    ? 'dshComfyOverlayOut 140ms ease both'
                    : 'dshComfyOverlayIn 160ms ease both',
                },
              },
              h(
                'div',
                {
                  style: {
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--dsw-alias-border-l2)',
                  },
                },
                albumPick
                  ? h('button', { className: 'dshCanvasBtn', onClick: () => setAlbumPick('') }, '返回相册')
                  : h(
                      React.Fragment,
                      null,
                      h(
                        'button',
                        {
                          className: 'dshCanvasBtn',
                          style:
                            albumSource === 'plugin'
                              ? { background: '#3b82f6', borderColor: '#3b82f6', color: '#ffffff' }
                              : null,
                          onClick: () => {
                            setAlbumSource('plugin')
                            setAlbumPick('')
                          },
                        },
                        '相册',
                      ),
                      h(
                        'button',
                        {
                          className: 'dshCanvasBtn',
                          style:
                            albumSource === 'output'
                              ? { background: '#3b82f6', borderColor: '#3b82f6', color: '#ffffff' }
                              : null,
                          onClick: () => {
                            setAlbumSource('output')
                            setAlbumPick('')
                          },
                        },
                        '输出目录',
                      ),
                    ),
                h('span', { style: { fontWeight: 600, fontSize: 12 } }, albumPick ? '预览' : ''),
                h('span', { style: { flex: 1 } }),
                h(
                  'span',
                  { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                  albumPick ? 'Esc 返回相册' : '左键查看 · 右键设为参考图 · Esc 关闭',
                ),
                h(
                  'button',
                  {
                    className: 'dshCanvasBtn',
                    onClick: () => {
                      if (albumPick) setAlbumPick('')
                      else closeAlbum()
                    },
                  },
                  albumPick ? '返回' : '关闭',
                ),
              ),
              albumPick
                ? (() => {
                    const meta = albumMetaByUrl[albumPick] || null
                    const models = meta && Array.isArray(meta.models) ? meta.models : []
                    const sampler = (meta && meta.sampler) || null
                    const prompt =
                      meta && meta.positive && typeof meta.positive.text === 'string' ? meta.positive.text : ''
                    return h(
                      'div',
                      {
                        style: {
                          flex: 1,
                          minHeight: 0,
                          display: 'flex',
                          animation: 'dshComfyPanelIn 180ms cubic-bezier(0.23, 1, 0.32, 1) both',
                        },
                      },
                      h(
                        'div',
                        {
                          style: {
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 16,
                            background: 'var(--dsw-alias-bg-layer-1)',
                          },
                        },
                        h('img', {
                          src: albumPick,
                          alt: '',
                          style: {
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain',
                            borderRadius: 8,
                            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
                          },
                        }),
                      ),
                      h(
                        'div',
                        {
                          style: {
                            flex: 'none',
                            width: 280,
                            minHeight: 0,
                            overflowY: 'auto',
                            borderLeft: '1px solid var(--dsw-alias-border-l2)',
                            padding: '10px 12px',
                          },
                        },
                        h('div', { style: WORKSPACE_PARAM_TITLE }, '提示词'),
                        h('div', { style: WORKSPACE_PARAM_BODY }, prompt || '（没有记录）'),
                        h('div', { style: WORKSPACE_PARAM_TITLE }, '模型'),
                        models.length === 0
                          ? h('div', { style: WORKSPACE_PARAM_BODY }, '（没有记录）')
                          : h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                              ...models.map((model, index) =>
                                h(
                                  'div',
                                  { key: index, style: WORKSPACE_PARAM_BODY },
                                  (model.role || '') + '：' + (model.name || ''),
                                ),
                              ),
                            ),
                        h('div', { style: WORKSPACE_PARAM_TITLE }, '采样'),
                        sampler
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                              h(
                                'div',
                                { style: WORKSPACE_PARAM_BODY },
                                '采样器：' + (sampler.name || '—') + ' / ' + (sampler.scheduler || '—'),
                              ),
                              h(
                                'div',
                                { style: WORKSPACE_PARAM_BODY },
                                '步数：' +
                                  (sampler.steps !== null && sampler.steps !== undefined ? sampler.steps : '—') +
                                  ' · CFG：' +
                                  (sampler.cfg !== null && sampler.cfg !== undefined ? sampler.cfg : '—'),
                              ),
                              h(
                                'div',
                                { style: WORKSPACE_PARAM_BODY },
                                '种子：' +
                                  (sampler.seed !== null && sampler.seed !== undefined ? sampler.seed : '—'),
                              ),
                            )
                          : h('div', { style: WORKSPACE_PARAM_BODY }, '（没有记录）'),
                        h(
                          'div',
                          { style: { marginTop: 14 } },
                          h(
                            'button',
                            {
                              className: 'dshCanvasBtn',
                              style: { width: '100%' },
                              onClick: () => {
                                setReferenceUrl(albumPick)
                                setDirty(true)
                                closeAlbum()
                              },
                            },
                            '设为参考图',
                          ),
                        ),
                      ),
                    )
                  })()
                : h(
                    'div',
                    {
                      style: {
                        flex: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        padding: 14,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        // Rows must pack at the top: the container is a stretched
                        // flex child, so the default `stretch` would spread the
                        // few rows across all that height.
                        alignContent: 'start',
                        gap: 8,
                        animation: 'dshComfyOverlayIn 160ms ease both',
                      },
                    },
                    albumList.length === 0
                      ? h(
                          'div',
                          { style: EMPTY },
                          albumSource === 'output' ? '输出目录里没有图片' : '相册里还没有输出图',
                        )
                      : null,
                    ...albumList.map((option) =>
                      h(
                        'button',
                        {
                          key: option.url,
                          type: 'button',
                          className: 'dshCanvasBtn dshComfyAlbum-card',
                          style: {
                            position: 'relative',
                            padding: 0,
                            overflow: 'hidden',
                            borderRadius: 10,
                            cursor: 'pointer',
                            background: 'var(--dsw-alias-bg-layer-2)',
                            // A button does not derive height from aspect-ratio with
                            // only absolutely positioned children, so pin the size.
                            height: 160,
                            display: 'block',
                          },
                          title: option.label,
                          onClick: () => setAlbumPick(option.url),
                          onContextMenu: (event) => {
                            event.preventDefault()
                            setReferenceUrl(option.url)
                            setDirty(true)
                            closeAlbum()
                          },
                        },
                        h('img', {
                          src: thumbOf(option.url),
                          alt: '',
                          loading: 'lazy',
                          decoding: 'async',
                          style: {
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                          },
                        }),
                        h(
                          'div',
                          {
                            style: {
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: 0,
                              padding: '2px 6px',
                              fontSize: 9,
                              lineHeight: 1.4,
                              textAlign: 'left',
                              color: '#ffffff',
                              background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.55))',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          },
                          option.label,
                        ),
                      ),
                    ),
                  ),
            )
          : null,
        h(ModelSettingsDialog, {
          open: modelPanel,
          models: canvasModels,
          onChange: setCanvasModels,
          onClose: () => setModelPanel(false),
          night: canvasNight,
        }),
      )
    }

    /** Left-sidebar entry; hidden while its switch is off. */
    function WorkspaceIcon(props) {
      const [enabled] = usePref('canvasWorkspace')
      if (!enabled) return null
      return h(Icon, { name: 'scan', size: (props && props.size) || 16 })
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

        // Standalone workspace: a left-sidebar entry plus the main-panel page it
        // switches to. The entry follows the preference so switching it off
        // removes it from the sidebar immediately.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: WORKSPACE_KEY }, CanvasWorkspace),
        )
        ctx.slots.inject('sidebar.panellist', () => {
          let disposeEntry = null
          const syncEntry = () => {
            if (disposeEntry) {
              disposeEntry()
              disposeEntry = null
            }
            if (pluginPrefs.get().canvasWorkspace) {
              disposeEntry = ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: WORKSPACE_KEY,
                  order: 20,
                  label: () => 'MOSS 画板',
                },
                WorkspaceIcon,
              )
            }
          }
          const unsubscribeEntry = pluginPrefs.subscribe(syncEntry)
          syncEntry()
          return () => {
            unsubscribeEntry()
            if (disposeEntry) {
              disposeEntry()
              disposeEntry = null
            }
          }
        })
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
