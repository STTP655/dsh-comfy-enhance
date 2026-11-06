window.__ModuleLoader__.load({
  id: 'dsh-comfy-enhance',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React
    // Portals let the full-screen viewer escape the sidebar's zoom container.
    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      createPortal = ReactDOM && typeof ReactDOM.createPortal === 'function' ? ReactDOM.createPortal : null
    } catch {
      createPortal = null
    }

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

    /** Merge stored model prefs over the defaults, migrating older shapes. */
    function normalizeModels(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const merged = Object.assign({}, DEFAULT_CANVAS_MODELS, source)
      if (!Array.isArray(merged.loras)) {
        // Migrate the old single-LoRA preference into the list form.
        merged.loras =
          typeof source.lora === 'string' && source.lora.trim()
            ? [
                {
                  name: source.lora.trim(),
                  strength: typeof source.loraStrength === 'number' ? source.loraStrength : 1,
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
    }

    const pluginPrefs = (() => {
      let state = {
        status: true,
        album: true,
        canvas: true,
        clearedBefore: 0,
        sound: true,
        comfyPath: '',
        remoteEndpoint: 'https://api.quickrouter.ai/v1',
        remoteApiKey: '',
        remoteApiKeyOpenai: '',
        remoteApiKeyMinimax: '',
        remoteModel: 'gpt-image-2.5-flare-c',
        remoteSaveDir: '',
        remotePrompt: '',
        remoteMode: 't2i',
        remoteProvider: 'openai',
        remoteSize: '1024x1024',
        remoteQuality: 'auto',
        remoteBackground: 'auto',
        remoteFormat: 'png',
        remoteCount: 1,
        remoteAspect: '1:1',
        remoteOptimizer: false,
        workspaceView: 'chooser',
        t2iPrompt: '',
        t2iNegative: '',
        t2iModels: {},
        t2iClipType: 'flux',
        t2iSize: { width: 1024, height: 1024 },
        // Submitted size = t2iSize × this factor; the inputs below keep the base
        // box so the same framing can be re-run at another resolution.
        t2iScale: 1,
        // Quality prefixes pinned in front of every prompt this panel submits.
        t2iPinPositive: '',
        t2iPinNegative: '',
        t2iPinEnabled: true,
        t2iSampling: { steps: 20, cfg: 1, sampler: 'euler', scheduler: 'simple', seed: 0, seedMode: 'fixed' },
        t2iMeta: {},
        t2iPromptStyle: 'tags',
        promptWriteSystemTags: '',
        promptWriteSystemNatural: '',
        // Empty provider+model means "whatever DSH has selected": a hard-coded id
        // only resolves on the provider that happens to advertise it.
        promptWriteProvider: '',
        promptWriteModel: '',
        promptWriteEffort: 'high',
        promptWriteHistory: [],
        editorPositiveHeight: 96,
        editorNegativeHeight: 96,
        viewerPanelWidth: 360,
        albumTheme: 'dark',
        albumDir: '',
        zoomSummaryHeight: 54,
        zoomDescHeight: 68,
        zoomPanelWidth: 260,
        workspacePanelWidth: 280,
        canvasRuler: false,
        canvasFile: '',
        workspaceCanvasRuler: false,
        workspaceTheme: 'dark',
        workspaceFile: '',
        workspacePolishEffort: '',
        canvasWorkspace: true,
        canvasModels: Object.assign({}, DEFAULT_CANVAS_MODELS),
        workspaceCanvasModels: Object.assign({}, DEFAULT_CANVAS_MODELS),
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
              comfyPath: typeof parsed.comfyPath === 'string' ? parsed.comfyPath : '',
              remoteEndpoint:
                typeof parsed.remoteEndpoint === 'string' ? parsed.remoteEndpoint : 'https://api.quickrouter.ai/v1',
              remoteApiKey: typeof parsed.remoteApiKey === 'string' ? parsed.remoteApiKey : '',
              remoteApiKeyOpenai:
                typeof parsed.remoteApiKeyOpenai === 'string'
                  ? parsed.remoteApiKeyOpenai
                  : typeof parsed.remoteApiKey === 'string'
                    ? parsed.remoteApiKey
                    : '',
              remoteApiKeyMinimax: typeof parsed.remoteApiKeyMinimax === 'string' ? parsed.remoteApiKeyMinimax : '',
              remoteModel: typeof parsed.remoteModel === 'string' ? parsed.remoteModel : 'gpt-image-2.5-flare-c',
              remoteSaveDir: typeof parsed.remoteSaveDir === 'string' ? parsed.remoteSaveDir : '',
              remotePrompt: typeof parsed.remotePrompt === 'string' ? parsed.remotePrompt : '',
              remoteMode: parsed.remoteMode === 'edit' ? 'edit' : 't2i',
              remoteProvider: parsed.remoteProvider === 'minimax' ? 'minimax' : 'openai',
              remoteSize: typeof parsed.remoteSize === 'string' ? parsed.remoteSize : '1024x1024',
              remoteQuality: typeof parsed.remoteQuality === 'string' ? parsed.remoteQuality : 'auto',
              remoteBackground: typeof parsed.remoteBackground === 'string' ? parsed.remoteBackground : 'auto',
              remoteFormat: typeof parsed.remoteFormat === 'string' ? parsed.remoteFormat : 'png',
              remoteCount: typeof parsed.remoteCount === 'number' ? parsed.remoteCount : 1,
              remoteAspect: typeof parsed.remoteAspect === 'string' ? parsed.remoteAspect : '1:1',
              remoteOptimizer: Boolean(parsed.remoteOptimizer),
              workspaceView: ['chooser', 'local', 'online', 'text2img'].includes(parsed.workspaceView)
                ? parsed.workspaceView
                : 'chooser',
              t2iPrompt: typeof parsed.t2iPrompt === 'string' ? parsed.t2iPrompt : '',
              t2iNegative: typeof parsed.t2iNegative === 'string' ? parsed.t2iNegative : '',
              t2iModels: parsed.t2iModels && typeof parsed.t2iModels === 'object' ? parsed.t2iModels : {},
              t2iClipType: typeof parsed.t2iClipType === 'string' ? parsed.t2iClipType : 'flux',
              t2iSize:
                parsed.t2iSize && typeof parsed.t2iSize === 'object' && Number.isFinite(Number(parsed.t2iSize.width))
                  ? { width: Number(parsed.t2iSize.width), height: Number(parsed.t2iSize.height) || 1024 }
                  : { width: 1024, height: 1024 },
              t2iScale:
                Number.isFinite(Number(parsed.t2iScale)) && Number(parsed.t2iScale) > 0
                  ? Math.min(4, Math.max(0.25, Number(parsed.t2iScale)))
                  : 1,
              t2iPinPositive: typeof parsed.t2iPinPositive === 'string' ? parsed.t2iPinPositive : '',
              t2iPinNegative: typeof parsed.t2iPinNegative === 'string' ? parsed.t2iPinNegative : '',
              t2iPinEnabled: parsed.t2iPinEnabled !== false,
              t2iSampling:
                parsed.t2iSampling && typeof parsed.t2iSampling === 'object'
                  ? parsed.t2iSampling
                  : { steps: 20, cfg: 1, sampler: 'euler', scheduler: 'simple', seed: 0 },
              t2iMeta: parsed.t2iMeta && typeof parsed.t2iMeta === 'object' ? parsed.t2iMeta : {},
              t2iPromptStyle: parsed.t2iPromptStyle === 'natural' ? 'natural' : 'tags',
              promptWriteSystemTags: typeof parsed.promptWriteSystemTags === 'string' ? parsed.promptWriteSystemTags : '',
              promptWriteSystemNatural:
                typeof parsed.promptWriteSystemNatural === 'string' ? parsed.promptWriteSystemNatural : '',
              promptWriteProvider:
                typeof parsed.promptWriteProvider === 'string' ? parsed.promptWriteProvider : '',
              promptWriteModel: typeof parsed.promptWriteModel === 'string' ? parsed.promptWriteModel : '',
              promptWriteEffort: ['off', 'low', 'high', 'max'].includes(parsed.promptWriteEffort)
                ? parsed.promptWriteEffort
                : 'high',
              promptWriteHistory: Array.isArray(parsed.promptWriteHistory) ? parsed.promptWriteHistory : [],
              editorPositiveHeight:
                typeof parsed.editorPositiveHeight === 'number' ? parsed.editorPositiveHeight : 96,
              editorNegativeHeight:
                typeof parsed.editorNegativeHeight === 'number' ? parsed.editorNegativeHeight : 96,
              viewerPanelWidth:
                typeof parsed.viewerPanelWidth === 'number' ? parsed.viewerPanelWidth : 360,
              albumTheme: parsed.albumTheme === 'light' ? 'light' : 'dark',
              albumDir: typeof parsed.albumDir === 'string' ? parsed.albumDir : '',
              zoomSummaryHeight:
                typeof parsed.zoomSummaryHeight === 'number' ? parsed.zoomSummaryHeight : 54,
              zoomDescHeight:
                typeof parsed.zoomDescHeight === 'number' ? parsed.zoomDescHeight : 68,
              zoomPanelWidth:
                typeof parsed.zoomPanelWidth === 'number' ? parsed.zoomPanelWidth : 260,
              workspacePanelWidth:
                typeof parsed.workspacePanelWidth === 'number' ? parsed.workspacePanelWidth : 280,
              canvasRuler: parsed.canvasRuler === true,
              canvasFile: typeof parsed.canvasFile === 'string' ? parsed.canvasFile : '',
              workspaceCanvasRuler: parsed.workspaceCanvasRuler === true,
              workspaceTheme: parsed.workspaceTheme === 'light' ? 'light' : 'dark',
              workspaceFile: typeof parsed.workspaceFile === 'string' ? parsed.workspaceFile : '',
              workspacePolishEffort:
                typeof parsed.workspacePolishEffort === 'string' ? parsed.workspacePolishEffort : '',
              canvasWorkspace: parsed.canvasWorkspace !== false,
              canvasModels: normalizeModels(parsed.canvasModels),
              workspaceCanvasModels: normalizeModels(parsed.workspaceCanvasModels),
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
    /** Ask the Host to start the local ComfyUI install. */
    async function launchLocalComfy() {
      try {
        const res = await fetch('/plugin/comfy-status/launch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dir: pluginPrefs.get().comfyPath || '' }),
        })
        const data = await res.json().catch(() => null)
        return data || { ok: false, error: '启动请求失败' }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    }

    /** Ask the Host to stop the running ComfyUI (frees the port for a restart). */
    async function stopLocalComfy() {
      try {
        const res = await fetch('/plugin/comfy-status/stop', { method: 'POST' })
        return (await res.json().catch(() => null)) || { ok: false, error: '停止请求失败' }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    }

    /** In-page directory browser: path bar + drive/folder list + confirm. */
    function DirectoryPicker(props) {
      ensureWorkbenchStyle()
      const open = Boolean(props && props.open)
      const [cwd, setCwd] = useState('')
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [pathInput, setPathInput] = useState('')
      const [hovered, setHovered] = useState('')
      useEffect(() => {
        if (!open) return undefined
        const startPath = (props && props.startPath) || ''
        setCwd(startPath)
        setPathInput(startPath)
        setData(null)
        setError('')
        return undefined
      }, [open])
      useEffect(() => {
        if (!open) return undefined
        let alive = true
        setBusy(true)
        setError('')
        fetch('/plugin/comfy-status/browse?path=' + encodeURIComponent(cwd), { cache: 'no-store' })
          .then((res) => res.json())
          .then((payload) => {
            if (!alive) return
            if (!payload || !payload.ok) throw new Error((payload && payload.error) || '读取失败')
            setData(payload)
            if (payload.path) setPathInput(payload.path)
          })
          .catch((err) => {
            if (!alive) return
            setData(null)
            setError(String((err && err.message) || err))
          })
          .finally(() => {
            if (alive) setBusy(false)
          })
        return () => {
          alive = false
        }
      }, [open, cwd])
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, props])
      if (!open) return null
      const picks = data && Array.isArray(data.drives) ? data.drives : data && Array.isArray(data.dirs) ? data.dirs : []
      const go = (value) => {
        const next = String(value || '').trim()
        if (next) setCwd(next)
      }
      const btn = {
        padding: '5px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.42)',
            backdropFilter: 'blur(2px)',
          },
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        h(
          'div',
          {
            style: {
              width: 620,
              maxWidth: 'calc(100vw - 40px)',
              maxHeight: '72vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 16,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.3)',
              overflow: 'hidden',
              animation: 'dshPageIn 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
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
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
              },
            },
            h(Icon, { name: 'folder', size: 15 }),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, (props && props.title) || '选择目录'),
            h('span', { style: { flex: 1 } }),
            h(
              'button',
              {
                type: 'button',
                onClick: props.onClose,
                title: '关闭（Esc）',
                style: {
                  width: 24,
                  height: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  borderRadius: '50%',
                  border: 0,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
              },
              '×',
            ),
          ),
          h(
            'div',
            {
              style: {
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l1)',
              },
            },
            h(
              'button',
              {
                type: 'button',
                style: btn,
                onClick: () => data && data.parent && go(data.parent),
                disabled: !(data && data.parent),
              },
              '上级',
            ),
            h('input', {
              value: pathInput,
              placeholder: '路径（回车跳转）',
              onChange: (event) => setPathInput(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') go(pathInput)
              },
              style: {
                flex: 1,
                minWidth: 0,
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 11.5,
                fontFamily: 'inherit',
                outline: 'none',
              },
            }),
          ),
          h(
            'div',
            { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 } },
            busy
              ? h('div', { style: { padding: 16, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '加载中…')
              : error
                ? h('div', { style: { padding: 16, fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' } }, error)
                : picks.length === 0
                  ? h('div', { style: { padding: 16, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '没有子目录')
                  : picks.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry.path,
                          type: 'button',
                          onClick: () => go(entry.path),
                          onMouseEnter: () => setHovered(entry.path),
                          onMouseLeave: () => setHovered(''),
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            padding: '7px 10px',
                            borderRadius: 8,
                            border: 0,
                            background: hovered === entry.path ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
                            color: 'var(--dsw-alias-label-primary)',
                            fontSize: 11.5,
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'background .12s ease',
                          },
                        },
                        h(Icon, { name: 'folder', size: 14 }),
                        h(
                          'span',
                          { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                          entry.name,
                        ),
                      ),
                    ),
          ),
          h(
            'div',
            {
              style: {
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderTop: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
              },
            },
            h(
              'span',
              {
                title: cwd,
                style: {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 10,
                  color: 'var(--dsw-alias-label-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              cwd || '此电脑',
            ),
            h('button', { type: 'button', style: btn, onClick: props.onClose }, '取消'),
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, btn, {
                  background: '#3b82f6',
                  borderColor: '#3b82f6',
                  color: '#ffffff',
                  fontWeight: 600,
                }),
                onClick: () => props.onPick(cwd || (picks[0] && picks[0].path) || ''),
              },
              '使用此目录',
            ),
          ),
        ),
      )
    }

    /** Big "start ComfyUI" control with a folder-picker gear beside it. */
    function LaunchComfyButton(props) {
      const compact = Boolean(props && props.compact)
      // Settings page: one button that carries both states, driven by whether the
      // engine actually answers rather than by the last click.
      const toggle = Boolean(props && props.toggle)
      const [online, setOnline] = useState(false)
      const [busy, setBusy] = useState(false)
      const [stopping, setStopping] = useState(false)
      const [picking, setPicking] = useState(false)
      const [pickerOpen, setPickerOpen] = useState(false)
      const [message, setMessage] = useState('')
      const readOnline = () =>
        fetch('/plugin/comfy-status/snapshot', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            const up = Boolean(data && data.up)
            setOnline(up)
            return up
          })
          .catch(() => false)
      useEffect(() => {
        if (!toggle) return undefined
        let alive = true
        const tick = () => {
          if (alive) readOnline()
        }
        tick()
        const timer = setInterval(tick, 5000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [toggle])
      const run = async () => {
        if (busy) return
        setBusy(true)
        setMessage('')
        const result = await launchLocalComfy()
        if (result && result.ok) {
          setMessage(result.message || '已请求启动')
          // ComfyUI takes a few seconds to answer after the process starts: hold
          // "正在启动…" until the snapshot says up, instead of flipping at once.
          if (toggle) {
            for (let attempt = 0; attempt < 25; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
              if (await readOnline()) break
            }
          }
        } else {
          setMessage((result && result.error) || '启动失败')
        }
        setBusy(false)
      }
      const stop = async () => {
        if (stopping) return
        setStopping(true)
        setMessage('')
        const result = await stopLocalComfy()
        if (result && result.ok) {
          setMessage(result.message || '已停止')
          if (toggle) setOnline(false)
        } else {
          setMessage((result && result.error) || '停止失败')
        }
        setStopping(false)
      }
      const chooseDir = () => {
        setPickerOpen(true)
      }
      if (toggle) {
        const working = busy || stopping
        const label = busy ? '正在启动…' : stopping ? '正在停止…' : online ? '停止 ComfyUI' : '启动 ComfyUI'
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 16 } },
          h(
            'button',
            {
              type: 'button',
              disabled: working,
              onClick: online ? stop : run,
              title: online ? '停止 ComfyUI' : '启动 ComfyUI',
              className: 'dshComfyLift',
              style: {
                minWidth: 190,
                padding: '10px 30px',
                borderRadius: 10,
                border: '1px solid ' + (online ? '#dc2626' : '#3b82f6'),
                background: online ? '#dc2626' : '#3b82f6',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: working ? 'default' : 'pointer',
                opacity: working ? 0.75 : 1,
                // The glow follows the state: red when the click would stop.
                '--dshComfyGlow': online ? 'rgba(220, 38, 38, 0.42)' : 'rgba(59, 130, 246, 0.45)',
              },
            },
            label,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' } },
            h(
              'button',
              {
                type: 'button',
                disabled: picking,
                onClick: chooseDir,
                title: '选择 ComfyUI 目录',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 9px',
                  borderRadius: 7,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 10.5,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
              },
              h(Icon, { name: 'settings', size: 13 }),
              '选择目录',
            ),
            message
              ? h(
                  'span',
                  {
                    style: {
                      fontSize: 10,
                      color: 'var(--dsw-alias-label-secondary)',
                      maxWidth: 280,
                      wordBreak: 'break-all',
                    },
                  },
                  message,
                )
              : null,
          ),
          h(DirectoryPicker, {
            open: pickerOpen,
            title: '选择 ComfyUI 安装目录',
            startPath: pluginPrefs.get().comfyPath || '',
            onPick: (path) => {
              pluginPrefs.set('comfyPath', path)
              setPickerOpen(false)
              setMessage('已选择：' + path)
            },
            onClose: () => setPickerOpen(false),
          }),
        )
      }
      if (compact) {
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: run,
              className: 'dshComfyLift',
              style: {
                padding: '2px 7px',
                borderRadius: 6,
                border: '1px solid #3b82f6',
                background: '#3b82f6',
                color: '#ffffff',
                fontSize: 10,
                fontFamily: 'inherit',
                cursor: 'pointer',
                '--dshComfyGlow': 'rgba(59, 130, 246, 0.4)',
              },
            },
            busy ? '启动中…' : '启动 ComfyUI',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: picking,
              onClick: chooseDir,
              title: '选择 ComfyUI 目录',
              style: {
                padding: '2px 6px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 10,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              },
            },
            h(Icon, { name: 'settings', size: 11 }),
          ),
          message ? h('span', { style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)' } }, message) : null,
          h(DirectoryPicker, {
            open: pickerOpen,
            title: '选择 ComfyUI 安装目录',
            startPath: pluginPrefs.get().comfyPath || '',
            onPick: (path) => {
              pluginPrefs.set('comfyPath', path)
              setPickerOpen(false)
              setMessage('已选择：' + path)
            },
            onClose: () => setPickerOpen(false),
          }),
        )
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 16 } },
        h(
          'button',
          {
            type: 'button',
            disabled: busy,
            onClick: run,
            className: 'dshComfyLift',
            style: {
              padding: '10px 30px',
              borderRadius: 10,
              border: '1px solid #3b82f6',
              background: '#3b82f6',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              '--dshComfyGlow': 'rgba(59, 130, 246, 0.45)',
            },
          },
          busy ? '正在启动…' : '启动 ComfyUI',
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' } },
          h(
            'button',
            {
              type: 'button',
              disabled: picking,
              onClick: chooseDir,
              title: '选择 ComfyUI 目录',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 9px',
                borderRadius: 7,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 10.5,
                fontFamily: 'inherit',
                cursor: 'pointer',
              },
            },
            h(Icon, { name: 'settings', size: 13 }),
            '选择目录',
          ),
          message
            ? h(
                'span',
                {
                  style: {
                    fontSize: 10,
                    color: 'var(--dsw-alias-label-secondary)',
                    maxWidth: 280,
                    wordBreak: 'break-all',
                  },
                },
                message,
              )
            : null,
        ),
        h(DirectoryPicker, {
          open: pickerOpen,
          title: '选择 ComfyUI 安装目录',
          startPath: pluginPrefs.get().comfyPath || '',
          onPick: (path) => {
            pluginPrefs.set('comfyPath', path)
            setPickerOpen(false)
            setMessage('已选择：' + path)
          },
          onClose: () => setPickerOpen(false),
        }),
      )
    }

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
      settings: [
        [
          'path',
          {
            d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
          },
        ],
        ['circle', { cx: 12, cy: 12, r: 3 }],
      ],
      folder: [
        [
          'path',
          {
            d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
          },
        ],
      ],
      sparkles: [
        ['path', { d: 'm12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z' }],
        ['path', { d: 'M5 3v4' }],
        ['path', { d: 'M19 17v4' }],
        ['path', { d: 'M3 5h4' }],
        ['path', { d: 'M17 19h4' }],
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
      pin: [
        ['path', { d: 'M12 17v5' }],
        ['path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' }],
      ],
      'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
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

    // ------------------------------------------------------- DSH model catalog

    /**
     * 0..4 LoRA entries as { name, strength }, the shape the host rebuilds the
     * chain from: UNET → lora… → sampler, in this order.
     */
    function normalizeLoraList(raw) {
      return (Array.isArray(raw) ? raw : [])
        .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim())
        .map((entry) => ({
          name: entry.name.trim(),
          strength: Number.isFinite(Number(entry.strength)) ? Number(entry.strength) : 1,
        }))
        .slice(0, 4)
    }

    /** One pickable route: provider and model ids never travel alone. */
    function routeKey(provider, model) {
      return String(provider || '') + '\u0000' + String(model || '')
    }

    /**
     * Join the pinned quality prefix with the text being submitted.
     *
     * The prefix goes first (that is the order these models were trained on),
     * the two sides are trimmed, and stray commas at either seam are dropped so
     * the result never reads `,,` or ends with a dangling comma.
     * @param pin - pinned prefix text.
     * @param text - the prompt/negative the user wrote.
     * @param enabled - whether the pin is currently switched on.
     * @returns the text to submit.
     */
    function mergePinnedText(pin, text, enabled) {
      const body = String(text || '').trim().replace(/^[,，\s]+/, '')
      const head = enabled
        ? String(pin || '').trim().replace(/^[,，\s]+/, '').replace(/[,，\s]+$/, '')
        : ''
      if (!head) return body
      if (!body) return head
      return head + ', ' + body
    }

    function parseRouteKey(value) {
      const raw = String(value || '')
      const index = raw.indexOf('\u0000')
      if (index < 0) return { provider: '', model: raw }
      return { provider: raw.slice(0, index), model: raw.slice(index + 1) }
    }

    /**
     * The models DSH itself can route to, shared by every picker in this bundle.
     * One request fills it; the host keeps its own short-lived cache behind the
     * route, so reopening a menu costs one cached round trip at most.
     */
    const llmCatalogStore = (() => {
      let state = { catalog: null, error: '', busy: false }
      const listeners = new Set()
      const set = (patch) => {
        state = Object.assign({}, state, patch)
        for (const listener of [...listeners]) listener()
      }
      const load = (refresh) => {
        if (state.busy) return Promise.resolve(state.catalog)
        set({ busy: true, error: '' })
        return fetch('/plugin/comfy-canvas/models' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
          .then((res) =>
            res.json().then((data) => {
              if (!data || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
              return data
            }),
          )
          .then((data) => {
            const catalog = {
              groups: Array.isArray(data.groups) ? data.groups : [],
              failures: Array.isArray(data.failures) ? data.failures : [],
              default: data.default && typeof data.default === 'object' ? data.default : null,
            }
            set({ catalog, busy: false, error: '' })
            return catalog
          })
          .catch((error) => {
            set({ busy: false, error: String((error && error.message) || error) })
            return null
          })
      }
      return {
        get: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        load,
        // First mount fetches; later mounts read what is already here.
        ensure: () => (state.catalog === null && !state.busy ? load(false) : Promise.resolve(state.catalog)),
      }
    })()

    function useLlmCatalog() {
      const [state, setState] = useState(llmCatalogStore.get())
      useEffect(() => llmCatalogStore.subscribe(() => setState(llmCatalogStore.get())), [])
      return state
    }

    /** The catalog model behind one selected pair, if it is still advertised. */
    function catalogModelOf(catalog, provider, model) {
      if (!catalog || !model) return null
      for (const group of catalog.groups || []) {
        if (provider && group.id !== provider) continue
        const hit = (group.models || []).find((entry) => entry.id === model)
        if (hit) return hit
      }
      return null
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

    /** One editable draft handed from a canvas to the conversation composer. */
    const draftStore = (() => {
      let state = { open: false, sessionId: '', title: '', text: '', mode: 'final', note: '' }
      const listeners = new Set()
      return {
        get: () => state,
        set(next) {
          state = Object.assign({}, state, next)
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    })()

    /**
     * Canvas draft over the composer: the layout lands here as editable text with
     * a note box and a final/submit mode, and only the confirmed payload reaches
     * the agent (via the composer's own submit).
     */
    function DraftCard(props) {
      const [draft, setDraft] = useState(draftStore.get())
      useEffect(() => draftStore.subscribe(() => setDraft(draftStore.get())), [])
      // Keep the card mounted through its exit animation, like the model dialog.
      const [visible, setVisible] = useState(draft.open)
      const [closing, setClosing] = useState(false)
      const [hoverClose, setHoverClose] = useState(false)
      const cardRef = useRef(null)
      const animRef = useRef(null)
      const [hoverCancel, setHoverCancel] = useState(false)
      const [hoverSubmit, setHoverSubmit] = useState(false)
      const visibleRef = useRef(draft.open)
      useEffect(() => {
        if (draft.open) {
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
        }, 280)
        return () => clearTimeout(timer)
      }, [draft.open])
      // CSS grid-rows transition (0fr ↔ 1fr) instead of per-frame height writes:
      // the browser animates the layout itself, so the transcript above is not
      // reflowed through JS on every frame (see the flow-motion fold approach).
      const [entered, setEntered] = useState(false)
      useEffect(() => {
        if (!draft.open) {
          setEntered(false)
          return undefined
        }
        // Two frames: the first paints the collapsed state, the second starts the
        // transition, so the browser actually animates the entrance.
        let second = 0
        const first = requestAnimationFrame(() => {
          second = requestAnimationFrame(() => setEntered(true))
        })
        return () => {
          cancelAnimationFrame(first)
          cancelAnimationFrame(second)
        }
      }, [draft.open])
      if (!visible) return null
      if (draft.sessionId && props && props.sessionId && draft.sessionId !== props.sessionId) return null
      const actions = props && props.inputActions ? props.inputActions : null
      const close = () => draftStore.set({ open: false })
      const submit = () => {
        if (!actions) {
          draftStore.set({ note: '当前面板没有可用的会话输入通道' })
          return
        }
        const text = String(draft.text || '').trim()
        if (!text) return
        const note = String(draft.note || '').trim()
        const payload =
          draft.mode === 'final'
            ? text + (note ? '\n\n备注：' + note : '')
            : '这是一份待修改的草稿（不是终稿）：\n\n' + text + (note ? '\n\n修改要求：' + note : '')
        try {
          actions.setDraft(payload)
          actions.persistDraft()
          actions.submit()
          draftStore.set({ open: false })
        } catch (error) {
          draftStore.set({ note: String((error && error.message) || error) })
        }
      }
      const btn = {
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 10.5,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      const field = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        lineHeight: 1.5,
        outline: 'none',
        resize: 'vertical',
      }
      // Height auto ↔ 0 through interpolate-size (Chrome 129+): the browser
      // interpolates the `auto` keyword, so no per-frame JS is needed, and the
      // card keeps its own overflow/box-shadow instead of being clipped by an
      // outer hidden container.
      // The card floats above the composer on its own layer: the wrapper is zero
      // height, so opening it never pushes the transcript around. The negative
      // margin cancels the composer stack's flex gap, which otherwise counts a
      // zero-height entry and lifts the transcript by that gap.
      return h(
        'div',
        {
          style: {
            position: 'relative',
            height: 0,
            marginBottom: 'calc(-1 * var(--dsh-composer-stack-gap, 6px))',
            zIndex: 20,
          },
        },
        h(
          'div',
          {
            style: {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'calc(100% + 8px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxWidth: 'var(--dsh-composer-card-max-width)',
              margin: '0 auto',
              boxSizing: 'border-box',
              padding: 12,
              borderRadius: 'var(--dsw-radius-panel)',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 84%, transparent)',
              backdropFilter: 'blur(18px) saturate(1.3)',
              boxShadow: '0 18px 48px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)',
              maxHeight: '50vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              transformOrigin: 'center bottom',
              willChange: 'opacity, transform',
              opacity: closing ? 0 : entered ? 1 : 0,
              transform: entered && !closing ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.96)',
              transition: 'opacity 200ms ease, transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
            },
          },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { fontSize: 12, fontWeight: 600 } }, (draft.title || '草稿') + ' · 可编辑'),
          h('span', { style: { flex: 1 } }),
          // Drawn as SVG instead of a styled element: a <circle> is a真 circle no
          // matter what the app's global button/div styles do, and the x strokes
          // are centered by construction.
          h(
            'svg',
            {
              width: 24,
              height: 24,
              viewBox: '0 0 24 24',
              role: 'button',
              tabIndex: 0,
              title: '关闭草稿',
              onClick: close,
              onMouseEnter: () => setHoverClose(true),
              onMouseLeave: () => setHoverClose(false),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  close()
                }
              },
              style: {
                flex: 'none',
                display: 'block',
                cursor: 'pointer',
                outline: 'none',
                transform: hoverClose ? 'scale(1.06)' : 'none',
                transition: 'transform .16s ease, filter .16s ease',
                filter: hoverClose ? 'drop-shadow(0 4px 8px rgba(239, 68, 68, 0.45))' : 'none',
              },
            },
            h('circle', {
              cx: 12,
              cy: 12,
              r: 11,
              fill: hoverClose ? '#dc2626' : '#ef4444',
              style: { transition: 'fill .16s ease' },
            }),
            h('path', {
              d: 'M9 9l6 6M15 9l-6 6',
              stroke: '#ffffff',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
            }),
          ),
        ),
        h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '正文（可直接改）'),
        h('textarea', {
          value: draft.text,
          rows: 7,
          style: field,
          onChange: (event) => draftStore.set({ text: event.target.value }),
        }),
        h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '这份是？'),
        h(
          'div',
          { style: { display: 'flex', gap: 14 } },
          [
            ['final', '提交终稿（已改好）'],
            ['advice', '只提修改意见'],
          ].map(([value, label]) =>
            h(
              'label',
              {
                key: value,
                style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' },
              },
              h('input', {
                type: 'radio',
                name: 'dsh-comfy-draft-mode',
                checked: draft.mode === value,
                onChange: () => draftStore.set({ mode: value }),
              }),
              label,
            ),
          ),
        ),
        h(
          'div',
          { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
          '备注（可选）：改了哪里 / 想调整的方向',
        ),
        h('input', {
          value: draft.note,
          placeholder: '例如：把第 2 个框的 caption 改成室内夜景',
          style: Object.assign({}, field, { resize: 'none' }),
          onChange: (event) => draftStore.set({ note: event.target.value }),
        }),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
          h(
            'button',
            {
              type: 'button',
              style: Object.assign({}, btn, {
                padding: '7px 16px',
                fontSize: 12,
                transition:
                  'background .18s cubic-bezier(.22,1,.36,1), box-shadow .18s cubic-bezier(.22,1,.36,1), transform .18s cubic-bezier(.22,1,.36,1)',
                transform: hoverCancel ? 'translateY(-1px)' : 'none',
                boxShadow: hoverCancel ? '0 6px 18px rgba(0, 0, 0, 0.12)' : 'none',
              }),
              onMouseEnter: () => setHoverCancel(true),
              onMouseLeave: () => setHoverCancel(false),
              onClick: close,
            },
            '取消',
          ),
          h(
            'button',
            {
              type: 'button',
              style: Object.assign({}, btn, {
                padding: '7px 18px',
                fontSize: 12,
                background: '#3b82f6',
                borderColor: '#3b82f6',
                color: '#ffffff',
                fontWeight: 600,
                transition:
                  'background .18s cubic-bezier(.22,1,.36,1), box-shadow .18s cubic-bezier(.22,1,.36,1), transform .18s cubic-bezier(.22,1,.36,1)',
                transform: hoverSubmit ? 'translateY(-1px)' : 'none',
                boxShadow: hoverSubmit ? '0 8px 22px rgba(59, 130, 246, 0.38)' : 'none',
              }),
              onMouseEnter: () => setHoverSubmit(true),
              onMouseLeave: () => setHoverSubmit(false),
              onClick: submit,
            },
            '提交',
          ),
        ),
        ),
      )
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
              null,
              h(
                'div',
                { style: Object.assign({}, SUB, ELLIPSIS, { fontSize: 9.5 }) },
                snap ? '端口未响应 ' + (snap.url || '').replace(/^https?:\/\//, '') : '正在连接…',
              ),
              h(LaunchComfyButton, { marginTop: 6, compact: true }),
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
      position: 'relative',
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
      // Same box as the canvas tab's header, so the two panes line up when the
      // user switches between them.
      gap: 10,
      padding: '12px 14px',
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
    /** Flat layout: every image in one dense grid (no day groups). */
    const FLAT_GRID = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gap: 8,
      padding: 10,
      alignContent: 'start',
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

    /** Is the host app itself dark right now? Read, don't guess. */
    function readDshNight() {
      try {
        const cs = getComputedStyle(document.body)
        if (cs.colorScheme) return /dark/i.test(cs.colorScheme)
        const hit = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.backgroundColor || '')
        if (hit) return (Number(hit[1]) + Number(hit[2]) + Number(hit[3])) / 3 < 110
      } catch {
        // Fall through to the system preference.
      }
      return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    }

    /** Live view of the host theme, so 'auto' follows it instead of freezing. */
    function useDshNight() {
      const [night, setNight] = useState(readDshNight)
      useEffect(() => {
        const sync = () => setNight(readDshNight())
        const timer = setInterval(sync, 1200)
        const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
        if (media && media.addEventListener) media.addEventListener('change', sync)
        const observer = new MutationObserver(sync)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
        return () => {
          clearInterval(timer)
          if (media && media.removeEventListener) media.removeEventListener('change', sync)
          observer.disconnect()
        }
      }, [])
      return night
    }

    /**
     * Surface theme preference: 'auto' follows the host, 'dark'/'light' override it.
     * A click walks auto → the opposite of what is showing → the other → auto, so
     * following the host again stays reachable.
     */
    function useSurfaceTheme(prefKey) {
      const [stored, setStored] = usePref(prefKey)
      const dshNight = useDshNight()
      const mode = stored === 'dark' || stored === 'light' ? stored : 'auto'
      const night = mode === 'auto' ? dshNight : mode === 'dark'
      const cycle = () => {
        if (mode === 'auto') setStored(dshNight ? 'light' : 'dark')
        else if (mode === 'dark') setStored('light')
        else setStored('auto')
      }
      return { night, mode, cycle }
    }

    /** Icon-only theme switch, same box as the other square header buttons. */
    function SurfaceThemeButton(props) {
      const night = Boolean(props.night)
      const mode = props.mode || 'auto'
      const label = mode === 'auto' ? '跟随 DSH 主题' : night ? '深色' : '浅色'
      // Drawn and styled inline: this button also renders on the panels that never
      // mount the album/canvas stylesheets, where a class-based icon came out as
      // an empty grey box.
      return h(
        'button',
        {
          type: 'button',
          title: mode === 'auto' ? '当前跟随 DSH 主题（点击改为手动）' : '当前手动：' + label + '（点击继续切换）',
          'aria-label': '切换深浅主题',
          onClick: props.onClick,
          style: {
            flexShrink: 0,
            alignSelf: 'stretch',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 25,
            padding: 0,
            boxSizing: 'border-box',
            borderRadius: 7,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-secondary)',
            cursor: 'pointer',
          },
        },
        h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { display: 'block' },
          },
          ...lucideParts(night ? 'moon' : 'sun'),
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
      ensureBaseStyle()
      return h(
        'style',
        null,
        [
          '.dshComfyAlbum-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.4;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
          SURFACE_LIGHT_CSS,
          SURFACE_DARK_CSS,
          // Switching themes cross-fades the token-driven colors instead of
          // hard-cutting the whole page. The rules live in ensureBaseStyle() now;
          // keeping a copy here gave them class-level specificity, which outranked
          // component transitions (the AI button's lift) whenever this sheet was up.
          THEME_ICON_CSS,
          '.dshComfyAlbum-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
          // The album header follows the canvas tab's bar: same box, same radius,
          // and a square icon button for the theme switch.
          '.dshComfyAlbum-head .dshComfyAlbum-btn{padding:4px 11px;border-radius:7px;border-color:var(--dsw-alias-border-l2);line-height:1.5;transition:transform 160ms cubic-bezier(0.23,1,0.32,1)}',
          '.dshComfyAlbum-head .dshComfyAlbum-btn[data-dark="true"]{border-color:rgba(255,255,255,.14)}',
          '.dshComfyAlbum-head .dshComfyAlbum-btn[data-square="true"]{width:25px;padding:0;align-self:stretch;box-sizing:border-box;justify-content:center}',
          // Same press feedback as the canvas bar.
          '.dshComfyAlbum-head .dshComfyAlbum-btn:active:not(:disabled){transform:scale(.97) translateY(1px)}',
          '.dshComfyAlbum-head .dshComfyAlbum-btn:hover:not(:disabled){filter:brightness(1.06)}',
          '@media (prefers-reduced-motion:reduce){.dshComfyAlbum-head .dshComfyAlbum-btn{transition:none}.dshComfyAlbum-head .dshComfyAlbum-btn:active:not(:disabled){transform:none}}',
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
          // One box for the whole viewer bar: icon buttons were pinned to 22px
          // while the text buttons next to them were sized by line-height (~20.7),
          // so the row sat 1.3px out of true. Both get the same fixed height now.
          '.dshComfyViewer-bar .dshComfyAlbum-btn{display:inline-flex;align-items:center;justify-content:center;height:22px;padding:0 9px;box-sizing:border-box}',
          '.dshComfyViewer-bar .dshComfyAlbum-btn.dshComfyViewer-icon{width:22px;padding:0}',
          '.dshComfyViewer-resize:hover{background:rgba(255,255,255,.1)}',
          // The self-drawn dropdown lives in the canvas styles too; the album
          // viewer uses it as well, so its rules have to be present here.
          '.dshCanvasPicker{appearance:none;display:flex;align-items:center;width:100%;box-sizing:border-box;font:inherit;font-size:10.5px;padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}',
          '.dshCanvasPicker:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasPicker[data-dark="true"]{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:rgba(255,255,255,.9)}',
          '.dshCanvasPicker[data-dark="true"]:hover{background:rgba(255,255,255,.11)}',
          '.dshCanvasOption{appearance:none;display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:10.5px;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.dshCanvasOption:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasOption[data-on="true"]{background:#3b82f6;color:#ffffff}',
          '.dshCanvasOption[data-dark="true"]{color:rgba(255,255,255,.88)}',
          '.dshCanvasOption[data-dark="true"]:hover{background:rgba(255,255,255,.1)}',
          '.dshCanvasOption[data-dark="true"][data-on="true"]{background:#3b82f6;color:#ffffff}',
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
          '@keyframes dshAlbumSwapIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}',
          '.dshComfyAlbum-swap{animation:dshAlbumSwapIn .18s ease-out both}',
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
        let pollTimer = null
        let refreshTimer = null
        const load = async () => {
          try {
            const res = await fetch(ALBUM_ENDPOINT, { cache: 'no-store' })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const data = await res.json()
            if (!alive) return
            setAlbum(data)
            setError(null)
            // While something is actually running, keep the banner honest even if
            // a live event is missed; an idle gallery does not poll.
            if (data && Array.isArray(data.running) && data.running.length > 0) {
              if (pollTimer) clearTimeout(pollTimer)
              pollTimer = setTimeout(load, 3000)
            }
          } catch (e) {
            if (!alive) return
            setError(String((e && e.message) || e))
          }
        }
        // ComfyUI may still be writing history when the completion event lands,
        // and the Host caches /album for two seconds: one delayed pass makes
        // sure the new card actually appears.
        const refreshSoon = () => {
          if (!alive) return
          load()
          if (refreshTimer) clearTimeout(refreshTimer)
          refreshTimer = setTimeout(() => {
            refreshTimer = null
            if (alive) load()
          }, 2500)
        }
        load()
        const unsubscribeEvents = comfyEvents.subscribe((event) => {
          const type = event && event.type
          if (type === 'execution_success' || type === 'executed') {
            refreshSoon()
          }
        })
        return () => {
          alive = false
          if (pollTimer) clearTimeout(pollTimer)
          if (refreshTimer) clearTimeout(refreshTimer)
          unsubscribeEvents()
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

      const [progress, setProgress] = useState(null)
      useEffect(() => {
        setProgress(null)
      }, [job && job.id])
      useEffect(() => {
        const unsubscribe = comfyEvents.subscribe((event) => {
          if (!event || event.type !== 'progress') return
          const data = event.data || {}
          if (!job || !job.id || data.prompt_id !== job.id) return
          const value = Number(data.value)
          const max = Number(data.max)
          if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
            setProgress({ value: Math.max(0, Math.round(value)), max: Math.max(1, Math.round(max)) })
          }
        })
        return unsubscribe
      }, [job && job.id])

      const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
      const head = meta.positive && meta.positive.text ? meta.positive.text.replace(/\s+/g, ' ').trim() : ''

      const sampler = meta.sampler
      const samplerLine = sampler
        ? [sampler.steps !== null ? sampler.steps + ' 步' : '', sampler.cfg !== null ? 'CFG ' + sampler.cfg : '', sampler.seed !== null ? 'seed ' + sampler.seed : '']
            .filter(Boolean)
            .join(' · ') + (progress ? ' · 进度 ' + progress.value + '/' + progress.max : '')
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
              width: progress ? (progress.value / progress.max) * 100 + '%' : '38%',
              height: '100%',
              borderRadius: 99,
              background: 'linear-gradient(90deg, #ff4d4d, #ff9a4a)',
              transition: 'width .3s ease',
              ...(progress ? {} : { animation: 'dshComfyJobSlide 1.15s ease-in-out infinite' }),
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
      // 6 logical px lower than the old bottom:16, divided by UI_SCALE so a wide
      // 2K panel (which scales the whole surface up) keeps the same visual offset.
      bottom: 16 - 6 / UI_SCALE,
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
      boxSizing: 'border-box',
      // Reserve room for the floating info strip: the image never sits under it.
      paddingBottom: 56,
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
      // Longhands on purpose: the selected state overrides only the colour, and a
      // `border` shorthand here made React skip that update on rerender.
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: 'rgba(255, 255, 255, 0.25)',
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
     * ComfyUI execution events relayed by the Host over SSE.
     *
     * One shared EventSource for the whole plugin: subscribers receive every
     * frame and filter by prompt id. The browser reconnects on its own (SSE
     * `retry`), so no polling loop is needed.
     */
    const comfyEvents = (() => {
      let source = null
      let retryTimer = null
      const listeners = new Set()
      const connect = () => {
        if (source) return
        try {
          source = new EventSource('/plugin/comfy-status/events')
        } catch {
          source = null
          return
        }
        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            for (const listener of [...listeners]) listener(payload)
          } catch {
            // Malformed frames are ignored.
          }
        }
        source.onerror = () => {
          if (source) {
            source.close()
            source = null
          }
          if (retryTimer === null) {
            retryTimer = window.setTimeout(() => {
              retryTimer = null
              if (listeners.size > 0) connect()
            }, 3000)
          }
        }
      }
      return {
        subscribe(listener) {
          listeners.add(listener)
          connect()
          return () => listeners.delete(listener)
        },
      }
    })()

    /**
     * One shared tracker for the job the user started from the album.
     *
     * It lives at module scope on purpose. A completion chime has to survive the
     * viewer being closed — and an AudioContext owned by a component gets closed
     * exactly when that component unmounts, which is why the chime came and went.
     */
    const jobStore = (() => {
      let state = null
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

      const set = (next) => {
        state = next
        notify()
      }

      /** Output captured from `executed` until `execution_success` names the job. */
      let pendingOutput = null
      let watchdog = null

      const clearWatchdog = () => {
        if (watchdog) {
          clearTimeout(watchdog)
          watchdog = null
        }
      }

      /**
       * Safety net: if an SSE frame is missed (or the live channel is down),
       * reconcile against ComfyUI's queue/album so the strip never sticks in
       * "排队中" after the job is actually over.
       */
      let fallbackTimer = null
      const stopFallback = () => {
        if (fallbackTimer) {
          clearInterval(fallbackTimer)
          fallbackTimer = null
        }
      }
      const startFallback = () => {
        stopFallback()
        fallbackTimer = setInterval(async () => {
          const current = state
          if (!current || !current.id) return
          if (current.status === 'done' || current.status === 'error') {
            stopFallback()
            return
          }
          try {
            const snapRes = await fetch(SNAPSHOT, { cache: 'no-store' })
            const snap = await snapRes.json()
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
              settle({
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
              settle({ status: 'error', message: 'ComfyUI 执行失败', id: current.id, at: current.at, origin: current.origin })
            }
          } catch {
            // Retry on the next tick.
          }
        }, 5000)
      }

      const settle = (next) => {
        clearWatchdog()
        stopFallback()
        set(next)
      }

      const onEvent = (event) => {
        const current = state
        if (!current || !current.id) return
        const type = event && event.type
        const data = (event && event.data) || {}
        if (type === 'executed') {
          if (data.prompt_id !== current.id) return
          const images = data.output && Array.isArray(data.output.images) ? data.output.images : []
          if (images.length === 0) return
          const image = images.find((entry) => entry && entry.type === 'output') || images[0]
          if (!image || !image.filename) return
          pendingOutput = {
            url:
              '/plugin/comfy-status/view?filename=' +
              encodeURIComponent(image.filename) +
              '&subfolder=' +
              encodeURIComponent(image.subfolder || '') +
              '&type=' +
              encodeURIComponent(image.type || 'output'),
            filename: image.filename,
          }
          return
        }
        if (type === 'execution_start' && data.prompt_id === current.id) {
          if (current.status !== 'running') set({ ...current, status: 'running', message: '正在生成…' })
          return
        }
        if (type === 'progress' && data.prompt_id === current.id) {
          const value = Number(data.value)
          const max = Number(data.max)
          if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
            set({
              ...current,
              status: 'running',
              message: '正在生成…',
              progress: { value: Math.max(0, Math.round(value)), max: Math.max(1, Math.round(max)) },
            })
          }
          return
        }
        if (type === 'executing' && data.node !== null && data.prompt_id === current.id) {
          if (current.status !== 'running') set({ ...current, status: 'running', message: '正在生成…' })
          return
        }
        if (type === 'execution_success' && data.prompt_id === current.id) {
          settle({
            status: 'done',
            message: '生成完成，已加入相册',
            id: current.id,
            at: current.at,
            origin: current.origin,
            imageUrl: pendingOutput ? pendingOutput.url : '',
            filename: pendingOutput ? pendingOutput.filename : '',
          })
          pendingOutput = null
          if (pluginPrefs.get().sound !== false) ding()
          return
        }
        if (type === 'execution_error' && data.prompt_id === current.id) {
          pendingOutput = null
          settle({ status: 'error', message: 'ComfyUI 执行失败', id: current.id, at: current.at, origin: current.origin })
        }
      }

      comfyEvents.subscribe(onEvent)

      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        start(promptId, origin) {
          pendingOutput = null
          // Unlock the audio context inside the user gesture (the click that
          // submitted the job), so the later completion chime is allowed to play.
          ensureAudio()
          clearWatchdog()
          set({
            status: 'queued',
            message: '已交给 ComfyUI，等待生成…',
            id: promptId,
            at: Date.now(),
            origin: origin || 'album',
          })
          // A failed job may never emit success or error; stop waiting eventually.
          watchdog = setTimeout(() => {
            watchdog = null
            const current = state
            if (current && current.id === promptId && (current.status === 'queued' || current.status === 'running')) {
              set({
                status: 'error',
                message: '超时未检测到结果，请查看 ComfyUI 控制台',
                id: current.id,
                at: current.at,
                origin: current.origin,
              })
            }
          }, 600000)
          startFallback()
        },
        fail(message) {
          set({ status: 'error', message })
        },
        ensureAudio,
      }
    })()

    /** Parse the model's JSON reply into per-box items (tolerant of code fences). */
    function parsePolishJsonText(text) {
      let raw = String(text || '').trim()
      const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw)
      if (fence) raw = fence[1].trim()
      try {
        const parsed = JSON.parse(raw)
        const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : null
        if (!items) return null
        return items
          .map((item) => ({
            id: item && item.id !== undefined ? String(item.id) : '',
            text: item && typeof item.text === 'string' ? item.text : '',
          }))
          .filter((item) => item.text)
      } catch {
        return null
      }
    }

    /**
     * Pull the polished copy out of a free-form reply: prefer the JSON contract,
     * otherwise strip titles, prefaces, English alternates and trailing offers.
     */
    function extractPolishText(raw) {
      const text = String(raw || '').trim()
      try {
        const parsed = JSON.parse(text)
        if (typeof parsed === 'string') return parsed.trim()
        if (parsed && typeof parsed.text === 'string') return parsed.text.trim()
      } catch {
        // Not JSON: fall through to heuristic cleanup.
      }
      let body = text
      const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(body)
      if (fence) body = fence[1].trim()
      const lines = body.split('\n')
      const kept = []
      let started = false
      for (const line of lines) {
        const trimmed = line.trim()
        if (!started) {
          if (!trimmed) continue
          if (/^\*\*.+\*\*$/.test(trimmed) || /^#{1,6}\s/.test(trimmed) || /^【.+】$/.test(trimmed)) continue
          if (/^(润色后|润色结果|中文版?|英文|caption|result|以下|这是)/i.test(trimmed)) continue
          started = true
        }
        if (/^如果|^若是|^需要的话|^另外|^注[：:]|^提示[：:]|^如果你需要|^English|^\*\*英文/i.test(trimmed)) break
        kept.push(line)
      }
      return kept.join('\n').trim() || body
    }

    function formatTokenUsage(usage) {
      if (!usage) return ''
      const input = Number(usage.inputTokens) || 0
      const output = Number(usage.outputTokens) || 0
      const total = Number(usage.totalTokens) || input + output
      return 'token 输入 ' + input + ' / 输出 ' + output + ' / 合计 ' + total
    }

    /**
     * AI polish runs at module scope: switching away from the workspace unmounts
     * the panel, but the stream and its progress must survive so returning shows
     * the live state instead of a silent restart.
     */
    const polishStore = (() => {
      let state = {
        status: 'idle',
        stream: '',
        result: null,
        message: '',
        usage: null,
        history: [],
        skillLength: null,
        ranAs: null,
      }
      const listeners = new Set()
      const notify = () => {
        for (const listener of [...listeners]) listener()
      }
      const set = (patch) => {
        state = { ...state, ...patch }
        notify()
      }
      let controller = null

      const start = async (options) => {
        const { mode, instruction, targets, summary, history, effort, provider, model, key } = options
        const text = String(instruction || '').trim()
        if (!text) {
          set({ message: '先写润色要求' })
          return
        }
        if (!Array.isArray(targets) || targets.length === 0) {
          set({ message: mode === 'board' ? '画布上还没有框' : '先选中一个框' })
          return
        }
        if (state.status === 'running') return
        if (controller) {
          try {
            controller.abort()
          } catch {
            // Previous request was already gone.
          }
          controller = null
        }
        set({ status: 'running', stream: '', result: null, message: '润色中…', usage: null, ranAs: null })
        const abort = new AbortController()
        controller = abort
        try {
          const res = await fetch('/plugin/comfy-canvas/polish', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mode,
              instruction: text,
              summary,
              targets,
              history,
              effort: effort || undefined,
              provider: provider || undefined,
              model: model || undefined,
            }),
            signal: abort.signal,
          })
          if (!res.ok || !res.body) {
            const data = await res.json().catch(() => null)
            throw new Error((data && data.error) || 'HTTP ' + res.status)
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let streamed = ''
          let usage = null
          let failure = ''
          let skillLength = null
          const handleLine = (line) => {
            let event = null
            try {
              event = JSON.parse(line)
            } catch {
              return
            }
            if (!event) return
            if (event.type === 'delta' && typeof event.text === 'string') {
              streamed += event.text
              set({ stream: streamed })
            } else if (event.type === 'model' && event.provider && event.model) {
              set({ ranAs: String(event.provider) + ' / ' + String(event.model) })
            } else if (event.type === 'usage' && event.usage) {
              usage = event.usage
            } else if (event.type === 'done') {
              if (event.usage) usage = event.usage
              if (Number.isFinite(event.skillLength)) skillLength = Number(event.skillLength)
            } else if (event.type === 'error') {
              failure = String(event.error || '润色失败')
            }
          }
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let newline = buffer.indexOf('\n')
            while (newline >= 0) {
              const line = buffer.slice(0, newline).trim()
              buffer = buffer.slice(newline + 1)
              if (line) handleLine(line)
              newline = buffer.indexOf('\n')
            }
          }
          if (buffer.trim()) handleLine(buffer.trim())
          if (failure) throw new Error(failure)
          const finalText = streamed.trim()
          if (!finalText) throw new Error('模型没有返回内容')
          let result = null
          let message = '润色完成'
          if (mode === 'board') {
            const parsed = parsePolishJsonText(finalText)
            if (parsed && parsed.length > 0) {
              result = { items: parsed }
              message = '润色完成：' + parsed.length + ' 个框'
            } else {
              result = { text: finalText }
              message = '模型返回的不是合法 JSON，已原样展示'
            }
          } else {
            result = { text: extractPolishText(finalText) }
          }
          const nextHistory = [
            ...(Array.isArray(history) ? history : []),
            { role: 'user', text },
            { role: 'assistant', text: finalText, tokens: usage },
          ]
          if (key) {
            try {
              localStorage.setItem(key, JSON.stringify({ messages: nextHistory }))
            } catch {
              // Storage full: history still lives in memory.
            }
          }
          set({
            status: 'done',
            stream: '',
            result,
            usage,
            message: message + (usage ? ' · ' + formatTokenUsage(usage) : ''),
            history: nextHistory,
            skillLength,
          })
        } catch (error) {
          if (abort.signal.aborted) {
            set({ status: 'idle', stream: '', message: '已取消' })
          } else {
            set({ status: 'error', stream: '', message: '润色失败：' + String((error && error.message) || error) })
          }
        } finally {
          if (controller === abort) controller = null
        }
      }

      const setMessage = (message) => {
        set({ message })
      }

      const clear = (key) => {
        try {
          if (key) localStorage.removeItem(key)
        } catch {
          // Nothing stored.
        }
        set({ status: 'idle', stream: '', result: null, message: '对话已清除', usage: null, history: [] })
      }

      const setHistory = (history) => {
        set({ history: Array.isArray(history) ? history : [] })
      }

      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        start,
        clear,
        setMessage,
        setHistory,
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
          { style: VIEWER_PANEL_HEAD, className: 'dshComfyViewer-bar' },
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
      const embedded = Boolean(props.embedded)
      const light = props.theme === 'light'
      const skin = light
        ? {
            root: {
              background: '#f6f7f9',
              color: '#1f2937',
              borderRadius: 12,
            },
            bar: {
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              color: '#1f2937',
              backdropFilter: 'none',
              WebkitBackdropFilter: 'none',
              boxShadow: '0 6px 20px rgba(15, 23, 42, 0.12)',
            },
            factLabel: { color: '#6b7280' },
            factValue: { color: '#111827' },
            nav: {
              background: 'rgba(255, 255, 255, 0.45)',
              color: '#1f2937',
              border: '1px solid rgba(255, 255, 255, 0.55)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              boxShadow: '0 4px 14px rgba(15, 23, 42, 0.10)',
            },
            thumb: { borderWidth: 1, borderStyle: 'solid', borderColor: '#e5e7eb' },
          }
        : null
      const images = props.images && props.images.length ? props.images : [{ url: props.src, filename: props.filename }]
      const [index, setIndex] = useState(props.startIndex || 0)
      const [scale, setScale] = useState(1)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const [dragging, setDragging] = useState(false)
      const [showInfo, setShowInfo] = useState(true)
      const [promptOpen, setPromptOpen] = useState(false)
      // Kept mounted through its exit animation, like the viewer itself.
      const [promptClosing, setPromptClosing] = useState(false)
      const promptTimer = useRef(null)
      // Parameters read from the file on demand, keyed by filename.
      const [promptMetaCache, setPromptMetaCache] = useState({})
      const [promptBusy, setPromptBusy] = useState(false)
      const [promptError, setPromptError] = useState('')
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
        // An embedded viewer has nothing to close: fading its stage out left an
        // empty pane that no thumbnail could bring back, because the panel, not
        // the viewer, owns what is shown. Escape resets the zoom instead.
        if (embedded) {
          const view = viewRef.current
          if (view.scale !== 1 || view.offset.x !== 0 || view.offset.y !== 0) resetView()
          return
        }
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
      // The viewer is often handed bare {url, filename} (the text2img panel), so
      // the prompt dialog reads the parameters embedded in the file when the
      // caller did not already hand them over.
      const currentPromptMeta = meta.positive || meta.negative
        ? meta
        : (current.filename && promptMetaCache[current.filename]) || {}
      const openPrompts = () => {
        setPromptClosing(false)
        setPromptOpen(true)
        setPromptError('')
        if (meta.positive || meta.negative) return
        const filename = current.filename || ''
        if (!filename || promptMetaCache[filename]) return
        setPromptBusy(true)
        const endpoint = current.path
          ? '/plugin/comfy-status/output-meta?path=' + encodeURIComponent(current.path)
          : '/plugin/comfy-status/output-meta?filename=' + encodeURIComponent(filename)
        fetch(endpoint, { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!data || !data.ok) throw new Error((data && data.error) || '读取失败')
            setPromptMetaCache((prev) => Object.assign({}, prev, { [filename]: data.meta || {} }))
          })
          .catch((error) => setPromptError(String((error && error.message) || error)))
          .finally(() => setPromptBusy(false))
      }
      const hasPanel = Boolean(
        meta.positive || meta.negative || (meta.models && meta.models.length) || meta.sampler,
      )
      // Exit runs before unmounting, so the dialog fades out instead of vanishing.
      const closePrompts = () => {
        if (promptClosing) return
        setPromptClosing(true)
        if (promptTimer.current) clearTimeout(promptTimer.current)
        promptTimer.current = setTimeout(() => {
          setPromptClosing(false)
          setPromptOpen(false)
        }, 130)
      }
      useEffect(() => () => {
        if (promptTimer.current) clearTimeout(promptTimer.current)
      }, [])
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
        // Re-attach per image: the animated stage is keyed on the picture, so a
        // page switch replaces the node and the old listener goes with it.
      }, [current.url])

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

      const viewer = h(
        'div',
        {
          style: embedded
            ? Object.assign(
                {
                  position: 'relative',
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  alignItems: 'stretch',
                  justifyContent: 'center',
                  overflow: 'hidden',
                },
                skin && skin.root,
              )
            : Object.assign({}, VIEWER_BACKDROP, { animation: fadeAnimation }),
          onClick: embedded ? undefined : requestClose,
          role: 'presentation',
        },
        // The viewer is portaled to <body> and can be opened from surfaces that do
        // not render the album tab (e.g. the online workstation), so it brings its
        // own copy of the album styles (safe to duplicate).
        h(AlbumStyles),
        h(
          'div',
          { style: VIEWER_MAIN },
          images.length > 1
            ? h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, VIEWER_NAV, skin && skin.nav, { left: 16 }),
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
                  style: Object.assign({}, VIEWER_NAV, skin && skin.nav, { right: 16 }),
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
            // Keyed on the picture: the entrance animation is a CSS one-shot, and
            // without a remount only some paging paths appeared to animate. Tying
            // the key to the image makes every switch — arrow key, nav button,
            // thumbnail — run the same one.
            {
              key: current.url,
              style: Object.assign({}, VIEWER_ANIM, { animation: stageAnimation }),
            },
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
            { style: Object.assign({}, VIEWER_BAR, skin && skin.bar), onClick: (event) => event.stopPropagation() },
            h(
              'div',
              { style: VIEWER_BAR_GROUP, className: 'dshComfyViewer-bar' },
              resolution
                ? h(
                    'span',
                    { style: VIEWER_FACT },
                    h('span', { style: Object.assign({}, VIEWER_FACT_LABEL, skin && skin.factLabel) }, '分辨率'),
                    h('span', { style: Object.assign({}, VIEWER_FACT_VALUE, skin && skin.factValue) }, resolution),
                  )
                : null,
              timeText
                ? h(
                    'span',
                    { style: VIEWER_FACT },
                    h('span', { style: Object.assign({}, VIEWER_FACT_LABEL, skin && skin.factLabel) }, '生成'),
                    h('span', { style: Object.assign({}, VIEWER_FACT_VALUE, skin && skin.factValue) }, timeText),
                  )
                : null,
              durationText !== '—'
                ? h(
                    'span',
                    { style: VIEWER_FACT },
                    h('span', { style: Object.assign({}, VIEWER_FACT_LABEL, skin && skin.factLabel) }, '耗时'),
                    h('span', { style: Object.assign({}, VIEWER_FACT_VALUE, skin && skin.factValue) }, durationText),
                  )
                : null,
              h(
                'span',
                { style: VIEWER_FACT },
                h('span', { style: Object.assign({}, VIEWER_FACT_LABEL, skin && skin.factLabel) }, '缩放'),
                h('span', { style: Object.assign({}, VIEWER_FACT_VALUE, skin && skin.factValue) }, scale.toFixed(1) + '×'),
              ),
              images.length > 1
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 10,
                        color: light ? '#6b7280' : 'rgba(255, 255, 255, 0.5)',
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
                        skin && skin.thumb,
                        entry.at === index
                          ? { opacity: 1, borderColor: light ? '#3b82f6' : 'rgba(255, 255, 255, 0.9)' }
                          : null,
                      ),
                    }),
                  ),
                )
              : null,
            h(
              'div',
              { style: VIEWER_BAR_GROUP, className: 'dshComfyViewer-bar' },
              h('button', { className: 'dshComfyAlbum-btn', 'data-dark': light ? undefined : 'true', onClick: resetView }, '还原'),
              props.promptButton
                ? h(
                    'button',
                    {
                      className: 'dshComfyAlbum-btn',
                      'data-dark': light ? undefined : 'true',
                      title: '查看这张图的正向 / 负向提示词',
                      onClick: openPrompts,
                    },
                    '提示词',
                  )
                : null,
              h(
                'a',
                {
                  className: 'dshComfyAlbum-btn dshComfyViewer-icon',
                  'data-dark': light ? undefined : 'true',
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
                      'data-dark': light ? undefined : 'true',
                      onClick: () => setShowInfo(!showInfo),
                      title: showInfo ? '收起信息栏（i）' : '展开信息栏（i）',
                      'aria-label': showInfo ? '收起信息栏' : '展开信息栏',
                    },
                    h(ViewerGlyph, { kind: 'info' }),
                  )
                : null,
              embedded
                ? null
                : h(
                    'button',
                    {
                      className: 'dshComfyAlbum-btn dshComfyViewer-icon',
                      'data-dark': light ? undefined : 'true',
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
        promptOpen || promptClosing
          ? h(
              'div',
              {
                style: {
                  position: 'fixed',
                  inset: 0,
                  zIndex: 1300,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0, 0, 0, 0.55)',
                  backdropFilter: 'blur(2px)',
                  animation: promptClosing
                    ? 'dshComfyOverlayOut 120ms ease-out both'
                    : 'dshComfyOverlayIn 160ms ease-out both',
                },
                onClick: (event) => {
                  if (event.target === event.currentTarget) closePrompts()
                },
              },
              h(
                'div',
                {
                  style: {
                    width: 620,
                    maxWidth: 'calc(100vw - 40px)',
                    maxHeight: '78vh',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 14,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-base)',
                    color: 'var(--dsw-alias-label-primary)',
                    boxShadow: '0 24px 70px rgba(0, 0, 0, 0.42)',
                    overflow: 'hidden',
                    animation: promptClosing
                      ? 'dshComfyPanelOut 120ms ease-out both'
                      : 'dshComfyPanelIn 180ms cubic-bezier(.23, 1, .32, 1) both',
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--dsw-alias-border-l2)',
                    },
                  },
                  h('span', { style: { fontSize: 12.5, fontWeight: 600 } }, '提示词'),
                  h(
                    'span',
                    {
                      style: {
                        minWidth: 0,
                        fontSize: 10,
                        color: 'var(--dsw-alias-label-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    current.filename || '',
                  ),
                  h('span', { style: { flex: 1 } }),
                  h(
                    'button',
                    { className: 'dshComfyAlbum-btn', onClick: closePrompts },
                    '关闭',
                  ),
                ),
                h(
                  'div',
                  { style: { padding: '2px 14px 16px', overflowY: 'auto', minHeight: 0 } },
                  promptBusy
                    ? h(
                        'div',
                        { style: { marginTop: 12, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                        '读取图片参数中…',
                      )
                    : null,
                  promptError
                    ? h(
                        'div',
                        { style: { marginTop: 12, fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' } },
                        promptError,
                      )
                    : null,
                  !promptBusy && !promptError && !currentPromptMeta.positive && !currentPromptMeta.negative
                    ? h(
                        'div',
                        { style: { marginTop: 12, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                        '这张图里没有记录提示词',
                      )
                    : null,
                  h(PromptBlock, { title: '正向提示词', value: currentPromptMeta.positive }),
                  h(PromptBlock, { title: '负向提示词', value: currentPromptMeta.negative }),
                ),
              ),
            )
          : null,
      )
      if (embedded) return viewer
      return createPortal && typeof document !== 'undefined'
        ? createPortal(viewer, document.body)
        : viewer
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
      const [albumDir, setAlbumDir] = usePref('albumDir')
      const [source, setSource] = useState('album')
      const [layout, setLayout] = useState('default')
      const [dirFiles, setDirFiles] = useState(null)
      const [dirPath, setDirPath] = useState('')
      const [dirBusy, setDirBusy] = useState(false)
      const [dirError, setDirError] = useState('')
      const [dirNonce, setDirNonce] = useState(0)
      const [dirPick, setDirPick] = useState(0)
      const [dirViewer, setDirViewer] = useState(false)
      const [dirMetas, setDirMetas] = useState({})
      const [dirPickerOpen, setDirPickerOpen] = useState(false)
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
      // Directory source items, shaped like album items so the same UI renders them.
      const dirItems = (dirFiles || []).map((file) => ({
        id: 'dir:' + file.name,
        images: [
          {
            url: file.url,
            filename: file.name,
            thumb: file.thumb || file.url,
            path: file.path,
            meta: dirMetas[file.name] || {},
          },
        ],
        startedAt: file.mtime,
        completed: true,
        meta: dirMetas[file.name] || {},
      }))
      const shownItems = source === 'dir' ? dirItems : visible
      const shownGroups = source === 'dir' ? groupByDay(dirItems) : groups
      /** List rows use the preview; only the viewer loads the original file. */
      const thumbOfUrl = (image) =>
        image && image.thumb
          ? image.thumb
          : image && typeof image.url === 'string' && image.url.indexOf('/view?') >= 0
            ? image.url + '&preview=webp'
            : image
              ? image.url
              : ''
      const selected = shownItems.find((item) => item.id === picked) || shownItems[0] || null
      // One flat strip of every image, newest first: feeds viewer paging and the
      // recent thumbnails at its bottom. Each entry carries its owning job so the
      // viewer can show the prompt without a second lookup.
      const galleryImages = []
      for (const item of shownItems) {
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

      // Directory source: lists ComfyUI's output folder (or a custom gallery)
      // with ComfyUI's webp thumbnails so the list stays cheap.
      useEffect(() => {
        if (source !== 'dir') return undefined
        let alive = true
        setDirBusy(true)
        setDirError('')
        fetch('/plugin/comfy-status/outputs?dir=' + encodeURIComponent(albumDir || ''), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive) return
            if (!data || !data.ok) throw new Error((data && data.error) || '读取失败')
            setDirFiles(Array.isArray(data.files) ? data.files : [])
            setDirPath(data.dir || '')
            setDirMetas({})
          })
          .catch((err) => {
            if (!alive) return
            setDirFiles([])
            setDirError(String((err && err.message) || err))
          })
          .finally(() => {
            if (alive) setDirBusy(false)
          })
        return () => {
          alive = false
        }
      }, [source, albumDir, dirNonce])

      // Directory pictures embed their parameters in the PNG; read them on demand
      // so the details panel matches what the album shows.
      useEffect(() => {
        if (source !== 'dir') return undefined
        const image = selected && selected.images ? selected.images[0] : null
        if (!image || !image.filename || dirMetas[image.filename]) return undefined
        let alive = true
        const endpoint = image.path
          ? '/plugin/comfy-status/output-meta?path=' + encodeURIComponent(image.path)
          : '/plugin/comfy-status/output-meta?filename=' + encodeURIComponent(image.filename)
        fetch(endpoint, { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive || !data || !data.ok) return
            setDirMetas((prev) => ({ ...prev, [image.filename]: data.meta || {} }))
          })
          .catch(() => {
            // No embedded parameters: the details stay empty.
          })
        return () => {
          alive = false
        }
      }, [source, selected, dirMetas])

      const pickAlbumDir = () => {
        setDirPickerOpen(true)
      }

      const openDirImage = (index) => {
        setDirPick(index)
        setDirViewer(true)
        const item = shownItems[index]
        const image = item && item.images ? item.images[0] : null
        if (!image || !image.filename || !image.path || dirMetas[image.filename]) return
        fetch('/plugin/comfy-status/output-meta?path=' + encodeURIComponent(image.path), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (data && data.ok) setDirMetas((prev) => ({ ...prev, [image.filename]: data.meta || {} }))
          })
          .catch(() => {})
      }

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
            h('img', { src: thumbOfUrl(image), loading: 'lazy', decoding: 'async', alt: image.filename, style: ALBUM_IMG }),
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
        ...shownGroups.map((group, index) =>
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

      // Flat layout: one dense grid of every image, thumbnails only until opened.
      const flatGrid = h(
        'div',
        {
          key: 'flat-' + source,
          className: 'dshComfyAlbum-swap',
          style: Object.assign({}, FLAT_GRID, { flex: 1, minHeight: 0, overflowY: 'auto' }),
        },
        ...shownItems.map((item, index) =>
          h(
            'button',
            {
              key: item.id,
              className: 'dshComfyAlbum-thumb',
              title: item.images[0].filename,
              style: {
                width: '100%',
                height: 120,
                padding: 0,
                border: 0,
                borderRadius: 8,
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'var(--dsw-alias-bg-layer-1)',
              },
              onClick: () => openDirImage(index),
            },
            h('img', {
              src: thumbOfUrl(item.images[0]),
              loading: 'lazy',
              decoding: 'async',
              alt: item.images[0].filename,
              style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
            }),
          ),
        ),
      )

      const detailPane = h(
        'div',
        {
          style: Object.assign({}, wide ? DETAIL_PANE : ALBUM_DETAIL, { position: 'relative' }),
        },
        source === 'album' && running.length > 0
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
      )

      const defaultView = h(
        'div',
        { key: 'default-' + source, className: 'dshComfyAlbum-swap', style: wide ? CONTENT_ROW : CONTENT_COLUMN },
        gallery,
        detailPane,
      )

      let content
      if (source === 'dir') {
        content = dirBusy
          ? h('div', { style: ALBUM_EMPTY }, '加载中…')
          : dirError
            ? h('div', { style: ALBUM_EMPTY }, dirError)
            : dirItems.length === 0
              ? h('div', { style: ALBUM_EMPTY }, '这个目录里没有图片')
              : layout === 'flat'
                ? flatGrid
                : defaultView
      } else if (error) content = h('div', { style: ALBUM_EMPTY }, '无法连接插件后端：' + error)
      else if (!album) content = h('div', { style: ALBUM_EMPTY }, '正在加载…')
      else if (album.up === false)
        content = h(
          'div',
          { style: ALBUM_EMPTY },
          'ComfyUI 未连接',
          h(LaunchComfyButton, { marginTop: 8 }),
        )
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
      else content = layout === 'flat' ? flatGrid : defaultView

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
          { style: ALBUM_HEAD, className: 'dshComfyAlbum-head' },
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
              style:
                source === 'album'
                  ? { background: 'var(--dsw-alias-brand-primary)', color: '#ffffff', borderColor: 'var(--dsw-alias-brand-primary)' }
                  : null,
              onClick: () => setSource('album'),
            },
            '相册',
          ),
          h(
            'button',
            {
              className: 'dshComfyAlbum-btn',
              style:
                source === 'dir'
                  ? { background: 'var(--dsw-alias-brand-primary)', color: '#ffffff', borderColor: 'var(--dsw-alias-brand-primary)' }
                  : null,
              onClick: () => setSource('dir'),
            },
            '目录',
          ),
          h(
            'button',
            {
              className: 'dshComfyAlbum-btn',
              title: layout === 'flat' ? '切换为默认分组视图' : '切换为平铺视图',
              onClick: () => setLayout(layout === 'flat' ? 'default' : 'flat'),
            },
            layout === 'flat' ? '分组' : '平铺',
          ),
          source === 'dir' ? h('button', { className: 'dshComfyAlbum-btn', onClick: pickAlbumDir }, '选择目录') : null,
          h(
            'button',
            {
              className: 'dshComfyAlbum-btn',
              onClick: source === 'dir' ? () => setDirNonce((value) => value + 1) : reload,
            },
            '刷新',
          ),
          // Theme switch sits last, matching the canvas tab's header.
          h(
            'button',
            {
              className: 'dshComfyAlbum-btn',
              'data-square': 'true',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
              title: nightTheme ? '切换到日间' : '切换到夜间',
              'aria-label': nightTheme ? '切换到日间' : '切换到夜间',
              onClick: () => setAlbumTheme(nightTheme ? 'light' : 'dark'),
            },
            h(ThemeIcon, { night: nightTheme }),
          ),
        ),
        source === 'dir' && dirPath
          ? h(
              'div',
              {
                title: dirPath,
                style: {
                  flex: 'none',
                  padding: '0 10px 6px',
                  fontSize: 9.5,
                  color: 'var(--dsw-alias-label-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              dirPath,
            )
          : null,
        content,
        h(DirectoryPicker, {
          open: dirPickerOpen,
          title: '选择相册目录',
          startPath: albumDir || '',
          onPick: (path) => {
            setAlbumDir(path)
            setDirPickerOpen(false)
          },
          onClose: () => setDirPickerOpen(false),
        }),
        dirViewer && shownItems.length > 0
          ? h(ImageViewer, {
              images: shownItems.map((item) => ({
                url: item.images[0].url,
                filename: item.images[0].filename,
                meta: item.meta,
              })),
              startIndex: Math.max(0, Math.min(dirPick, shownItems.length - 1)),
              filename: shownItems[dirPick] ? shownItems[dirPick].images[0].filename : '',
              onClose: () => setDirViewer(false),
            })
          : null,
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
      const [comfyPath, setComfyPath] = usePref('comfyPath')
      const [templatesMsg, setTemplatesMsg] = useState('')

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
          title: 'Image 工作台',
          description: '在左侧边栏「自动化任务」下的入口：进入后可选「本地 ComfyUI 工作流」或「在线 API 出图」。',
          checked: workspaceOn,
          onChange: setWorkspaceOn,
        }),
        h(
          'div',
          { style: { padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
          h('div', { style: { fontSize: 12, fontWeight: 500 } }, 'ComfyUI 安装路径'),
          h(
            'div',
            {
              style: {
                fontSize: 11,
                color: 'var(--dsw-alias-label-secondary)',
                margin: '2px 0 6px',
                lineHeight: 1.5,
              },
            },
            '用于「启动 ComfyUI」：填绘世安装根目录，或含 main.py 的目录；留空则尝试常见位置。',
          ),
          h('input', {
            value: comfyPath,
            placeholder: '例：D:\\ComfyUI-aki\\ComfyUI',
            style: {
              width: '100%',
              boxSizing: 'border-box',
              padding: '5px 8px',
              borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 11,
              fontFamily: 'inherit',
              outline: 'none',
            },
            onChange: (event) => setComfyPath(event.target.value),
          }),
          // Settings page only: one button, two states (other call sites keep the
          // old pair for now).
          h(LaunchComfyButton, { marginTop: 8, toggle: true }),
          h(
            'div',
            { style: { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' } },
            h('div', { style: { fontSize: 11.5, fontWeight: 500 } }, '内置画板工作流'),
            h(
              'div',
              {
                style: {
                  fontSize: 10.5,
                  color: 'var(--dsw-alias-label-secondary)',
                  margin: '3px 0 6px',
                  lineHeight: 1.5,
                },
              },
              '把 moss-base-canvas / moss-sft-canvas 重新写入 ComfyUI 工作流目录（旧文件备份为 .bak）。',
            ),
            h(
              'button',
              {
                type: 'button',
                style: {
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 10.5,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
                onClick: async () => {
                  setTemplatesMsg('')
                  try {
                    const res = await fetch('/plugin/comfy-canvas/reset-templates', { method: 'POST' })
                    const data = await res.json().catch(() => null)
                    setTemplatesMsg(data && data.ok ? '已重新安装' : (data && data.error) || '失败')
                  } catch (error) {
                    setTemplatesMsg(String((error && error.message) || error))
                  }
                },
              },
              '重置内置画板工作流',
            ),
            templatesMsg
              ? h(
                  'span',
                  { style: { marginLeft: 8, fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                  templatesMsg,
                )
              : null,
          ),
        ),
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
                step: 0.1,
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
    // Compact variant for rows that also hold buttons: same 25.75px height, less
    // inset, so it can sit beside them without pushing the row taller.
    const SEGMENT_WRAP_SM = Object.assign({}, SEGMENT_WRAP, { padding: 2, borderRadius: 7 })
    const SEGMENT_SM = Object.assign({}, SEGMENT, {
      padding: '3px 8px',
      fontSize: 11,
      lineHeight: 1.25,
      borderRadius: 5,
      // The niche labels here are Chinese and short: wrapping them would grow the
      // row taller than the buttons beside it.
      whiteSpace: 'nowrap',
    })

    /** Segmented control whose blue thumb slides between the options. */
    function SegmentToggle(props) {
      const options = props.options || []
      const compact = Boolean(props.compact)
      const wrap = compact ? SEGMENT_WRAP_SM : SEGMENT_WRAP
      const seg = compact ? SEGMENT_SM : SEGMENT
      const inset = compact ? 2 : 3
      const found = options.findIndex((option) => option.value === props.value)
      const index = found >= 0 ? found : 0
      const width = 'calc((100% - ' + inset * 2 + 'px) / ' + Math.max(1, options.length) + ')'
      return h(
        'div',
        { style: Object.assign({}, wrap, { position: 'relative' }, props.style || null) },
        h('div', {
          style: {
            position: 'absolute',
            top: inset,
            bottom: inset,
            left: inset,
            width,
            borderRadius: compact ? 5 : 6,
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
              style: Object.assign({}, seg, {
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
      ensureBaseStyle()
      return h(
        'style',
        null,
        [
          '.dshCanvasBtn{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.5;padding:4px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}',
          '.dshCanvasBtn{transition:transform 160ms cubic-bezier(0.23,1,0.32,1)}',
          // Same-row heights: children that size themselves from their content
          // (icon buttons, dropdown triggers, the back arrow) stretch to the row's
          // tallest item instead of sitting a few pixels short of it. Text spans
          // are left alone so their baselines keep sitting where they were.
          '.dshComfyCanvasHead>button,.dshComfyCanvasHead>a,.dshComfyCanvasHead>div,.dshComfyCanvasHead>input,.dshComfyWorkbenchBar>button,.dshComfyWorkbenchBar>a,.dshComfyWorkbenchBar>div,.dshComfyWorkbenchBar>input{align-self:stretch}',
          // Dropdown triggers live inside the dropdown's own positioning wrapper, so
          // they cannot stretch with the row on their own. 25.75px is what a
          // .dshCanvasBtn measures (10.5 × 1.5 + 4/4 padding + 1/1 border).
          '.dshComfyCanvasHead .dshCanvasPicker,.dshComfyWorkbenchBar .dshCanvasPicker{height:25.75px;box-sizing:border-box}',
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
          '.dshCanvasOption[data-on="true"]{background:#3b82f6;color:#ffffff}',
          '.dshCanvasBoxItem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
          '.dshCanvasBoxItem{appearance:none;display:flex;align-items:center;gap:5px;width:100%;box-sizing:border-box;font:inherit;font-size:10px;padding:3px 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;outline:none}',
          '.dshCanvasBoxItem:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dshCanvasBoxItem:focus{outline:none}',
          '.dshCanvasBoxItem[data-on="true"]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
          '@keyframes dshComfyOverlayIn{from{opacity:0}to{opacity:1}}',
          '@keyframes dshComfyOverlayOut{from{opacity:1}to{opacity:0}}',
          '@keyframes dshComfyPanelIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}',
          '@keyframes dshComfyPanelOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.98)}}',
          '@keyframes dshComfySpin{to{transform:rotate(360deg)}}',
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
          // Surface cross-fade rules live in ensureBaseStyle() (zero-specificity
          // :where form) so they cannot outrank component transitions.
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
    /** The standalone workspace keeps its own copies so the two surfaces never mix. */
    const WORKSPACE_DRAFT_PREFIX = 'dsh.comfy-canvas.workspace-draft.'

    /** One draft per workflow file, so switching files never mixes two edits. */
    function draftKeyOf(file, prefix) {
      return (prefix || DRAFT_PREFIX) + encodeURIComponent(String(file || ''))
    }

    function readDraft(file, prefix) {
      if (!file) return null
      try {
        const raw = localStorage.getItem(draftKeyOf(file, prefix))
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && Array.isArray(parsed.boxes) ? parsed : null
      } catch {
        return null
      }
    }

    function writeDraft(file, value, prefix) {
      if (!file) return
      try {
        localStorage.setItem(draftKeyOf(file, prefix), JSON.stringify(value))
      } catch {
        // Storage unavailable or full: editing still works in memory.
      }
    }

    function clearDraft(file, prefix) {
      if (!file) return
      try {
        localStorage.removeItem(draftKeyOf(file, prefix))
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
    /** Axis-aligned bounds of a box that may carry a rotation (degrees). */
    function aabbOf(box) {
      const rotation = Number(box.rotation) || 0
      if (rotation % 360 === 0) return { x: box.x, y: box.y, width: box.width, height: box.height }
      const rad = (rotation * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const width = box.width * cos + box.height * sin
      const height = box.width * sin + box.height * cos
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      return { x: cx - width / 2, y: cy - height / 2, width, height }
    }

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
        // A rotated box is sent as its axis-aligned bounds: MOSS bboxes carry no
        // rotation field.
        const bounds = aabbOf(box)
        // Mirrors nodes_moss_image.py: floor the near edge, ceil the far edge.
        item.bbox = [
          Math.floor((bounds.y / height) * 1000 * (height / 1000)) - halfH,
          Math.floor((bounds.x / width) * 1000 * (width / 1000)) - halfW,
          Math.ceil(((bounds.y + bounds.height) / height) * 1000 * (height / 1000)) - halfH,
          Math.ceil(((bounds.x + bounds.width) / width) * 1000 * (width / 1000)) - halfW,
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
      const [rotating, setRotating] = useState(null)

      /** Start rotating the box around its own centre. */
      const onRotateStart = (event, index, box) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null
        if (!rect || rect.width === 0) return
        const scale = rect.width / Math.max(1, props.width)
        const centerX = box.x + box.width / 2
        const centerY = box.y + box.height / 2
        const cx = rect.left + centerX * scale
        const cy = rect.top + centerY * scale
        setRotating({
          index,
          centerX,
          centerY,
          startAngle: (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI,
          startRotation: Number(box.rotation) || 0,
        })
      }

      useEffect(() => {
        if (!rotating) return undefined
        const onMove = (event) => {
          const rect = boardRef.current ? boardRef.current.getBoundingClientRect() : null
          if (!rect || rect.width === 0) return
          const scale = rect.width / Math.max(1, props.width)
          const cx = rect.left + rotating.centerX * scale
          const cy = rect.top + rotating.centerY * scale
          const angle = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
          props.onChange(rotating.index, {
            rotation: Math.round(rotating.startRotation + (angle - rotating.startAngle)),
          })
        }
        const onUp = () => setRotating(null)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }, [rotating, props])

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
                {
                  zIndex: props.selected === index ? 20 : 1,
                  transform: box.rotation ? 'rotate(' + box.rotation + 'deg)' : undefined,
                  transformOrigin: '50% 50%',
                  // While zooming, boxes (and their labels) fade so the reference
                  // underneath can be inspected.
                  opacity: props.hideBoxes ? 0 : props.dimBoxes ? 0.35 : 1,
                  pointerEvents: props.hideBoxes ? 'none' : undefined,
                  transition: 'opacity .15s ease',
                },
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
            props.rotatable && props.selected === index && props.editing !== index
              ? h('div', {
                  style: {
                    position: 'absolute',
                    left: '50%',
                    top: -17,
                    width: 10,
                    height: 10,
                    marginLeft: -5,
                    borderRadius: '50%',
                    background: '#3b82f6',
                    border: '2px solid #ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
                    cursor: 'grab',
                    zIndex: 7,
                  },
                  title: '拖动旋转',
                  onPointerDown: (event) => onRotateStart(event, index, box),
                })
              : null,
            props.showDimensions && drag && drag.index === index
              ? h(
                  'div',
                  {
                    style: {
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      padding: '2px 6px',
                      borderRadius: 5,
                      fontSize: 9.5,
                      fontVariantNumeric: 'tabular-nums',
                      color: '#ffffff',
                      background: 'rgba(0, 0, 0, 0.72)',
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      zIndex: 8,
                    },
                  },
                  Math.round(box.width) + ' × ' + Math.round(box.height),
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
      const [coords, setCoords] = useState(null)
      const [reducedMotion] = useState(
        () =>
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
      const boxRef = useRef(null)
      const menuRef = useRef(null)
      const triggerRef = useRef(null)
      const [query, setQuery] = useState('')

      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (boxRef.current && boxRef.current.contains(event.target)) return
          if (menuRef.current && menuRef.current.contains(event.target)) return
          setOpen(false)
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

      // The menu is portaled to <body> and positioned in viewport coordinates, so
      // narrow side columns never clip it and it can never widen a flex row.
      useEffect(() => {
        if (!open) {
          setCoords(null)
          return undefined
        }
        const update = () => {
          const node = triggerRef.current
          if (!node) return
          const rect = node.getBoundingClientRect()
          const width = Math.max(rect.width, props.menuMinWidth || 0)
          const alignRight = props.menuAlign === 'right'
          let left = alignRight ? rect.right - width : rect.left
          const maxLeft = Math.max(8, (window.innerWidth || 1280) - width - 8)
          left = Math.max(8, Math.min(left, maxLeft))
          setCoords({ left, top: rect.bottom + 4, width })
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [open, props.menuAlign, props.menuMinWidth])

      const groups = Array.isArray(props.groups) ? props.groups : null
      const choices = groups ? groups.flatMap((group) => group.options || []) : props.options || []
      const normalized = query.trim().toLowerCase()
      const filtered = normalized
        ? choices.filter((option) => String(option.label).toLowerCase().indexOf(normalized) >= 0)
        : choices
      const current = choices.find((option) => option.value === props.value)
      const optionRow = (option) =>
        h(
          'button',
          {
            key: option.value,
            type: 'button',
            className: 'dshCanvasOption',
            'data-on': option.value === props.value ? 'true' : 'false',
            'data-dark': dark ? 'true' : undefined,
            title: option.title || option.label,
            // The flex column would otherwise shrink every row and
            // squeeze the labels together.
            style: { flex: 'none' },
            onClick: () => {
              props.onPick(option.value)
              setOpen(false)
            },
          },
          option.label,
        )
      // Grouped menus keep provider sections readable while searching; a group
      // whose options were all filtered out loses its header too.
      const rows = groups
        ? groups.flatMap((group) => {
            const items = (group.options || []).filter((option) => filtered.indexOf(option) >= 0)
            if (items.length === 0) return []
            return [
              group.label
                ? h(
                    'div',
                    {
                      key: 'group:' + group.label,
                      style: {
                        flex: 'none',
                        padding: '6px 8px 3px',
                        fontSize: 9.5,
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                        color: 'var(--dsw-alias-label-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      },
                    },
                    group.label,
                  )
                : null,
              ...items.map(optionRow),
            ].filter(Boolean)
          })
        : filtered.map(optionRow)
      const menuSkin = dark
        ? {
            border: '1px solid rgba(255, 255, 255, 0.14)',
            background: 'rgba(30, 30, 34, 0.98)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
          }
        : null

      const menu =
        open && coords
          ? h(
              'div',
              {
                ref: menuRef,
                style: Object.assign({}, DROPDOWN, menuSkin, {
                  position: 'fixed',
                  top: coords.top,
                  left: coords.left,
                  width: coords.width,
                  minWidth: coords.width,
                  right: 'auto',
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
                ...rows,
              ),
            )
          : null

      return h(
        'div',
        { ref: boxRef, style: { position: 'relative', flex: '1 1 0', minWidth: 96 } },
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            className: 'dshCanvasPicker',
            'data-dark': dark ? 'true' : undefined,
            title: props.title,
            // A flex row with an empty label collapses to its padding; keep the
            // trigger at a usable height even before a value is picked.
            style: Object.assign({ minHeight: 22 }, props.triggerStyle || null),
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
            { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            current ? current.label : props.placeholder || '',
          ),
          // A bare text button reads as a label, not a chooser; the mark is what
          // says "this opens a list" when a neighbouring field has an arrow.
          props.chevron
            ? h(
                'span',
                { style: { flex: 'none', marginLeft: 6, fontSize: 9, lineHeight: 1, opacity: 0.55 } },
                '▾',
              )
            : null,
        ),
        menu && createPortal ? createPortal(menu, document.body) : menu,
      )
    }

    /**
     * Model picker over every provider DSH can route to. The value is the pair
     * "provider\0model": the same model id can be advertised by several
     * providers, so a bare id cannot name one route.
     */
    function LlmModelPicker(props) {
      const { catalog, error } = useLlmCatalog()
      useEffect(() => {
        llmCatalogStore.ensure()
      }, [])
      const value = props.model ? routeKey(props.provider, props.model) : ''
      const groups = []
      const known = new Set()
      const extra = [{ value: '', label: '跟随默认', title: '跟随 DSH 当前选中的模型' }]
      for (const group of catalog ? catalog.groups : []) {
        const options = group.models.map((model) => {
          const key = routeKey(group.id, model.id)
          known.add(key)
          return {
            value: key,
            label: model.badge ? model.name + ' · ' + model.badge : model.name,
            title: (group.name || group.id) + ' / ' + model.id + (model.description ? '\n' + model.description : ''),
          }
        })
        if (options.length > 0) groups.push({ label: group.name || group.id, options })
      }
      // A stored id the catalog does not advertise stays selectable: routing
      // accepts unlisted models, so the picker must not drop the stored choice.
      if (props.model && !known.has(value)) {
        extra.push({ value, label: props.model, title: '当前值（不在模型目录里）' })
      }
      groups.unshift({ label: '', options: extra })
      return h(
        'div',
        { style: { minWidth: 0 } },
        h(Dropdown, {
          title: props.title || '润色模型（跟随默认时用 DSH 当前选中的模型）',
          placeholder: error ? '模型：读取失败' : '跟随默认',
          value,
          groups,
          menuMinWidth: props.menuMinWidth || 260,
          dark: Boolean(props.dark),
          chevron: Boolean(props.chevron),
          triggerStyle: props.triggerStyle,
          onOpen: () => llmCatalogStore.load(true),
          onPick: props.onPick,
        }),
        error
          ? h(
              'div',
              {
                style: {
                  marginTop: 2,
                  fontSize: 9.5,
                  lineHeight: 1.4,
                  color: 'var(--dsw-alias-state-error-primary)',
                  wordBreak: 'break-word',
                },
              },
              error,
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
     * Keeps one card's render failure inside that card. Without a boundary React
     * unmounts up to the shell, so a single broken panel reads as "the plugin
     * took the UI down" instead of "this card is broken".
     */
    class SlotBoundary extends React.Component {
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
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '10px 12px',
                margin: 6,
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 11,
                lineHeight: 1.5,
              },
            },
            h('span', { style: { fontWeight: 600 } }, String(this.props.label || 'ComfyUI') + ' 渲染失败'),
            h(
              'span',
              { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' } },
              String((this.state.error && this.state.error.message) || this.state.error),
            ),
            h(
              'button',
              {
                type: 'button',
                style: {
                  alignSelf: 'flex-start',
                  flex: 'none',
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 10.5,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
                onClick: () => this.setState({ error: null }),
              },
              '重试',
            ),
          )
        }
        return this.props.children
      }
    }

    /** Slot-facing wrapper: every registered entry renders inside its own boundary. */
    function guardSlot(Component, label) {
      function Guarded(props) {
        return h(SlotBoundary, { label }, h(Component, props))
      }
      Guarded.displayName = 'Guarded(' + String(label || 'slot') + ')'
      return Guarded
    }

    /** One registration step; a throw must not cost the bundle its other cards. */
    function safe(label, fn) {
      try {
        return fn()
      } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[dsh-comfy-enhance] ' + String(label) + '注册失败：', error)
        }
        return null
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
                title: '不经过 agent，直接把当前版式提交给 ComfyUI',
                style: {
                  background: '#3b82f6',
                  borderColor: '#3b82f6',
                  color: '#ffffff',
                  fontWeight: 600,
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
                { style: ZOOM_SUMMARY },
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
                { style: { padding: '0 10px 10px' } },
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
      const [file, setFile] = usePref('canvasFile')
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
      // The zoom overlay publishes a snapshot of this component's callbacks; read
      // the live models through a ref so a freshly edited model actually applies.
      const canvasModelsRef = useRef(canvasModels)
      canvasModelsRef.current = canvasModels
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
          }
        }

        let refreshTimer = null
        const refreshSoon = () => {
          if (!alive) return
          load()
          if (refreshTimer) clearTimeout(refreshTimer)
          refreshTimer = setTimeout(() => {
            refreshTimer = null
            if (alive) load()
          }, 2500)
        }
        load()
        refreshAlbum.current = load
        const unsubscribeEvents = comfyEvents.subscribe((event) => {
          const type = event && event.type
          if (type === 'execution_success' || type === 'executed') refreshSoon()
        })
        return () => {
          alive = false
          if (refreshTimer) clearTimeout(refreshTimer)
          unsubscribeEvents()
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
            const list = data.files || []
            setFiles(list)
            if (list.length > 0) {
              const saved = pluginPrefs.get().canvasFile
              const valid = typeof saved === 'string' && list.some((item) => item.name === saved)
              setFile(valid ? saved : list[0].name)
            }
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
       * Hand the canvas to the agent as an editable draft card over the composer.
       * Nothing is sent until the user confirms the card's submit.
       */
      const sendToAgent = () => {
        if (boxes.length === 0) {
          setStatus('画布上还没有框')
          return
        }
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
        draftStore.set({
          open: true,
          sessionId: (props && props.sessionId) || '',
          title: 'MOSS 画板 · ' + file,
          text,
          mode: 'final',
          note: '',
        })
        setStatus('草稿已打开：可在输入框上方编辑后提交')
      }

      /** Direct preview: hand the current layout to ComfyUI without the agent. */
      const quickGenerate = async () => {
        const plainPrompt = String(summary || '').trim()
        if (boxes.length === 0 && !plainPrompt) {
          setStatus('画布上还没有框：可以先写整图描述做文生图')
          return
        }
        const layout = boxes.length > 0 ? buildMossLayout(summary, size.width, size.height, boxes) : null
        const stored = canvasModelsRef.current || {}
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
              plainPrompt: boxes.length === 0 ? plainPrompt : '',
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
      if (error) {
        const workflowError = /CreateBoundingBoxes|没有画板|工作流/.test(String(error))
        body = h(
          'div',
          { style: EMPTY },
          error,
          workflowError ? null : h(LaunchComfyButton, { marginTop: 8 }),
        )
      }
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
          { style: HEAD, className: 'dshComfyCanvasHead' },
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
              disabled: !hasNode,
              title: '不经过 agent，直接把当前版式提交给 ComfyUI',
              style: {
                background: '#3b82f6',
                borderColor: '#3b82f6',
                color: '#ffffff',
                fontWeight: 600,
                flexShrink: 0,
                opacity: !hasNode ? 0.45 : 1,
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
                // Height comes from align-self: stretch in the header rule. padding
                // must be cleared here: the class supplies 4px 11px, which would
                // leave a 1px content box inside a 25px button and push the icon
                // out of centre.
                width: 25,
                padding: 0,
                boxSizing: 'border-box',
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
      // Zoomed content must stay inside the stage instead of covering the page.
      overflow: 'hidden',
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
    // ------------------------------------------------------------ board snapshots

    const SNAPSHOT_KEY = 'dsh.comfy-canvas.snapshots'

    function loadSnapshotList() {
      try {
        const raw = localStorage.getItem(SNAPSHOT_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    function persistSnapshots(list) {
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list))
      } catch {
        // Storage full: the snapshot simply does not persist.
      }
    }

    /** Page-switch motion for the Image workbench views. */
    function ensureBaseStyle() {
      if (typeof document === 'undefined' || document.getElementById('dsh-comfy-workbench-styles')) return
      const style = document.createElement('style')
      style.id = 'dsh-comfy-workbench-styles'
      style.textContent =
        '@keyframes dshPageIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
        '@keyframes dshBlink{0%,100%{opacity:1}50%{opacity:.3}}' +
        // These three live on the canvas sheet, which this panel never mounts, so
        // their animations were pointing at names the document did not have: the
        // progress ring stood still and dropdowns opened without the fade.
        '@keyframes dshComfySpin{to{transform:rotate(360deg)}}' +
        '@keyframes dshComfyDropIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}' +
        '@keyframes dshComfyOverlayIn{from{opacity:0}to{opacity:1}}' +
        '@keyframes dshComfyOverlayOut{from{opacity:1}to{opacity:0}}' +
        // Ring rotation as a paint-only animation: stroke-dashoffset carries the
        // arc around the circle without promoting a composited layer, which is
        // what kept a stale copy of the ring visible behind the new one.
        '@keyframes dshComfyRingSpin{from{stroke-dashoffset:0}to{stroke-dashoffset:-53.407}}' +
        '@media (prefers-reduced-motion:reduce){.dshComfySpinnerArc{animation:none}}' +
        // The album-picker panel in this same workspace fades in with these.
        '@keyframes dshComfyPanelIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}' +
        '@keyframes dshComfyPanelOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.98)}}' +
        // Warm call-to-action button (the AI write/rewrite action). The hover
        // lift and press sink live in CSS so the states cannot desync from a
        // rerender; the glow is a shadow, so nothing is laid out twice. Hover
        // motion is gated to real pointers, and reduced motion keeps the colours
        // while dropping the movement.
        '.dshComfyAiBtn{background:linear-gradient(135deg,#ff5c7a,#ff8a3d);border-color:transparent;color:#fff;box-shadow:0 0 14px rgba(255,92,122,.28);transition:transform 160ms cubic-bezier(.23,1,.32,1),box-shadow 160ms ease,filter 160ms ease}' +
        '@media (hover:hover) and (pointer:fine){.dshComfyAiBtn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 0 22px rgba(255,92,122,.45),0 8px 22px rgba(255,92,122,.4)}}' +
        '.dshComfyAiBtn:active:not(:disabled){transform:translateY(1px) scale(.985);box-shadow:0 0 10px rgba(255,92,122,.3)}' +
        '.dshComfyAiBtn:disabled{opacity:.55;box-shadow:none;transform:none;cursor:default}' +
        '@media (prefers-reduced-motion:reduce){.dshComfyAiBtn{transition:none}.dshComfyAiBtn:hover:not(:disabled),.dshComfyAiBtn:active:not(:disabled){transform:none}}' +
        // Floating back chip over the preview: dark glass so it reads on any
        // picture, and no transform animation (a moving layer under a blurred
        // backdrop is what smeared elsewhere in this panel).
        '.dshComfyBackChip{display:inline-flex;align-items:center;gap:3px;padding:5px 11px 5px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(14,16,20,.55);color:#fff;font-size:11.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:background 160ms ease,border-color 160ms ease}' +
        '.dshComfyBackChip:hover{background:rgba(14,16,20,.72);border-color:rgba(255,255,255,.34)}' +
        // Shared hover/press feedback: lift with a colour-matched glow, sink when
        // pressed. The glow colour comes from --dshComfyGlow so one class serves
        // both the blue start button and its red stop state.
        '.dshComfyLift{box-shadow:0 4px 14px var(--dshComfyGlow,rgba(59,130,246,.35));transition:transform 160ms cubic-bezier(.23,1,.32,1),box-shadow 160ms ease,background 160ms ease,border-color 160ms ease}' +
        '@media (hover:hover) and (pointer:fine){.dshComfyLift:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 0 22px var(--dshComfyGlow,rgba(59,130,246,.45)),0 8px 22px var(--dshComfyGlow,rgba(59,130,246,.4))}}' +
        '.dshComfyLift:active:not(:disabled){transform:translateY(1px) scale(.985);box-shadow:0 0 10px var(--dshComfyGlow,rgba(59,130,246,.3))}' +
        '.dshComfyLift:disabled{transform:none;box-shadow:none}' +
        '@media (prefers-reduced-motion:reduce){.dshComfyLift{transition:none}.dshComfyLift:hover:not(:disabled),.dshComfyLift:active:not(:disabled){transform:none}}' +
        // Panel title with light running through the letters. The gradient is the
        // same warm pair as the call-to-action button; colour is a fallback for
        // engines without background-clip:text.
        '.dshComfyShimmerTitle{font-size:21px;font-weight:800;line-height:1.15;letter-spacing:.01em;color:#ff6a3d}' +
        '@supports ((-webkit-background-clip:text) or (background-clip:text)){.dshComfyShimmerTitle{background:linear-gradient(100deg,#ff4d4d,#ff8a3d 26%,#ffe3c2 42%,#ff8a3d 58%,#ff4d4d 86%);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dshComfyTitleFlow 5.5s linear infinite}}' +
        '@keyframes dshComfyTitleFlow{from{background-position:200% center}to{background-position:-120% center}}' +
        '@media (prefers-reduced-motion:reduce){.dshComfyShimmerTitle{animation:none;background-position:38% center}}' +
        // Controls every surface shares. They live here (not in the album or
        // canvas sheets) so a panel that mounts only this sheet still gets them.
        '.dshCanvasBtn{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1.5;padding:4px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}' +
        '.dshCanvasBtn{transition:transform 160ms cubic-bezier(0.23,1,0.32,1)}' +
        '.dshCanvasBtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}' +
        '.dshCanvasBtn:active:not(:disabled){transform:scale(.97) translateY(1px)}' +
        '.dshCanvasBtn:disabled{opacity:.5;cursor:default}' +
        '.dshCanvasPicker{appearance:none;display:flex;align-items:center;width:100%;box-sizing:border-box;font:inherit;font-size:10.5px;padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}' +
        '.dshCanvasPicker:hover{background:var(--dsw-alias-bg-layer-2)}' +
        '.dshCanvasOption{appearance:none;display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:10.5px;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.dshCanvasOption:hover{background:var(--dsw-alias-bg-layer-2)}' +
        '.dshCanvasOption[data-on="true"]{background:#3b82f6;color:#ffffff}' +
        // Collapsed setting rows: one dashed line that opens a dialog.
        '.dshComfyModelBar{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;min-height:28px;padding:4px 9px;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;text-align:left;transition:background .16s ease,border-color .16s ease,color .16s ease}' +
        '.dshComfyModelBar:hover{background:var(--dsw-alias-bg-layer-1);border-color:#3b82f6;color:var(--dsw-alias-label-primary)}' +
        '.dshComfyModelBar-key{flex:none;font-weight:600;color:var(--dsw-alias-label-primary)}' +
        '.dshComfyModelBar-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.dshComfyModelBar-count{flex:none;font-size:9.5px;opacity:.8}' +
        '.dshComfyModelBar-chev{flex:none;opacity:.7}' +
        // Theme switches cross-fade instead of hard-cutting. The child rule is
        // written with :where so it carries zero specificity: anything that ships
        // its own transition (the lift buttons, the slider thumb) keeps working.
        '.dshComfySurface-dark,.dshComfySurface-light{transition:background-color .3s ease,color .3s ease}' +
        ':where(.dshComfySurface-dark) *,:where(.dshComfySurface-light) *{transition:background-color .26s ease,color .26s ease,border-color .26s ease}' +
        '@media (prefers-reduced-motion:reduce){.dshComfySurface-dark,.dshComfySurface-light{transition:none}:where(.dshComfySurface-dark) *,:where(.dshComfySurface-light) *{transition:none!important}}' +
        // The workbench panels mount this sheet, not the album one: without the
        // surface tokens their "dark" class would resolve to the host palette.
        SURFACE_DARK_CSS +
        SURFACE_LIGHT_CSS +
        THEME_ICON_CSS
      document.head.appendChild(style)
    }
    // Old name kept as an alias: every surface calls the same injector now.
    const ensureWorkbenchStyle = ensureBaseStyle

    /** Load an image URL and return a small JPEG data URL for snapshot previews. */
    function makeThumbnail(url) {
      return new Promise((resolve) => {
        if (!url || typeof Image === 'undefined') return resolve(null)
        try {
          const image = new Image()
          image.crossOrigin = 'anonymous'
          image.onload = () => {
            try {
              const width = 96
              const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width))
              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = height
              const context = canvas.getContext('2d')
              if (!context) return resolve(null)
              context.drawImage(image, 0, 0, width, height)
              resolve(canvas.toDataURL('image/jpeg', 0.72))
            } catch {
              resolve(null)
            }
          }
          image.onerror = () => resolve(null)
          image.src = url
        } catch {
          resolve(null)
        }
      })
    }

    /** Render-error fallback so a broken workbench panel shows its error, not a blank page. */
    class WorkbenchBoundary extends React.Component {
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
            { style: { padding: 24, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)' } },
            '页面渲染出错：' + String((this.state.error && this.state.error.message) || this.state.error),
          )
        }
        return this.props.children
      }
    }

    /**
     * Pinned quality prefix: text every generation in this panel carries.
     *
     * Kept in its own dialog so the prompt box stays exactly what the user typed;
     * the prefix is only joined at submit time.
     */
    function PinnedPromptDialog(props) {
      ensureWorkbenchStyle()
      const [positive, setPositive] = useState(props.positive || '')
      const [negative, setNegative] = useState(props.negative || '')
      const [enabled, setEnabled] = useState(props.enabled !== false)
      useEffect(() => {
        if (!props.open) return
        setPositive(props.positive || '')
        setNegative(props.negative || '')
        setEnabled(props.enabled !== false)
      }, [props.open])
      if (!props.open) return null
      const area = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        outline: 'none',
        resize: 'vertical',
        lineHeight: 1.55,
      }
      const btn = {
        padding: '5px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      const previewPositive = mergePinnedText(positive, props.samplePrompt, enabled)
      const previewNegative = mergePinnedText(negative, props.sampleNegative, enabled)
      const hasContent = Boolean(String(positive).trim() || String(negative).trim())
      const preview = (label, value) =>
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'flex-start' } },
          h('span', { style: { flex: 'none', width: 30, fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)' } }, label),
          h(
            'span',
            { style: { flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.5, wordBreak: 'break-word' } },
            value || '（空）',
          ),
        )
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 1400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.42)',
            backdropFilter: 'blur(2px)',
          },
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        h(
          'div',
          {
            style: {
              width: 560,
              maxWidth: 'calc(100vw - 40px)',
              maxHeight: '82vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 16,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.3)',
              overflow: 'hidden',
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
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
              },
            },
            h(Icon, { name: 'pin', size: 14 }),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, '固定提示词'),
            h('span', { style: { flex: 1 } }),
            h(
              'button',
              {
                type: 'button',
                onClick: props.onClose,
                style: {
                  width: 24,
                  height: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  borderRadius: '50%',
                  border: 0,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
              },
              '×',
            ),
          ),
          h(
            'div',
            { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setEnabled(!enabled),
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 9px',
                    borderRadius: 999,
                    border: '1px solid ' + (enabled ? '#f59e0b' : 'var(--dsw-alias-border-l2)'),
                    background: enabled ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
                    color: enabled ? '#f59e0b' : 'var(--dsw-alias-label-secondary)',
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    flex: 'none',
                  },
                },
                enabled ? '已启用' : '已停用',
              ),
              h('span', null, '停用后内容保留，但生成时不再拼接'),
              h('span', { style: { flex: 1 } }),
              h(
                'span',
                { style: { fontSize: 10, whiteSpace: 'nowrap' } },
                enabled && hasContent ? '生效中' : '未生效',
              ),
            ),
            h(
              'label',
              { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
              '正向（拼在正文前面）',
              h('textarea', {
                value: positive,
                rows: 3,
                placeholder: '例如：masterpiece, best quality, amazing quality, very awa',
                style: area,
                onChange: (event) => setPositive(event.target.value),
              }),
            ),
            h(
              'label',
              { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
              '负向（拼在负面提示词前面）',
              h('textarea', {
                value: negative,
                rows: 3,
                placeholder: '例如：worst quality, low quality, lowres, bad anatomy',
                style: area,
                onChange: (event) => setNegative(event.target.value),
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('span', { style: { fontSize: 10.5, fontWeight: 600 } }, '实际发送'),
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    padding: '8px 10px',
                    borderRadius: 9,
                    border: '1px dashed var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    maxHeight: 120,
                    overflowY: 'auto',
                  },
                },
                preview('正向', previewPositive),
                preview('负向', previewNegative),
              ),
            ),
          ),
          h(
            'div',
            {
              style: {
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderTop: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
              },
            },
            h(
              'button',
              {
                type: 'button',
                style: btn,
                onClick: () => {
                  setPositive('')
                  setNegative('')
                },
              },
              '清空',
            ),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', style: btn, onClick: props.onClose }, '取消'),
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, btn, {
                  background: '#3b82f6',
                  borderColor: '#3b82f6',
                  color: '#ffffff',
                }),
                onClick: () =>
                  props.onSave({ positive: positive.trim(), negative: negative.trim(), enabled }),
              },
              '保存',
            ),
          ),
        ),
      )
    }

    /** Edit the custom prompt-writing rules per style (tags vs natural language). */
    function PromptRulesDialog(props) {
      ensureWorkbenchStyle()
      const [tagsValue, setTagsValue] = usePref('promptWriteSystemTags')
      const [naturalValue, setNaturalValue] = usePref('promptWriteSystemNatural')
      const [tagsDraft, setTagsDraft] = useState(tagsValue || '')
      const [naturalDraft, setNaturalDraft] = useState(naturalValue || '')
      const [modelValue, setModelValue] = usePref('promptWriteModel')
      const [providerValue, setProviderValue] = usePref('promptWriteProvider')
      const [effortValue, setEffortValue] = usePref('promptWriteEffort')
      const [draftModel, setDraftModel] = useState(modelValue || '')
      const [draftProvider, setDraftProvider] = useState(providerValue || '')
      const [draftEffort, setDraftEffort] = useState(effortValue || 'high')
      const llmCatalog = useLlmCatalog()
      useEffect(() => {
        if (props.open) {
          setTagsDraft(tagsValue || '')
          setNaturalDraft(naturalValue || '')
          setDraftModel(modelValue || '')
          setDraftProvider(providerValue || '')
          setDraftEffort(effortValue || 'high')
        }
      }, [props.open])
      const hitModel = catalogModelOf(llmCatalog.catalog, draftProvider, draftModel)
      const advertised = hitModel && Array.isArray(hitModel.efforts) ? hitModel.efforts : []
      const effortPairs = (() => {
        const pairs =
          advertised.length > 0
            ? advertised.map((entry) => [entry.id, entry.name || entry.id])
            : [
                ['off', '关闭'],
                ['low', '低'],
                ['high', '高'],
                ['max', '最高'],
              ]
        // Keep a stored tier visible even when the picked model stopped listing it.
        return pairs.some((pair) => pair[0] === draftEffort) ? pairs : [[draftEffort, draftEffort]].concat(pairs)
      })()
      if (!props.open) return null
      const field = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        outline: 'none',
        resize: 'vertical',
        lineHeight: 1.55,
      }
      const btn = {
        padding: '5px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      const block = (title, hint, value, onChange) =>
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          h('div', { style: { fontSize: 11, fontWeight: 600 } }, title),
          h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } }, hint),
          h('textarea', {
            value,
            rows: 6,
            placeholder: '例如：用中文标签；不要质量词；强调构图与光影…',
            style: field,
            onChange: (event) => onChange(event.target.value),
          }),
        )
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 1400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.42)',
            backdropFilter: 'blur(2px)',
          },
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        h(
          'div',
          {
            style: {
              width: 640,
              maxWidth: 'calc(100vw - 40px)',
              maxHeight: '84vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 16,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.3)',
              overflow: 'hidden',
              animation: 'dshPageIn 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
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
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
              },
            },
            h(Icon, { name: 'sparkles', size: 14 }),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, '提示词写作规则'),
            h('span', { style: { flex: 1 } }),
            h(
              'button',
              {
                type: 'button',
                onClick: props.onClose,
                style: {
                  width: 24,
                  height: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  borderRadius: '50%',
                  border: 0,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
              },
              '×',
            ),
          ),
          h(
            'div',
            { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 } },
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 } },
              h(
                'label',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                '润色模型',
                h(LlmModelPicker, {
                  provider: draftProvider,
                  model: draftModel,
                  title: '润色模型（跟随默认时用 DSH 当前选中的模型）',
                  menuMinWidth: 300,
                  chevron: true,
                  // The same box as the select beside it: this dialog is a form, so
                  // the picker has to read as one of its fields, not a toolbar chip.
                  triggerStyle: {
                    height: 36,
                    boxSizing: 'border-box',
                    padding: '0 10px',
                    borderRadius: 9,
                    fontSize: 11.5,
                    lineHeight: 1.55,
                    fontFamily: 'inherit',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    color: 'var(--dsw-alias-label-primary)',
                    border: '1px solid var(--dsw-alias-border-l2)',
                  },
                  onPick: (next) => {
                    const parsed = parseRouteKey(next)
                    setDraftProvider(parsed.provider)
                    setDraftModel(parsed.model)
                  },
                }),
              ),
              h(
                'label',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                '思考强度',
                h(
                  'select',
                  // Same explicit box as the model picker: a native select is a hair
                  // taller than a padded input, which is what looked off. Zero vertical
                  // padding + a fixed height centers the text the way the picker does.
                  { value: draftEffort, style: Object.assign({}, field, { height: 36, padding: '0 10px' }), onChange: (event) => setDraftEffort(event.target.value) },
                  effortPairs.map(([value, text]) => h('option', { key: value, value }, text)),
                ),
              ),
            ),
            block(
              '标签式提示词（SD 风格）',
              'AI 写/润色选择「SD 标签」时使用；留空则用内置的标签风格规则。',
              tagsDraft,
              setTagsDraft,
            ),
            block(
              '自然语言提示词',
              'AI 写/润色选择「自然语言」（在线 API 面板也用它）时使用；留空则用内置的自然语言规则。',
              naturalDraft,
              setNaturalDraft,
            ),
          ),
          h(
            'div',
            {
              style: {
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderTop: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
              },
            },
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', style: btn, onClick: props.onClose }, '取消'),
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, btn, {
                  background: '#3b82f6',
                  borderColor: '#3b82f6',
                  color: '#ffffff',
                }),
                onClick: () => {
                  setTagsValue(tagsDraft)
                  setNaturalValue(naturalDraft)
                  setProviderValue(draftProvider)
                  setModelValue(draftModel)
                  setEffortValue(draftEffort)
                  props.onClose()
                },
              },
              '保存',
            ),
          ),
        ),
      )
    }

    /** Read the history of AI prompt-writing turns (per style). */
    function PromptHistoryDialog(props) {
      ensureWorkbenchStyle()
      const [history, setHistory] = usePref('promptWriteHistory')
      if (!props.open) return null
      const list = Array.isArray(history) ? history : []
      const btn = {
        padding: '5px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 1400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.42)',
            backdropFilter: 'blur(2px)',
          },
          onClick: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        h(
          'div',
          {
            style: {
              width: 640,
              maxWidth: 'calc(100vw - 40px)',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 16,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.3)',
              overflow: 'hidden',
              animation: 'dshPageIn 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
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
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
              },
            },
            h(Icon, { name: 'info', size: 14 }),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, '提示词对话'),
            h('span', { style: { flex: 1 } }),
            list.length > 0
              ? h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => setHistory([]),
                    style: Object.assign({}, btn, { padding: '3px 8px', fontSize: 10 }),
                  },
                  '清空',
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                onClick: props.onClose,
                style: {
                  width: 24,
                  height: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  borderRadius: '50%',
                  border: 0,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                },
              },
              '×',
            ),
          ),
          h(
            'div',
            { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 } },
            list.length === 0
              ? h(
                  'div',
                  { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                  '还没有对话。用「AI 写/润色」生成的每一轮都会记录在这里。',
                )
              : list.map((entry, index) =>
                  h(
                    'div',
                    {
                      key: index,
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: 'var(--dsw-alias-bg-layer-1)',
                      },
                    },
                    h(
                      'div',
                      { style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)' } },
                      (entry.style === 'tags' ? 'SD 标签' : '自然语言') +
                        ' · ' +
                        new Date(entry.ts || Date.now()).toLocaleString(),
                    ),
                    h(
                      'div',
                      { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.45 } },
                      '输入：' + String(entry.input || ''),
                    ),
                    h(
                      'div',
                      { style: { fontSize: 11, whiteSpace: 'pre-wrap', lineHeight: 1.55 } },
                      String(entry.output || ''),
                    ),
                  ),
                ),
          ),
        ),
      )
    }

    /** Entry screen: pick the local ComfyUI board or the online API workstation. */
    function WorkbenchChooser(props) {
      ensureWorkbenchStyle()
      const card = (key, title, desc) =>
        h(
          'button',
          {
            key,
            type: 'button',
            onClick: () => props.onPick(key),
            style: {
              flex: 1,
              minHeight: 120,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 16,
              borderRadius: 12,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              boxShadow: '0 4px 18px rgba(0, 0, 0, 0.08)',
              color: 'var(--dsw-alias-label-primary)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s cubic-bezier(.22,1,.36,1)',
            },
            onMouseEnter: (event) => {
              event.currentTarget.style.transform = 'translateY(-2px)'
              event.currentTarget.style.boxShadow = '0 12px 34px rgba(0, 0, 0, 0.16)'
            },
            onMouseLeave: (event) => {
              event.currentTarget.style.transform = 'none'
              event.currentTarget.style.boxShadow = '0 4px 18px rgba(0, 0, 0, 0.08)'
            },
          },
          h(Icon, { name: key === 'local' ? 'scan' : 'images', size: 22 }),
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
          h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', lineHeight: 1.6 } }, desc),
        )
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            height: '100%',
            boxSizing: 'border-box',
            padding: 24,
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
          },
        },
        h('div', { style: { fontSize: 18, fontWeight: 600 } }, 'Image 工作台'),
        h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, '选择出图方式'),
        h(
          'div',
          { style: { display: 'flex', gap: 12, width: '78%', margin: '0 auto' } },
          card('local', 'ComfyUI · MOSS 画板模式', 'MOSS 模型 / 画框版式 / 快速生成'),
          card('online', '在线 API', '远程出图（gpt-image / MiniMax）'),
          card('text2img', '本地文生图', '非 MOSS 模型 / DiT 直出'),
        ),
      )
    }

    /** Remotely generated images: OpenAI-compatible and MiniMax adapters. */
    function OnlineImagePanel(props) {
      ensureWorkbenchStyle()
      const [provider, setProvider] = usePref('remoteProvider')
      const [mode, setMode] = usePref('remoteMode')
      const [endpoint, setEndpoint] = usePref('remoteEndpoint')
      const [openaiKey, setOpenaiKey] = usePref('remoteApiKeyOpenai')
      const [minimaxKey, setMinimaxKey] = usePref('remoteApiKeyMinimax')
      const apiKey = provider === 'minimax' ? minimaxKey : openaiKey
      const setApiKey = (value) => (provider === 'minimax' ? setMinimaxKey(value) : setOpenaiKey(value))
      const [model, setModel] = usePref('remoteModel')
      const [prompt, setPrompt] = usePref('remotePrompt')
      const [size, setSize] = usePref('remoteSize')
      const [quality, setQuality] = usePref('remoteQuality')
      const [background, setBackground] = usePref('remoteBackground')
      const [outputFormat, setOutputFormat] = usePref('remoteFormat')
      const [count, setCount] = usePref('remoteCount')
      const [aspectRatio, setAspectRatio] = usePref('remoteAspect')
      const [promptOptimizer, setPromptOptimizer] = usePref('remoteOptimizer')
      const [customW, setCustomW] = useState('')
      const [customH, setCustomH] = useState('')
      const [sizeMode, setSizeMode] = useState('preset')
      const [imageData, setImageData] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [result, setResult] = useState(null)
      const [aiBusy, setAiBusy] = useState(false)
      const [aiError, setAiError] = useState('')
      const [rulesOpen, setRulesOpen] = useState(false)
      // Extra requirements handed to the model on top of the prompt box.
      const [aiExtra, setAiExtra] = useState('')
      const [promptWriteSystemNatural] = usePref('promptWriteSystemNatural')
      const [promptHistory, setPromptHistory] = usePref('promptWriteHistory')
      const [promptWriteProvider] = usePref('promptWriteProvider')
      const [promptWriteModel] = usePref('promptWriteModel')
      const [promptWriteEffort] = usePref('promptWriteEffort')
      const [historyOpen, setHistoryOpen] = useState(false)
      const [modelOptions, setModelOptions] = useState([])
      const [modelsBusy, setModelsBusy] = useState(false)
      const [modelsError, setModelsError] = useState('')
      const [saveDir, setSaveDir] = usePref('remoteSaveDir')
      const [pickerOpen, setPickerOpen] = useState(false)
      const [savedFiles, setSavedFiles] = useState([])
      const [savedTick, setSavedTick] = useState(0)
      const [viewerOpen, setViewerOpen] = useState(false)
      const [viewerIndex, setViewerIndex] = useState(0)
      // Switching provider only rewrites values that still equal the other side's
      // defaults, so a custom endpoint/model survives the toggle.
      useEffect(() => {
        if (provider === 'minimax') {
          if (!endpoint || endpoint === 'https://api.quickrouter.ai/v1') setEndpoint('https://api.minimax.cn/v1')
          if (!model || model === 'gpt-image-2.5-flare-c') setModel('image-01')
        } else {
          if (!endpoint || endpoint === 'https://api.minimax.cn/v1') setEndpoint('https://api.quickrouter.ai/v1')
          if (!model || model === 'image-01') setModel('gpt-image-2.5-flare-c')
        }
      }, [provider])
      useEffect(() => {
        if (!saveDir) return undefined
        let alive = true
        fetch('/plugin/comfy-status/outputs?dir=' + encodeURIComponent(saveDir), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive || !data || !data.ok) return
            setSavedFiles(Array.isArray(data.files) ? data.files : [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [saveDir, savedTick])
      const pickImage = (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => setImageData(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => setError('读取参考图失败')
        reader.readAsDataURL(file)
      }
      const fetchModels = async () => {
        if (modelsBusy) return
        if (!String(endpoint).trim()) {
          setModelsError('先填端点')
          return
        }
        setModelsBusy(true)
        setModelsError('')
        try {
          const res = await fetch('/plugin/comfy-canvas/remote-models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint, key: apiKey }),
          })
          const data = await res.json().catch(() => null)
          if (!data || !data.ok) throw new Error((data && data.error) || '获取失败')
          setModelOptions(Array.isArray(data.models) ? data.models : [])
        } catch (err) {
          setModelsError(String((err && err.message) || err))
        } finally {
          setModelsBusy(false)
        }
      }
      const aiWrite = async () => {
        if (aiBusy) return
        const instruction = aiExtra.trim()
        if (!String(prompt).trim() && !instruction) {
          setAiError('先写下提示词，或填一句额外要求')
          return
        }
        setAiBusy(true)
        setAiError('')
        try {
          const res = await fetch('/plugin/comfy-canvas/prompt-write', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              current: prompt,
              // The extra box is the instruction; empty keeps the old behaviour.
              instruction: instruction || prompt,
              targetModel: model,
              system: promptWriteSystemNatural,
              provider: promptWriteProvider || undefined,
              model: promptWriteModel || undefined,
              effort: promptWriteEffort,
            }),
          })
          const data = await res.json().catch(() => null)
          if (!data || !data.ok) throw new Error((data && data.error) || '请求失败')
          const output = data.text || ''
          setPrompt(output)
          setPromptHistory(
            [{ ts: Date.now(), style: 'natural', input: prompt, output }]
              .concat(Array.isArray(promptHistory) ? promptHistory : [])
              .slice(0, 50),
          )
        } catch (err) {
          setAiError(String((err && err.message) || err))
        } finally {
          setAiBusy(false)
        }
      }
      const generate = async () => {
        if (!String(endpoint).trim() || !String(apiKey).trim() || !String(prompt).trim()) {
          setError('需要端点、API Key 和 prompt')
          return
        }
        if (mode === 'edit' && !imageData) {
          setError('编辑模式需要先选参考图')
          return
        }
        let finalSize = size
        if (provider === 'openai' && sizeMode === 'custom') {
          const width = Number(customW)
          const height = Number(customH)
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            setError('自定义尺寸无效')
            return
          }
          if (width % 16 !== 0 || height % 16 !== 0) {
            setError('宽和高都要是 16 的倍数')
            return
          }
          const ratio = width / height
          if (ratio < 1 / 3 || ratio > 3) {
            setError('宽高比需要在 1:3 到 3:1 之间')
            return
          }
          finalSize = width + 'x' + height
        }
        setBusy(true)
        setError('')
        setResult(null)
        try {
          const res = await fetch('/plugin/comfy-canvas/remote-image', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              provider,
              endpoint,
              key: apiKey,
              model,
              prompt,
              size: finalSize,
              mode: mode === 'edit' ? 'edits' : 'generations',
              image: mode === 'edit' ? imageData : '',
              quality,
              background,
              output_format: outputFormat,
              n: count,
              aspect_ratio: aspectRatio,
              prompt_optimizer: promptOptimizer,
              width: Number(customW) || 0,
              height: Number(customH) || 0,
            }),
          })
          const data = await res.json().catch(() => null)
          if (!data || !data.ok) throw new Error((data && data.error) || '请求失败')
          setResult(data)
          const list = Array.isArray(data.b64List) ? data.b64List : data.b64 ? [data.b64] : []
          if (saveDir && list.length > 0) {
            let savedAny = false
            for (const b64 of list) {
              try {
                const saved = await fetch('/plugin/comfy-canvas/save-image', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ dir: saveDir, b64 }),
                })
                const savedData = await saved.json().catch(() => null)
                if (savedData && savedData.ok) savedAny = true
              } catch {
                // Saving is best-effort; the preview still shows the images.
              }
            }
            if (savedAny) setSavedTick((value) => value + 1)
          }
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }
      const field = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        outline: 'none',
      }
      const label = {
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        fontSize: 10.5,
        color: 'var(--dsw-alias-label-secondary)',
      }
      const images = result ? (Array.isArray(result.b64List) ? result.b64List : result.b64 ? [result.b64] : []) : []
      const btn = {
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      return h(
        'div',
        {
          className: props.night ? 'dshComfySurface-dark' : 'dshComfySurface-light',
          style: {
            display: 'flex',
            gap: 16,
            height: '100%',
            boxSizing: 'border-box',
            padding: 16,
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            overflow: 'hidden',
          },
        },
        h(
          'div',
          {
            style: {
              width: 360,
              flex: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              paddingRight: 2,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('button', { type: 'button', style: btn, onClick: props.onBack }, '返回'),
            h('div', { style: { fontSize: 14, fontWeight: 600 } }, '在线 API 出图'),
            h('span', { style: { flex: 1 } }),
            h(SurfaceThemeButton, { night: props.night, mode: props.themeMode, onClick: props.onTheme }),
          ),
          h(SegmentToggle, {
            options: [
              { value: 'openai', label: 'OpenAI 兼容' },
              { value: 'minimax', label: 'MiniMax' },
            ],
            value: provider,
            onChange: setProvider,
          }),
          h(SegmentToggle, {
            options: [
              { value: 't2i', label: '文生图' },
              { value: 'edit', label: '参考图编辑' },
            ],
            value: mode,
            onChange: setMode,
          }),
          mode === 'edit'
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '参考图'),
                imageData
                  ? h(
                      'div',
                      { style: { display: 'flex', gap: 10, alignItems: 'center' } },
                      h('img', {
                        src: imageData,
                        alt: '',
                        style: {
                          width: 64,
                          height: 64,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid var(--dsw-alias-border-l2)',
                        },
                      }),
                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                        h(
                          'label',
                          { style: { display: 'inline-flex', cursor: 'pointer' } },
                          h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: pickImage }),
                          h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-brand-primary)' } }, '更换'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => setImageData(''),
                            style: {
                              border: 0,
                              background: 'transparent',
                              padding: 0,
                              textAlign: 'left',
                              fontSize: 10.5,
                              color: 'var(--dsw-alias-label-secondary)',
                              cursor: 'pointer',
                            },
                          },
                          '清除',
                        ),
                      ),
                    )
                  : h(
                      'label',
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          height: 96,
                          borderRadius: 10,
                          border: '1px dashed var(--dsw-alias-border-l2)',
                          background: 'var(--dsw-alias-bg-layer-1)',
                          cursor: 'pointer',
                          color: 'var(--dsw-alias-label-secondary)',
                          fontSize: 10.5,
                        },
                      },
                      h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: pickImage }),
                      h(Icon, { name: 'images', size: 18 }),
                      '选择参考图（随请求上传）',
                    ),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h(
                'span',
                { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                mode === 'edit' ? '修改要求' : 'Prompt',
              ),
              h('span', { style: { flex: 1 } }),
            ),
            h('textarea', {
              value: prompt,
              rows: 6,
              placeholder:
                mode === 'edit'
                  ? '描述怎么改这张参考图…'
                  : '描述要画的图…（也可以先写需求，点「AI 写/润色」）',
              style: Object.assign({}, field, { resize: 'vertical', lineHeight: 1.55 }),
              onChange: (event) => setPrompt(event.target.value),
            }),
            // The AI trio acts on the prompt above it, so it sits under the box
            // instead of crowding the label row. The extra box is what the model
            // is told on top of that prompt.
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              h(
                'button',
                {
                  type: 'button',
                  disabled: aiBusy,
                  onClick: aiWrite,
                  title: 'AI 写 / 润色提示词',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: aiBusy ? 'default' : 'pointer',
                    opacity: aiBusy ? 0.6 : 1,
                  },
                },
                h(Icon, { name: 'sparkles', size: 11 }),
                aiBusy ? '生成中…' : 'AI 写/润色',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setRulesOpen(true),
                  title: '编辑提示词写作规则',
                  style: {
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 10,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  },
                },
                '规则',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setHistoryOpen(true),
                  title: '查看提示词对话记录',
                  style: {
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 10,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  },
                },
                '对话',
              ),
            ),
            h('textarea', {
              value: aiExtra,
              rows: 2,
              placeholder: '额外要求（可留空）：想让 AI 怎么改，例如更有电影感、补充材质细节',
              style: Object.assign({}, field, { resize: 'vertical', lineHeight: 1.5 }),
              onChange: (event) => setAiExtra(event.target.value),
            }),
            aiError
              ? h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-state-error-primary)' } }, aiError)
              : null,
          ),
          provider === 'minimax'
            ? h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 } },
                h(
                  'label',
                  { style: label },
                  '宽高比',
                  h(
                    'select',
                    { value: aspectRatio, style: field, onChange: (event) => setAspectRatio(event.target.value) },
                    ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'].map((option) =>
                      h('option', { key: option, value: option }, option),
                    ),
                  ),
                ),
                h(
                  'label',
                  { style: label },
                  '数量（1-9）',
                  h('input', {
                    type: 'number',
                    min: 1,
                    max: 9,
                    value: count,
                    style: field,
                    onChange: (event) => {
                      const next = Math.min(Math.max(1, Math.trunc(Number(event.target.value) || 1)), 9)
                      setCount(next)
                    },
                  }),
                ),
                h(
                  'label',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                  h('input', {
                    type: 'checkbox',
                    checked: Boolean(promptOptimizer),
                    onChange: (event) => setPromptOptimizer(event.target.checked),
                  }),
                  'prompt_optimizer（自动优化提示词）',
                ),
              )
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                  h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '尺寸'),
                  h(
                    'select',
                    {
                      value: sizeMode === 'custom' ? 'custom' : size,
                      style: field,
                      onChange: (event) => {
                        const value = event.target.value
                        if (value === 'custom') {
                          setSizeMode('custom')
                        } else {
                          setSizeMode('preset')
                          setSize(value)
                        }
                      },
                    },
                    ['1024x1024', '1536x1024', '1024x1536', 'auto'].map((option) =>
                      h('option', { key: option, value: option }, option),
                    ),
                    h('option', { value: 'custom' }, '自定义…'),
                  ),
                  sizeMode === 'custom'
                    ? h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                        h('input', {
                          type: 'number',
                          value: customW,
                          placeholder: '宽',
                          style: Object.assign({}, field, { width: 84 }),
                          onChange: (event) => setCustomW(event.target.value),
                        }),
                        h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, '×'),
                        h('input', {
                          type: 'number',
                          value: customH,
                          placeholder: '高',
                          style: Object.assign({}, field, { width: 84 }),
                          onChange: (event) => setCustomH(event.target.value),
                        }),
                        h(
                          'span',
                          { style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.4 } },
                          '16 的倍数 · 1:3~3:1',
                        ),
                      )
                    : null,
                ),
                h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 } },
                  h(
                    'label',
                    { style: label },
                    '质量',
                    h(
                      'select',
                      { value: quality, style: field, onChange: (event) => setQuality(event.target.value) },
                      ['auto', 'low', 'medium', 'high', 'xhigh'].map((option) =>
                        h('option', { key: option, value: option }, option),
                      ),
                    ),
                  ),
                  h(
                    'label',
                    { style: label },
                    '背景',
                    h(
                      'select',
                      { value: background, style: field, onChange: (event) => setBackground(event.target.value) },
                      ['auto', 'opaque', 'transparent'].map((option) =>
                        h('option', { key: option, value: option }, option),
                      ),
                    ),
                  ),
                  h(
                    'label',
                    { style: label },
                    '格式',
                    h(
                      'select',
                      { value: outputFormat, style: field, onChange: (event) => setOutputFormat(event.target.value) },
                      ['png', 'jpeg', 'webp'].map((option) => h('option', { key: option, value: option }, option)),
                    ),
                  ),
                  h(
                    'label',
                    { style: label },
                    '数量',
                    h('input', {
                      type: 'number',
                      min: 1,
                      max: 4,
                      value: count,
                      style: field,
                      onChange: (event) => {
                        const next = Math.min(Math.max(1, Math.trunc(Number(event.target.value) || 1)), 4)
                        setCount(next)
                      },
                    }),
                  ),
                ),
              ),
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingTop: 8,
                borderTop: '1px solid var(--dsw-alias-border-l1)',
              },
            },
            h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, '接口设置'),
            h(
              'label',
              { style: label },
              '端点',
              h('input', {
                value: endpoint,
                placeholder: provider === 'minimax' ? 'https://api.minimax.cn/v1' : 'https://api.quickrouter.ai/v1',
                style: field,
                onChange: (event) => setEndpoint(event.target.value),
              }),
            ),
            h(
              'label',
              { style: label },
              'API Key（只存本机）',
              h('input', {
                type: 'password',
                value: apiKey,
                placeholder: '填写你的 key',
                style: field,
                onChange: (event) => setApiKey(event.target.value),
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '模型'),
                h('span', { style: { flex: 1 } }),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: modelsBusy,
                    onClick: fetchModels,
                    style: {
                      padding: '2px 7px',
                      borderRadius: 6,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-secondary)',
                      fontSize: 9.5,
                      fontFamily: 'inherit',
                      cursor: modelsBusy ? 'default' : 'pointer',
                      opacity: modelsBusy ? 0.6 : 1,
                    },
                  },
                  modelsBusy ? '获取中…' : '获取列表',
                ),
              ),
              h('input', {
                value: model,
                list: 'dsh-remote-models',
                placeholder: provider === 'minimax' ? 'image-01' : 'gpt-image-2.5-flare-c',
                style: field,
                onChange: (event) => setModel(event.target.value),
              }),
              h(
                'datalist',
                { id: 'dsh-remote-models' },
                modelOptions.map((option) => h('option', { key: option, value: option })),
              ),
              modelsError
                ? h('div', { style: { fontSize: 9.5, color: 'var(--dsw-alias-state-error-primary)' } }, modelsError)
                : null,
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: generate,
              style: {
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #3b82f6',
                background: '#3b82f6',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
                transition: 'transform .16s ease, box-shadow .16s ease',
              },
              onMouseEnter: (event) => {
                if (busy) return
                event.currentTarget.style.transform = 'translateY(-1px)'
                event.currentTarget.style.boxShadow = '0 8px 22px rgba(59, 130, 246, 0.35)'
              },
              onMouseLeave: (event) => {
                event.currentTarget.style.transform = 'none'
                event.currentTarget.style.boxShadow = 'none'
              },
            },
            busy ? '生成中…' : '生成',
          ),
          h(
            'div',
            {
              style: {
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--dsw-alias-border-l1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '保存目录'),
              h('span', { style: { flex: 1 } }),
              h('button', { type: 'button', style: btn, onClick: () => setPickerOpen(true) }, '选择目录'),
            ),
            saveDir
              ? h(
                  'div',
                  {
                    style: {
                      fontSize: 10,
                      color: 'var(--dsw-alias-label-secondary)',
                      wordBreak: 'break-all',
                      lineHeight: 1.5,
                    },
                  },
                  saveDir,
                )
              : h(
                  'div',
                  {
                    style: {
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: 'var(--dsw-alias-state-warn-primary)',
                      animation: 'dshBlink 1.2s ease-in-out infinite',
                    },
                  },
                  '请先设置保存目录（生成的图会存到这里）',
                ),
            savedFiles.length > 0
              ? h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 } },
                  savedFiles.slice(0, 6).map((file, index) =>
                    h(
                      'button',
                      {
                        key: file.name,
                        type: 'button',
                        onClick: () => {
                          setViewerIndex(index)
                          setViewerOpen(true)
                        },
                        title: file.name,
                        style: {
                          padding: 0,
                          border: 0,
                          background: 'transparent',
                          borderRadius: 8,
                          overflow: 'hidden',
                          height: 56,
                          cursor: 'pointer',
                          transition: 'transform .16s ease, box-shadow .16s ease',
                        },
                        onMouseEnter: (event) => {
                          event.currentTarget.style.transform = 'translateY(-1px)'
                          event.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.18)'
                        },
                        onMouseLeave: (event) => {
                          event.currentTarget.style.transform = 'none'
                          event.currentTarget.style.boxShadow = 'none'
                        },
                      },
                      h('img', {
                        src: file.thumb || file.url,
                        alt: '',
                        loading: 'lazy',
                        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
                      }),
                    ),
                  ),
                )
              : null,
          ),
          h(DirectoryPicker, {
            open: pickerOpen,
            title: '选择保存目录',
            startPath: saveDir || '',
            onPick: (path) => {
              setSaveDir(path)
              setPickerOpen(false)
            },
            onClose: () => setPickerOpen(false),
          }),
        h(PromptRulesDialog, { open: rulesOpen, onClose: () => setRulesOpen(false) }),
          h(PromptHistoryDialog, { open: historyOpen, onClose: () => setHistoryOpen(false) }),
          viewerOpen && savedFiles.length > 0
            ? h(ImageViewer, {
                images: savedFiles.map((file) => ({ url: file.url, filename: file.name })),
                startIndex: Math.max(0, Math.min(viewerIndex, savedFiles.length - 1)),
                filename: savedFiles[viewerIndex] ? savedFiles[viewerIndex].name : '',
                onClose: () => setViewerOpen(false),
              })
            : null,
          error
            ? h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-state-error-primary)', lineHeight: 1.5 } }, error)
            : null,
        ),
        h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 16,
              borderRadius: 14,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              overflow: 'auto',
            },
          },
          images.length > 0
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, width: '100%' } },
                  images.map((b64, index) =>
                    h(
                      'button',
                      {
                        key: index,
                        type: 'button',
                        onClick: () => {
                          setViewerIndex(index)
                          setViewerOpen(true)
                        },
                        style: {
                          padding: 0,
                          border: '1px solid var(--dsw-alias-border-l2)',
                          borderRadius: 12,
                          overflow: 'hidden',
                          background: 'transparent',
                          cursor: 'pointer',
                          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.18)',
                        },
                      },
                      h('img', {
                        src: 'data:image/png;base64,' + b64,
                        alt: '',
                        style: { width: '100%', display: 'block' },
                      }),
                    ),
                  ),
                ),
                h(
                  'a',
                  {
                    href: 'data:image/png;base64,' + images[0],
                    download: 'remote-image.png',
                    style: { fontSize: 11, color: 'var(--dsw-alias-brand-primary)' },
                  },
                  '下载第一张',
                ),
              )
            : h(
                'div',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                h(Icon, { name: 'images', size: 34 }),
                h('div', { style: { fontSize: 11.5 } }, busy ? '正在生成…' : '结果会显示在这里'),
              ),
        ),
        viewerOpen && images.length > 0
          ? h(ImageViewer, {
              images: images.map((b64, index) => ({ url: 'data:image/png;base64,' + b64, filename: 'remote-' + (index + 1) + '.png' })),
              startIndex: Math.max(0, Math.min(viewerIndex, images.length - 1)),
              onClose: () => setViewerOpen(false),
            })
          : null,
      )
    }

    /** Plain text-to-image for non-MOSS DiT models (UNETLoader + CLIPLoader + KSampler). */
    function LocalText2ImgPanel(props) {
      ensureWorkbenchStyle()
      const [prompt, setPrompt] = usePref('t2iPrompt')
      const [negative, setNegative] = usePref('t2iNegative')
      const [models, setModels] = usePref('t2iModels')
      const [clipType, setClipType] = usePref('t2iClipType')
      const [size, setSize] = usePref('t2iSize')
      const [scale, setScale] = usePref('t2iScale')
      // What the AI is told on top of the prompt next to it; empty means "only
      // rewrite what is written there", the behaviour before this box existed.
      const [aiExtra, setAiExtra] = useState('')
      const [sampling, setSampling] = usePref('t2iSampling')
      const [meta, setMeta] = usePref('t2iMeta')
      const [promptStyle, setPromptStyle] = usePref('t2iPromptStyle')
      // Pinned quality prefix: joined onto what is submitted, never onto the
      // prompt box itself.
      const [pinPositive, setPinPositive] = usePref('t2iPinPositive')
      const [pinNegative, setPinNegative] = usePref('t2iPinNegative')
      const [pinEnabled, setPinEnabled] = usePref('t2iPinEnabled')
      const [pinOpen, setPinOpen] = useState(false)
      const pinSet = Boolean(String(pinPositive || '').trim() || String(pinNegative || '').trim())
      const pinActive = pinSet && pinEnabled !== false
      // Seed mode is stored with the sampling settings so the request carries it
      // and the choice survives a reload, the same way the canvas does it.
      const randomSeed = Boolean(sampling && sampling.seedMode === 'random')
      const [aiBusy, setAiBusy] = useState(false)
      const [aiError, setAiError] = useState('')
      const [rulesOpen, setRulesOpen] = useState(false)
      const [modelsOpen, setModelsOpen] = useState(false)
      const [loraOpen, setLoraOpen] = useState(false)
      const [promptWriteSystemTags] = usePref('promptWriteSystemTags')
      const [promptWriteSystemNatural] = usePref('promptWriteSystemNatural')
      const [promptHistory, setPromptHistory] = usePref('promptWriteHistory')
      const [promptWriteProvider] = usePref('promptWriteProvider')
      const [promptWriteModel] = usePref('promptWriteModel')
      const [promptWriteEffort] = usePref('promptWriteEffort')
      const [historyOpen, setHistoryOpen] = useState(false)
      const [fileMeta, setFileMeta] = useState({})
      const startedRef = useRef(0)
      const [options, setOptions] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [status, setStatus] = useState('')
      const [gallery, setGallery] = useState([])
      const [selected, setSelected] = useState('')
      const [jobId, setJobId] = useState('')
      // The same SSE tracker the album and the canvas use: ComfyUI's progress and
      // executed frames are what turn "已提交" into real numbers and a filename.
      const [job, setJob] = useState(() => jobStore.get())
      const [jobClock, setJobClock] = useState(() => Date.now())
      const [viewerOpen, setViewerOpen] = useState(false)
      const [viewerIndex, setViewerIndex] = useState(0)
      useEffect(() => {
        let alive = true
        fetch('/plugin/comfy-canvas/model-options', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (alive && data && data.ok) setOptions(data)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])
      const applyGallery = (files) => {
        setGallery(files)
        setSelected((current) => {
          if (current && files.some((file) => file.name === current)) return current
          return files.length > 0 ? files[0].name : ''
        })
      }
      const refreshGallery = () => {
        fetch('/plugin/comfy-status/outputs', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (data && data.ok) applyGallery(Array.isArray(data.files) ? data.files.slice(0, 24) : [])
          })
          .catch(() => {})
      }
      useEffect(() => {
        refreshGallery()
      }, [])
      // Read the embedded ComfyUI parameters for the selected file (the same
      // endpoint the album viewer uses).
      useEffect(() => {
        if (!selected || fileMeta[selected]) return undefined
        let alive = true
        fetch('/plugin/comfy-status/output-meta?filename=' + encodeURIComponent(selected), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!alive || !data || !data.ok) return
            setFileMeta((prev) => Object.assign({}, prev, { [selected]: data.meta || {} }))
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [selected, fileMeta])
      // One subscription drives the status strip: queued/running show the spinner
      // and progress, done refreshes the gallery and selects the finished file,
      // error says what happened. This is the same tracker the album viewer and
      // the canvas use, fed by ComfyUI's own events over SSE.
      useEffect(() => jobStore.subscribe(() => setJob(jobStore.get())), [])
      const jobActive =
        job !== null && jobId !== '' && job.id === jobId && (job.status === 'queued' || job.status === 'running')
      useEffect(() => {
        if (!jobActive) return undefined
        setJobClock(Date.now())
        const timer = setInterval(() => setJobClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [jobActive])
      const jobElapsed = jobActive && job ? Math.max(0, Math.round((jobClock - (job.at || jobClock)) / 1000)) : 0
      // The overlay stays mounted for one exit animation after the job ends; a
      // purely derived condition would unmount it before the fade could run.
      const [overlayShown, setOverlayShown] = useState(false)
      const [overlayClosing, setOverlayClosing] = useState(false)
      useEffect(() => {
        if (jobActive) {
          setOverlayClosing(false)
          setOverlayShown(true)
          return undefined
        }
        if (!overlayShown) return undefined
        setOverlayClosing(true)
        const timer = setTimeout(() => {
          setOverlayShown(false)
          setOverlayClosing(false)
        }, 140)
        return () => clearTimeout(timer)
        // Overlay visibility follows the job; overlayShown is read, not watched.
      }, [jobActive])
      // Settle once per job status change. The folder is re-read here instead of
      // being polled while it runs: the tracker already knows when it ended.
      const settledRef = useRef('')
      useEffect(() => {
        if (!job || jobId === '' || job.id !== jobId) return
        if (job.status !== 'done' && job.status !== 'error') return
        const stamp = job.id + ':' + job.status
        if (settledRef.current === stamp) return
        settledRef.current = stamp
        setBusy(false)
        if (job.status === 'error') {
          setStatus(job.message || '生成失败')
          return
        }
        const elapsed = startedRef.current > 0 ? Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)) : 0
        setStatus('已生成：' + (job.filename || '完成'))
        fetch('/plugin/comfy-status/outputs', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!data || !data.ok) return
            const files = Array.isArray(data.files) ? data.files : []
            setGallery(files.slice(0, 24))
            // Prefer the file the tracker named; fall back to the newest listing
            // entry when the save landed in a subfolder the flat listing misses.
            const target = (job.filename && files.find((file) => file.name === job.filename)) || files[0]
            if (!target) return
            setSelected(target.name)
            // Name the file the listing actually resolved, so the line still reads
            // right when the tracker could not name it (subfolder output).
            setStatus('已生成：' + target.name)
            setMeta(
              Object.assign({}, meta || {}, {
                [target.name]: {
                  model: (models && models.unet) || '',
                  width: outputSize.width,
                  height: outputSize.height,
                  steps: (sampling && sampling.steps) || 20,
                  cfg: sampling && sampling.cfg !== undefined ? sampling.cfg : 1,
                  sampler: (sampling && sampling.sampler) || 'euler',
                  scheduler: (sampling && sampling.scheduler) || 'simple',
                  seed: sampling && sampling.seed !== undefined ? sampling.seed : 0,
                  seconds: elapsed,
                },
              }),
            )
          })
          .catch(() => {})
      }, [job, jobId])
      const step = (delta) => {
        if (gallery.length === 0) return
        const index = gallery.findIndex((file) => file.name === selected)
        const next = ((index < 0 ? 0 : index) + delta + gallery.length) % gallery.length
        setSelected(gallery[next].name)
      }
      useEffect(() => {
        const onKey = (event) => {
          const target = event.target
          if (target && /^(input|textarea|select)$/i.test(target.tagName || '')) return
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            step(-1)
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            step(1)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [gallery, selected])
      const aiWrite = async () => {
        if (aiBusy) return
        const instruction = aiExtra.trim()
        if (!String(prompt).trim() && !instruction) {
          setAiError('先写下提示词，或填一句额外要求')
          return
        }
        setAiBusy(true)
        setAiError('')
        try {
          const res = await fetch('/plugin/comfy-canvas/prompt-write', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              current: prompt,
              // The extra box is the instruction; empty keeps the old behaviour,
              // where the prompt is both what is rewritten and what is asked for.
              instruction: instruction || prompt,
              targetModel: (models && models.unet) || '',
              style: promptStyle,
              system: promptStyle === 'tags' ? promptWriteSystemTags : promptWriteSystemNatural,
              provider: promptWriteProvider || undefined,
              model: promptWriteModel || undefined,
              effort: promptWriteEffort,
            }),
          })
          const data = await res.json().catch(() => null)
          if (!data || !data.ok) throw new Error((data && data.error) || '请求失败')
          const output = data.text || ''
          setPrompt(output)
          setPromptHistory(
            [{ ts: Date.now(), style: promptStyle, input: prompt, output }]
              .concat(Array.isArray(promptHistory) ? promptHistory : [])
              .slice(0, 50),
          )
        } catch (err) {
          setAiError(String((err && err.message) || err))
        } finally {
          setAiBusy(false)
        }
      }
      const generate = async () => {
        if (!String(prompt).trim()) {
          setError('先写 prompt')
          return
        }
        // Random mode: a fresh seed per submission, written back so the field
        // shows the seed that was actually used.
        let submittedSampling = sampling || {}
        if (randomSeed) {
          submittedSampling = Object.assign({}, submittedSampling, { seed: Math.floor(Math.random() * 1e15) })
          setSampling(submittedSampling)
        }
        setBusy(true)
        setError('')
        setStatus('')
        setJobId('')
        startedRef.current = Date.now()
        try {
          const res = await fetch('/plugin/comfy-canvas/text2img', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              // The pinned quality prefix is joined here, at submit time only, so
              // the prompt box keeps exactly what the user wrote.
              prompt: mergePinnedText(pinPositive, prompt, pinEnabled !== false),
              negative: mergePinnedText(pinNegative, negative, pinEnabled !== false),
              models,
              clipType,
              width: outputSize.width,
              height: outputSize.height,
              sampling: submittedSampling,
            }),
          })
          const data = await res.json().catch(() => null)
          if (!data || !data.ok) throw new Error((data && data.error) || '提交失败')
          setJobId(data.promptId || 'ok')
          // Register the job with the shared tracker so this panel gets the same
          // queued/progress/executed events every other surface already shows.
          if (data.promptId) {
            jobStore.start(data.promptId, 't2i')
            setStatus('已提交，等待生成…')
          } else {
            // No id means nothing to track: release the button instead of leaving
            // it spinning until the watchdog gives up.
            setBusy(false)
            refreshGallery()
            setStatus('已提交（没拿到任务号，稍后手动刷新）')
          }
        } catch (err) {
          setError(String((err && err.message) || err))
          setBusy(false)
        }
      }
      const field = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        borderRadius: 9,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        outline: 'none',
      }
      const label = {
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        fontSize: 10.5,
        color: 'var(--dsw-alias-label-secondary)',
      }
      const btn = {
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      const pickModel = (key, value) => setModels(Object.assign({}, models || {}, { [key]: value }))
      // LoRA chain: keep 0..4 entries, each { name, strength }, in application order.
      const loraList = normalizeLoraList(models && models.loras)
      const loraOptions = ((options && options.lora) || []).filter(
        (name) => !loraList.some((entry) => entry.name === name),
      )
      const [dragLora, setDragLora] = useState(null)
      const [dropLora, setDropLora] = useState(null)
      const setLoras = (next) => setModels(Object.assign({}, models || {}, { loras: normalizeLoraList(next) }))
      const addLora = (name) => {
        if (!name) return
        setLoras(loraList.concat([{ name, strength: 1 }]))
      }
      const removeLora = (index) => setLoras(loraList.filter((entry, at) => at !== index))
      const setLoraStrength = (index, value) => {
        const next = loraList.slice()
        next[index] = Object.assign({}, next[index], {
          strength: Math.max(-2, Math.min(2, Number(value) || 0)),
        })
        setLoras(next)
      }
      const moveLora = (from, to) => {
        if (from === null || to === null || from === to) return
        const next = loraList.slice()
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        setLoras(next)
        setDragLora(null)
        setDropLora(null)
      }
      const updateSampling = (patch) => setSampling(Object.assign({}, sampling || {}, patch))
      const preset = (w, h) => setSize({ width: w, height: h })
      const clampSize = (value) => Math.max(64, Math.min(4096, Math.round(Number(value) || 1024)))
      // The scale multiplies the base box at submit time. Latents need multiples
      // of 8, so the product is aligned and capped instead of sent raw.
      const scaleFactor = (() => {
        const next = Number(scale)
        if (!Number.isFinite(next) || next <= 0) return 1
        return Math.min(4, Math.max(0.25, next))
      })()
      const alignSize = (value) => Math.max(64, Math.min(4096, Math.round(value / 8) * 8))
      const outputSize = {
        width: alignSize((size && size.width ? size.width : 1024) * scaleFactor),
        height: alignSize((size && size.height ? size.height : 1024) * scaleFactor),
      }
      const current = gallery.find((file) => file.name === selected) || null
      const currentIndex = Math.max(0, gallery.findIndex((file) => file.name === selected))

      // 模型与 LoRA 各收成一行摘要，点开是弹窗：四格表单原来占掉 94px，LoRA 列表
      // 更多，收起后右栏不再需要滚动。
      const barOf = (key, value, count, onOpen, title) =>
        h(
          'button',
          { type: 'button', className: 'dshComfyModelBar', onClick: onOpen, title },
          h('span', { className: 'dshComfyModelBar-key' }, key),
          h('span', { className: 'dshComfyModelBar-value' }, value),
          count ? h('span', { className: 'dshComfyModelBar-count' }, count) : null,
          h('span', { className: 'dshComfyModelBar-chev' }, '›'),
        )

      const modelBar = barOf(
        '模型',
        (models && models.unet) || '选择 UNET / CLIP / VAE',
        '4 项',
        () => setModelsOpen(true),
        'UNET · CLIP · VAE · CLIP 类型',
      )

      const loraBar = barOf(
        'LoRA',
        loraList.length > 0 ? loraList[0].name : '还没有添加',
        loraList.length + ' / 4',
        () => setLoraOpen(true),
        loraList.length > 0 ? '拖动可调整顺序' : '添加 LoRA 并按顺序串联',
      )

      const dialogShell = (title, body, onClose) =>
        h(
          'div',
          {
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 1300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(2px)',
              animation: 'dshComfyOverlayIn 160ms ease-out both',
            },
            onClick: (event) => {
              if (event.target === event.currentTarget) onClose()
            },
          },
          h(
            'div',
            {
              style: {
                width: 420,
                maxWidth: 'calc(100vw - 40px)',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 14,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-base)',
                color: 'var(--dsw-alias-label-primary)',
                boxShadow: '0 24px 70px rgba(0, 0, 0, 0.42)',
                overflow: 'hidden',
                animation: 'dshComfyPanelIn 180ms cubic-bezier(.23, 1, .32, 1) both',
              },
            },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--dsw-alias-border-l2)',
                },
              },
              h('span', { style: { fontSize: 12.5, fontWeight: 600 } }, title),
              h('span', { style: { flex: 1 } }),
              h(
                'button',
                {
                  type: 'button',
                  onClick: onClose,
                  style: {
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 10.5,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  },
                },
                '完成',
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' } },
              ...body,
            ),
          ),
        )

      const fieldRow = (text, control) =>
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, text),
          h('div', { style: { minWidth: 0 } }, control),
        )

      const modelDialog = modelsOpen
        ? dialogShell(
            '生成设置 · 模型',
            [
              fieldRow(
                'UNET',
                h(Dropdown, {
                  title: 'UNET',
                  placeholder: '选择 UNET',
                  value: (models && models.unet) || '',
                  options: ((options && options.unet) || []).map((item) => ({ value: item, label: item })),
                  onPick: (value) => pickModel('unet', value),
                  menuMinWidth: 240,
                  menuAlign: 'right',
                }),
              ),
              fieldRow(
                'CLIP',
                h(Dropdown, {
                  title: 'CLIP',
                  placeholder: '选择 CLIP',
                  value: (models && models.clip) || '',
                  options: ((options && options.clip) || []).map((item) => ({ value: item, label: item })),
                  onPick: (value) => pickModel('clip', value),
                  menuMinWidth: 240,
                  menuAlign: 'right',
                }),
              ),
              fieldRow(
                'VAE',
                h(Dropdown, {
                  title: 'VAE',
                  placeholder: '选择 VAE',
                  value: (models && models.vae) || '',
                  options: ((options && options.vae) || []).map((item) => ({ value: item, label: item })),
                  onPick: (value) => pickModel('vae', value),
                  menuMinWidth: 200,
                  menuAlign: 'right',
                }),
              ),
              fieldRow(
                'CLIP 类型',
                h(Dropdown, {
                  title: 'CLIP 类型',
                  placeholder: '选择类型',
                  value: clipType,
                  options: ['flux', 'stable_diffusion', 'sd3', 'stable_cascade'].map((item) => ({ value: item, label: item })),
                  onPick: (value) => setClipType(value),
                  menuMinWidth: 160,
                  menuAlign: 'right',
                }),
              ),
            ],
            () => setModelsOpen(false),
          )
        : null

      const loraRow = (entry, index) =>
        h(
          'div',
          {
            key: entry.name,
            onDragOver: (event) => {
              event.preventDefault()
              if (dragLora !== null) setDropLora(index)
            },
            onDragLeave: () => setDropLora((current) => (current === index ? null : current)),
            onDrop: (event) => {
              event.preventDefault()
              moveLora(dragLora, index)
            },
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 6px',
              borderRadius: 7,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: dropLora === index && dragLora !== null ? '#3b82f6' : 'var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              opacity: dragLora === index ? 0.45 : 1,
            },
          },
          h(
            'span',
            {
              draggable: true,
              title: '拖动调整顺序',
              onDragStart: (event) => {
                setDragLora(index)
                const transfer = event.dataTransfer
                if (transfer) {
                  transfer.effectAllowed = 'move'
                  try {
                    transfer.setData('text/plain', String(index))
                  } catch {
                    // 状态里已经有 index 了
                  }
                }
              },
              onDragEnd: () => {
                setDragLora(null)
                setDropLora(null)
              },
              style: {
                flex: 'none',
                cursor: 'grab',
                fontSize: 12,
                lineHeight: 1,
                color: 'var(--dsw-alias-label-secondary)',
                userSelect: 'none',
              },
            },
            '⠿',
          ),
          h(
            'span',
            {
              title: entry.name,
              style: {
                flex: 1,
                minWidth: 0,
                fontSize: 10.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            entry.name,
          ),
          h('input', {
            type: 'number',
            step: 0.1,
            min: -2,
            max: 2,
            value: entry.strength,
            title: '权重（strength_model）',
            style: Object.assign({}, field, { width: 56, flex: 'none', padding: '3px 6px', fontSize: 10.5 }),
            onChange: (event) => setLoraStrength(index, event.target.value),
          }),
          h(
            'button',
            {
              type: 'button',
              title: '移除',
              onClick: () => removeLora(index),
              style: {
                flex: 'none',
                width: 20,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                borderRadius: 5,
                border: 0,
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
              },
            },
            '×',
          ),
        )

      const loraDialog = loraOpen
        ? dialogShell(
            '生成设置 · LoRA',
            [
              h(
                'div',
                { style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } },
                '按列表顺序依次串联在 UNET 之后，顺序会影响出图；拖动 ⠿ 调整。',
              ),
              ...(loraList.length > 0
                ? loraList.map(loraRow)
                : [
                    h(
                      'div',
                      { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', opacity: 0.8 } },
                      '还没有添加 LoRA',
                    ),
                  ]),
              h(
                'div',
                { style: { minWidth: 0 } },
                h(Dropdown, {
                  title: '从 models/loras 里选一个加进链条',
                  placeholder: loraOptions.length > 0 ? '+ 添加 LoRA' : '（没有发现 LoRA 文件）',
                  value: '',
                  options: loraOptions.map((name) => ({ value: name, label: name })),
                  onPick: (name) => addLora(name),
                  menuMinWidth: 300,
                  menuAlign: 'right',
                }),
              ),
              h(
                'div',
                { style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', opacity: 0.8 } },
                '最多 4 个 · 权重范围 -2 ~ 2，步进 0.1',
              ),
            ],
            () => setLoraOpen(false),
          )
        : null

      return h(
        'div',
        {
          className: props.night ? 'dshComfySurface-dark' : 'dshComfySurface-light',
          style: {
            display: 'flex',
            gap: 16,
            height: '100%',
            boxSizing: 'border-box',
            padding: 16,
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            overflow: 'hidden',
          },
        },
        h(
          'div',
          {
            style: {
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              borderRadius: 14,
              border: '1px solid var(--dsw-alias-border-l2)',
              overflow: 'hidden',
            },
          },
          // Back sits on the preview's own top-left corner, the same place the
          // other full-page modules put theirs, instead of in the control column.
          h(
            'div',
            { style: { position: 'absolute', left: 12, top: 12, zIndex: 6 } },
            h(
              'button',
              {
                type: 'button',
                className: 'dshComfyBackChip',
                title: '返回工作台',
                onClick: props.onBack,
              },
              h(Icon, { name: 'chevron-left', size: 14 }),
              '返回',
            ),
          ),
          h(ImageViewer, {
            key: selected,
            embedded: true,
            // Follows the workbench theme: the light skin below is hardcoded hex,
            // so leaving it on 'light' kept this pane white in dark mode.
            theme: props.night ? 'dark' : 'light',
            // Only this panel needs the prompt dialog: the album and the workspace
            // already show prompts in their own side panel.
            promptButton: true,
            images: gallery.map((file) => ({ url: file.url, filename: file.name })),
            startIndex: Math.max(0, gallery.findIndex((file) => file.name === selected)),
            filename: selected,
            onClose: () => {},
          }),
          // Live progress sits on the picture it is producing: that is where the
          // eye already is while the image renders, and it leaves the control
          // column free of a moving element.
          overlayShown
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    // Above the viewer's own floating controls (which top out in the
                    // sixties) but below the app's dialogs at 1000+.
                    zIndex: 70,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    background: 'rgba(8, 10, 14, 0.5)',
                    animation: overlayClosing
                      ? 'dshComfyOverlayOut 140ms ease-out both'
                      : 'dshComfyOverlayIn 160ms ease-out both',
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 9,
                      minWidth: 190,
                      padding: '16px 20px',
                      borderRadius: 14,
                      border: '1px solid rgba(255, 255, 255, 0.16)',
                      // Opaque: anything behind it (the picture, a blurred copy)
                      // would otherwise read as a faint second ring.
                      background: 'rgb(20, 22, 27)',
                      boxShadow: '0 12px 34px rgba(0, 0, 0, 0.45)',
                      color: '#ffffff',
                      animation: overlayClosing
                        ? 'dshComfyPanelOut 140ms ease-out both'
                        : 'dshComfyPanelIn 180ms cubic-bezier(.23, 1, .32, 1) both',
                    },
                  },
                  // Drawn, not bordered, and rotated by animating the dash offset
                  // rather than with a transform: a composited spinning layer is
                  // what left a second, larger ring smeared behind this one.
                  h(
                    'svg',
                    {
                      width: 22,
                      height: 22,
                      viewBox: '0 0 22 22',
                      'aria-hidden': 'true',
                      shapeRendering: 'geometricPrecision',
                      style: { display: 'block', flex: 'none', width: 22, height: 22 },
                    },
                    h('circle', {
                      cx: 11,
                      cy: 11,
                      r: 8.5,
                      fill: 'none',
                      stroke: 'rgba(255, 255, 255, 0.22)',
                      strokeWidth: 2,
                    }),
                    h('circle', {
                      cx: 11,
                      cy: 11,
                      r: 8.5,
                      fill: 'none',
                      stroke: '#3b82f6',
                      strokeWidth: 2,
                      strokeLinecap: 'round',
                      // Circumference at r=8.5 is exactly 53.407, so the dash and
                      // its gap add up to one full turn: the offset can loop from
                      // 0 to -53.407 without a visible jump.
                      strokeDasharray: '13.407 40',
                      transform: 'rotate(-90 11 11)',
                      className: 'dshComfySpinnerArc',
                      style: { animation: 'dshComfyRingSpin 0.9s linear infinite' },
                    }),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5 } },
                    h('span', { style: { fontWeight: 600 } }, job.status === 'running' ? '正在生成' : '排队中'),
                    job.progress
                      ? h(
                          'span',
                          { style: { fontVariantNumeric: 'tabular-nums', color: 'rgba(255, 255, 255, 0.72)' } },
                          job.progress.value + '/' + job.progress.max,
                        )
                      : null,
                    h(
                      'span',
                      { style: { fontVariantNumeric: 'tabular-nums', color: 'rgba(255, 255, 255, 0.55)' } },
                      jobElapsed + 's',
                    ),
                  ),
                  h(
                    'div',
                    {
                      style: {
                        width: 168,
                        height: 3,
                        borderRadius: 2,
                        overflow: 'hidden',
                        background: 'rgba(255, 255, 255, 0.18)',
                      },
                    },
                    h('div', {
                      style: {
                        height: '100%',
                        borderRadius: 2,
                        background: '#3b82f6',
                        transition: 'width 220ms ease',
                        width:
                          (job.progress
                            ? Math.max(4, Math.min(100, (job.progress.value / job.progress.max) * 100))
                            : 8) + '%',
                      },
                    }),
                  ),
                ),
              )
            : null,
          current
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    left: 12,
                    right: 12,
                    bottom: 72,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px 12px',
                    pointerEvents: 'none',
                    color: '#ffffff',
                    fontSize: 10.5,
                    lineHeight: 1.5,
                    textAlign: 'center',
                    textShadow: '0 1px 6px rgba(0, 0, 0, 0.8), 0 0 2px rgba(0, 0, 0, 0.6)',
                    zIndex: 2,
                  },
                },
                ...(() => {
                  const fm = fileMeta[current.name] || null
                  const sampler = fm && fm.sampler ? fm.sampler : null
                  const modelName = fm && Array.isArray(fm.models) && fm.models[0] ? fm.models[0].name : ''
                  const local = meta && meta[current.name] ? meta[current.name] : null
                  const parts = [h('span', { key: 'name', style: { fontWeight: 600 } }, current.name)]
                  const model = modelName || (local && local.model)
                  if (model) parts.push(h('span', { key: 'model' }, '模型 ' + model))
                  const steps =
                    sampler && sampler.steps !== null && sampler.steps !== undefined
                      ? sampler.steps
                      : local && local.steps
                  if (steps !== undefined && steps !== null) parts.push(h('span', { key: 'steps' }, '步数 ' + steps))
                  const cfg =
                    sampler && sampler.cfg !== null && sampler.cfg !== undefined ? sampler.cfg : local && local.cfg
                  if (cfg !== undefined && cfg !== null) parts.push(h('span', { key: 'cfg' }, 'CFG ' + cfg))
                  const samplerName = sampler && sampler.name ? sampler.name : local && local.sampler
                  if (samplerName) parts.push(h('span', { key: 'sampler' }, '采样器 ' + samplerName))
                  const scheduler = sampler && sampler.scheduler ? sampler.scheduler : local && local.scheduler
                  if (scheduler) parts.push(h('span', { key: 'scheduler' }, '调度 ' + scheduler))
                  const seed =
                    sampler && sampler.seed !== null && sampler.seed !== undefined ? sampler.seed : local && local.seed
                  if (seed !== undefined && seed !== null) parts.push(h('span', { key: 'seed' }, '种子 ' + seed))
                  return parts
                })(),
              )
            : null,
          busy
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    background: 'rgba(0, 0, 0, 0.45)',
                    backdropFilter: 'blur(2px)',
                    color: '#ffffff',
                  },
                },
                h('div', {
                  style: {
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    border: '3px solid rgba(255, 255, 255, 0.25)',
                    borderTopColor: '#ffffff',
                    animation: 'dshComfySpin 0.8s linear infinite',
                  },
                }),
                h('div', { style: { fontSize: 11.5 } }, '生成中…'),
              )
            : null,
        ),
        h(
          'div',
          {
            style: {
              width: 380,
              flex: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              paddingRight: 2,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30 } },
            h('div', { className: 'dshComfyShimmerTitle' }, '本地文生图'),
            h('span', { style: { flex: 1 } }),
            h(SurfaceThemeButton, { night: props.night, mode: props.themeMode, onClick: props.onTheme }),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, 'Prompt'),
              h('span', { style: { flex: 1 } }),
              // A quiet line so the joined prefix is never a surprise: it appears
              // only while the pin is actually being applied.
              pinActive
                ? h(
                    'span',
                    {
                      title: '生成时会自动拼在正文最前面',
                      style: {
                        fontSize: 9.5,
                        lineHeight: 1.2,
                        color: '#f59e0b',
                        whiteSpace: 'nowrap',
                      },
                    },
                    '已预置固定词',
                  )
                : null,
              // Pinned quality prefix: grey when unset, orange while it is being
              // applied to every submission.
              h(
                'button',
                {
                  type: 'button',
                  title: pinActive
                    ? '固定提示词已启用：生成时拼在正文前面（点击修改）'
                    : pinSet
                      ? '固定提示词已设置但停用（点击启用或修改）'
                      : '设置固定提示词：每次生成自动拼在正文前面',
                  onClick: () => setPinOpen(true),
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    flex: 'none',
                    padding: '2px 7px',
                    borderRadius: 6,
                    // Longhands on purpose: mixing the `border` shorthand with
                    // `borderStyle` makes React warn on every rerender.
                    borderWidth: 1,
                    borderStyle: pinSet && !pinActive ? 'dashed' : 'solid',
                    borderColor: pinActive ? '#f59e0b' : 'var(--dsw-alias-border-l2)',
                    background: pinActive ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
                    color: pinActive ? '#f59e0b' : 'var(--dsw-alias-label-secondary)',
                    fontSize: 9.5,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  },
                },
                h(Icon, { name: 'pin', size: 10 }),
                '钉住',
              ),
            ),
            h('textarea', {
              value: prompt,
              rows: 5,
              placeholder: '描述要画的图…（也可只写需求，用 AI 写/润色）',
              style: Object.assign({}, field, { resize: 'vertical', lineHeight: 1.55 }),
              onChange: (event) => setPrompt(event.target.value),
            }),
          h(
            'label',
            { style: label },
            'Negative',
            h('textarea', {
              value: negative,
              rows: 2,
              placeholder: '负面提示词（可选）',
              style: Object.assign({}, field, { resize: 'vertical', lineHeight: 1.5 }),
              onChange: (event) => setNegative(event.target.value),
            }),
          ),
            // The AI trio acts on the prompt above it, so it sits under the box.
            // The row spans the full column width: the style switch keeps its
            // natural size and the AI button absorbs the slack, so the row lines
            // up with the text boxes above and below.
            h(
              'div',
              { style: { display: 'flex', alignItems: 'stretch', gap: 4, width: '100%' } },
              // Compact variant: this row already holds buttons, so the switch
              // keeps their height instead of growing the row.
              h(SegmentToggle, {
                compact: true,
                style: { flex: 'none' },
                options: [
                  { value: 'tags', label: 'SD 标签' },
                  { value: 'natural', label: '自然语言' },
                ],
                value: promptStyle,
                onChange: setPromptStyle,
              }),
              h(
                'button',
                {
                  type: 'button',
                  disabled: aiBusy,
                  onClick: aiWrite,
                  title: 'AI 写 / 润色提示词',
                  className: 'dshComfyAiBtn',
                  // Colour, glow and motion come from .dshComfyAiBtn; only the
                  // box model stays inline. An inline background or shadow would
                  // outrank the hover rule and kill the effect.
                  style: {
                    flex: '1 1 auto',
                    minWidth: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    cursor: aiBusy ? 'default' : 'pointer',
                  },
                },
                h(Icon, { name: 'sparkles', size: 13 }),
                aiBusy ? '生成中…' : 'AI 写/润色',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setRulesOpen(true),
                  title: '编辑提示词写作规则',
                  style: {
                    flex: '0 0 auto',
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  },
                },
                '规则',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setHistoryOpen(true),
                  title: '查看提示词对话记录',
                  style: {
                    flex: '0 0 auto',
                    padding: '7px 9px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  },
                },
                '对话',
              ),
            ),
            h('textarea', {
              value: aiExtra,
              rows: 2,
              placeholder: '额外要求（可留空）：想让 AI 怎么改，例如更有电影感、补充材质细节',
              style: Object.assign({}, field, { resize: 'vertical', lineHeight: 1.5 }),
              onChange: (event) => setAiExtra(event.target.value),
            }),
            aiError
              ? h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-state-error-primary)' } }, aiError)
              : null,
          ),
          modelBar,
          loraBar,
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, '分辨率'),
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', {
                type: 'number',
                value: size && size.width ? size.width : 1024,
                style: Object.assign({}, field, { width: 84 }),
                onChange: (event) => setSize(Object.assign({}, size, { width: clampSize(event.target.value) })),
              }),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '×'),
              h('input', {
                type: 'number',
                value: size && size.height ? size.height : 1024,
                style: Object.assign({}, field, { width: 84 }),
                onChange: (event) => setSize(Object.assign({}, size, { height: clampSize(event.target.value) })),
              }),
              // The multiplier rides in the resolution row: the box on the left is
              // the framing, this number is how much of it to render.
              h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 } },
                h('span', { style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)' } }, '倍率'),
                h('input', {
                  type: 'number',
                  step: 0.1,
                  min: 0.25,
                  max: 4,
                  value: scaleFactor,
                  title:
                    '出图 ' +
                    outputSize.width +
                    ' × ' +
                    outputSize.height +
                    '（基准尺寸 × 倍率，按 8 对齐）',
                  style: Object.assign({}, field, { width: 72, padding: '7px 8px', flex: 'none' }),
                  onChange: (event) => {
                    const next = Number(event.target.value)
                    setScale(
                      Number.isFinite(next) && next > 0
                        ? Math.min(4, Math.max(0.25, Math.round(next * 100) / 100))
                        : 1,
                    )
                  },
                }),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
              [
                ['1:1', 1024, 1024],
                ['16:9', 1344, 768],
                ['9:16', 768, 1344],
                ['4:3', 1152, 864],
              ].map(([name, widthPx, heightPx]) =>
                h(
                  'button',
                  {
                    key: name,
                    type: 'button',
                    style: {
                      padding: '3px 7px',
                      borderRadius: 6,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-secondary)',
                      fontSize: 9.5,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                    },
                    onClick: () => preset(widthPx, heightPx),
                  },
                  name,
                ),
              ),
              // Only shown once the factor actually changes the size: the plain
              // case keeps the row quiet.
              scaleFactor !== 1
                ? h(
                    'span',
                    {
                      style: {
                        marginLeft: 'auto',
                        fontSize: 9.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      },
                    },
                    '→ ' + outputSize.width + ' × ' + outputSize.height,
                  )
                : null,
            ),
          ),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 } },
            h(
              'label',
              { style: label },
              '步数',
              h('input', {
                type: 'number',
                value: sampling && sampling.steps ? sampling.steps : 20,
                style: field,
                onChange: (event) => updateSampling({ steps: Math.max(1, Math.round(Number(event.target.value) || 20)) }),
              }),
            ),
            h(
              'label',
              { style: label },
              'CFG',
              h('input', {
                type: 'number',
                step: 0.1,
                value: sampling && sampling.cfg !== undefined ? sampling.cfg : 1,
                style: field,
                onChange: (event) => updateSampling({ cfg: Number(event.target.value) || 1 }),
              }),
            ),
            h(
              'label',
              { style: label },
              '采样器',
              h('input', {
                value: (sampling && sampling.sampler) || 'euler',
                style: field,
                onChange: (event) => updateSampling({ sampler: event.target.value }),
              }),
            ),
            h(
              'label',
              { style: label },
              '调度器',
              h('input', {
                value: (sampling && sampling.scheduler) || 'simple',
                style: field,
                onChange: (event) => updateSampling({ scheduler: event.target.value }),
              }),
            ),
          ),
          // The live count lives on the preview overlay; this line only carries the
          // plain result text (submitted / finished / failed).
          status ? h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, status) : null,
          error ? h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
          // Seed sits above the action: it is read as a parameter of the run the
          // button below is about to start.
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 } },
            h(
              'label',
              { style: label },
              '种子',
              h('input', {
                type: 'number',
                value: sampling && sampling.seed !== undefined ? sampling.seed : 0,
                // Random mode picks the seed at submit time, so typing here would
                // be overwritten a moment later.
                disabled: randomSeed,
                title: randomSeed ? '随机模式下由每次生成决定种子' : '固定种子',
                style: Object.assign({}, field, { opacity: randomSeed ? 0.55 : 1 }),
                onChange: (event) => updateSampling({ seed: Math.max(0, Math.floor(Number(event.target.value) || 0)) }),
              }),
            ),
            // It is a mode, not a one-shot: once on, every generation gets a fresh
            // seed and the field is locked.
            h(
              'div',
              { style: { display: 'flex', alignItems: 'flex-end' } },
              h(
                'button',
                {
                  type: 'button',
                  title: randomSeed
                    ? '随机模式已开启：每次生成都换一个种子（点击关闭）'
                    : '开启随机模式：每次生成自动换一个种子',
                  onClick: () => {
                    const nextMode = randomSeed ? 'fixed' : 'random'
                    const patch = { seedMode: nextMode }
                    if (nextMode === 'random') patch.seed = Math.floor(Math.random() * 1e15)
                    updateSampling(patch)
                  },
                  style: {
                    width: '100%',
                    // Same box as the inputs beside it, so the row lines up.
                    boxSizing: 'border-box',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '7px 10px',
                    borderRadius: 9,
                    border: '1px solid ' + (randomSeed ? '#3b82f6' : 'var(--dsw-alias-border-l2)'),
                    background: randomSeed ? '#3b82f6' : 'var(--dsw-alias-bg-layer-2)',
                    color: randomSeed ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                    fontSize: 11.5,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease',
                  },
                },
                h(Icon, { name: 'shuffle', size: 13 }),
                '随机',
              ),
            ),
          ),
          // The action closes the column, so it is always the last thing under the
          // list of settings it applies.
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: generate,
              style: {
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #3b82f6',
                background: '#3b82f6',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
              },
            },
            busy ? '生成中…' : '生成',
          ),
        ),
        modelDialog,
        loraDialog,
        h(PromptRulesDialog, { open: rulesOpen, onClose: () => setRulesOpen(false) }),
          h(PromptHistoryDialog, { open: historyOpen, onClose: () => setHistoryOpen(false) }),
        h(PinnedPromptDialog, {
          open: pinOpen,
          positive: pinPositive,
          negative: pinNegative,
          enabled: pinEnabled !== false,
          samplePrompt: prompt,
          sampleNegative: negative,
          onClose: () => setPinOpen(false),
          onSave: (next) => {
            setPinPositive(next.positive)
            setPinNegative(next.negative)
            setPinEnabled(next.enabled)
            setPinOpen(false)
          },
        }),
        viewerOpen && gallery.length > 0
          ? h(ImageViewer, {
              images: gallery.map((file) => ({ url: file.url, filename: file.name })),
              startIndex: Math.max(0, Math.min(viewerIndex, gallery.length - 1)),
              filename: gallery[viewerIndex] ? gallery[viewerIndex].name : '',
              onClose: () => setViewerOpen(false),
            })
          : null,
      )
    }

    function CanvasWorkspace() {
      // Surface tokens live in this sheet, and the panel views mount nothing else.
      ensureWorkbenchStyle()
      const [view, setView] = usePref('workspaceView')
      const [viewFading, setViewFading] = useState(false)
      const changeView = (next) => {
        if (next === view) return
        setViewFading(true)
        setTimeout(() => {
          setView(next)
          setViewFading(false)
        }, 150)
      }
      const [enabled] = usePref('canvasWorkspace')
      // 'auto' (default) follows the host theme; clicking overrides it manually.
      const surfaceTheme = useSurfaceTheme('workspaceTheme')
      const canvasNight = surfaceTheme.night
      const [canvasModels, setCanvasModels] = usePref('workspaceCanvasModels')
      const canvasModelsRef = useRef(canvasModels)
      canvasModelsRef.current = canvasModels
      const [rulerOn, setRulerOn] = usePref('workspaceCanvasRuler')
      const [files, setFiles] = useState(null)
      const [file, setFile] = usePref('workspaceFile')
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
      const [importOpen, setImportOpen] = useState(false)
      const [importBusy, setImportBusy] = useState(false)
      const [error, setError] = useState('')
      const [preview, setPreview] = useState(false)
      const [modelPanel, setModelPanel] = useState(false)
      const [albumOpen, setAlbumOpen] = useState(false)
      const [albumClosing, setAlbumClosing] = useState(false)
      const [quickMissing, setQuickMissing] = useState(null)
      const [job, setJob] = useState(() => jobStore.get())
      const [jobClock, setJobClock] = useState(() => Date.now())
      /** Prompt id this workspace submitted; its result becomes the new reference. */
      const pendingJobRef = useRef('')
      const [referenceUrl, setReferenceUrl] = useState('')
      const [referenceOptions, setReferenceOptions] = useState([])
      const [referenceOpacity, setReferenceOpacity] = useState(55)
      const [negative, setNegative] = useState('')
      const [polishMode, setPolishMode] = useState('single')
      const [polishInstruction, setPolishInstruction] = useState('')
      const [polishChatOpen, setPolishChatOpen] = useState(false)
      const [polishEffort, setPolishEffort] = usePref('workspacePolishEffort')
      const [promptWriteProvider, setPromptWriteProvider] = usePref('promptWriteProvider')
      const [promptWriteModel, setPromptWriteModel] = usePref('promptWriteModel')
      const [snapshotOpen, setSnapshotOpen] = useState(false)
      const [snapshots, setSnapshots] = useState(() => loadSnapshotList())
      // The polish run lives at module scope: switching panels must not stop the
      // stream, and coming back should restore the live state.
      const [polish, setPolish] = useState(() => polishStore.get())
      const streamRef = useRef(null)
      useEffect(() => {
        let lastStatus = ''
        let lastMessage = ''
        let lastResult = undefined
        let lastHistory = undefined
        const apply = () => {
          const next = polishStore.get()
          // Streaming text is written straight to the DOM: re-rendering the whole
          // board once per token froze the page.
          if (streamRef.current) streamRef.current.textContent = next.stream || ''
          if (
            next.status !== lastStatus ||
            next.message !== lastMessage ||
            next.result !== lastResult ||
            next.history !== lastHistory
          ) {
            lastStatus = next.status
            lastMessage = next.message
            lastResult = next.result
            lastHistory = next.history
            setPolish(next)
          }
        }
        apply()
        return polishStore.subscribe(apply)
      }, [])
      const polishBusy = polish.status === 'running'
      const polishResult = polish.result
      const polishMsg = polish.message
      const polishHistory = polish.history
      // Reasoning tiers are per model: offer the ones the picked route actually
      // advertises, and the classic quartet only when the catalog knows nothing.
      const llmCatalog = useLlmCatalog()
      const polishEfforts = (() => {
        const hit = catalogModelOf(llmCatalog.catalog, promptWriteProvider, promptWriteModel)
        const efforts = hit && Array.isArray(hit.efforts) ? hit.efforts : []
        if (efforts.length === 0) {
          return [
            { value: '', label: '思考：默认' },
            { value: 'off', label: '思考：Off' },
            { value: 'low', label: '思考：Low' },
            { value: 'high', label: '思考：High' },
            { value: 'max', label: '思考：Max' },
          ]
        }
        return [{ value: '', label: '思考：默认' }].concat(
          efforts.map((effort) => ({ value: effort.id, label: '思考：' + (effort.name || effort.id) })),
        )
      })()
      const [panelWidth, setPanelWidthPref] = usePref('workspacePanelWidth')
      const [livePanelWidth, setLivePanelWidth] = useState(null)
      const panelDragRef = useRef(null)
      const [zoom, setZoom] = useState(1)
      const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 })
      const [zooming, setZooming] = useState(false)
      const zoomTimerRef = useRef(null)
      const stageRef = useRef(null)
      const [viewing, setViewing] = useState(false)
      const [pan, setPan] = useState({ x: 0, y: 0 })
      const panDragRef = useRef(null)
      const lastMiddleDownRef = useRef(0)
      const [albumMetaByUrl, setAlbumMetaByUrl] = useState({})
      const [albumPick, setAlbumPick] = useState('')
      const [albumZoom, setAlbumZoom] = useState({ scale: 1, x: 0, y: 0 })
      const albumZoomRef = useRef(null)
      const [albumSource, setAlbumSource] = useState('plugin')
      const [outputFiles, setOutputFiles] = useState([])
      // The engine's folder can hold hundreds of files; cap what the grid mounts.
      const albumList = albumSource === 'output' ? outputFiles.slice(0, 60) : referenceOptions
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
            if (list.length > 0) {
              const saved = pluginPrefs.get().workspaceFile
              const valid = typeof saved === 'string' && list.some((item) => item.name === saved)
              setFile(valid ? saved : list[0].name)
            }
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
          }
        }
        let refreshTimer = null
        const refreshSoon = () => {
          if (!alive) return
          load()
          if (refreshTimer) clearTimeout(refreshTimer)
          refreshTimer = setTimeout(() => {
            refreshTimer = null
            if (alive) load()
          }, 2500)
        }
        load()
        const unsubscribeEvents = comfyEvents.subscribe((event) => {
          const type = event && event.type
          if (type === 'execution_success' || type === 'executed') refreshSoon()
        })
        return () => {
          alive = false
          if (refreshTimer) clearTimeout(refreshTimer)
          unsubscribeEvents()
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

      // Wheel zooms toward the cursor; opening another image resets the view.
      useEffect(() => {
        setAlbumZoom({ scale: 1, x: 0, y: 0 })
      }, [albumPick])
      useEffect(() => {
        if (!albumOpen || !albumPick) return undefined
        const node = albumZoomRef.current
        if (!node) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const rect = node.getBoundingClientRect()
          const mx = event.clientX - rect.left - rect.width / 2
          const my = event.clientY - rect.top - rect.height / 2
          setAlbumZoom((current) => {
            const nextScale = clamp(current.scale * (event.deltaY < 0 ? 1.12 : 0.89), 0.5, 5)
            const ratio = nextScale / current.scale
            // Keep the point under the cursor fixed while scaling.
            return {
              scale: nextScale,
              x: mx - ratio * (mx - current.x),
              y: my - ratio * (my - current.y),
            }
          })
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [albumOpen, albumPick])

      // Esc steps back one level: preview → grid, grid → closed.
      useEffect(() => {
        if (!albumOpen) return undefined
        const onKey = (event) => {
          if (event.isComposing) return
          if (
            (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
            albumPick &&
            albumList.length > 1
          ) {
            event.preventDefault()
            event.stopPropagation()
            const direction = event.key === 'ArrowLeft' ? -1 : 1
            const at = albumList.findIndex((option) => option.url === albumPick)
            if (at >= 0) {
              const next = (at + direction + albumList.length) % albumList.length
              setAlbumPick(albumList[next].url)
            }
            return
          }
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          if (albumPick) setAlbumPick('')
          else closeAlbum()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [albumOpen, albumPick, albumList])

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
            const stored = readDraft(file, WORKSPACE_DRAFT_PREFIX)
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
          }, WORKSPACE_DRAFT_PREFIX)
        }, 400)
        return () => clearTimeout(timer)
      }, [file, dirty, size, ratio, megapixels, multiple, summary, boxes, guides, referenceUrl, referenceOpacity, negative])

      useEffect(() => jobStore.subscribe(() => setJob(jobStore.get())), [])

      // Polish chat history, kept per workflow file.
      const polishKey = 'dsh.comfy-canvas.polish.' + encodeURIComponent(String(file || ''))
      useEffect(() => {
        try {
          const raw = localStorage.getItem(polishKey)
          const parsed = raw ? JSON.parse(raw) : null
          polishStore.setHistory(parsed && Array.isArray(parsed.messages) ? parsed.messages : [])
        } catch {
          polishStore.setHistory([])
        }
      }, [polishKey])

      // Wheel zooms the board around the cursor; boxes fade and the reference
      // goes full opacity while scaling so the freshly generated picture can be
      // inspected underneath the layout.
      useEffect(() => {
        const node = stageRef.current
        if (!node) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const rect = node.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return
          setZoomOrigin({
            x: ((event.clientX - rect.left) / rect.width) * 100,
            y: ((event.clientY - rect.top) / rect.height) * 100,
          })
          setZoom((current) => clamp(current * (event.deltaY < 0 ? 1.12 : 0.89), 0.5, 4))
          setZooming(true)
          if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
          zoomTimerRef.current = setTimeout(() => {
            zoomTimerRef.current = null
            setZooming(false)
          }, 700)
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => {
          node.removeEventListener('wheel', onWheel)
          if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
        }
      }, [])

      // Middle-button drag: hide the boxes and pan the board to inspect the
      // reference picture without leaving the workspace.
      useEffect(() => {
        if (!viewing) return undefined
        const onMove = (event) => {
          const drag = panDragRef.current
          if (!drag) return
          setPan({
            x: drag.startPanX + (event.clientX - drag.startX),
            y: drag.startPanY + (event.clientY - drag.startY),
          })
        }
        const onUp = () => {
          panDragRef.current = null
          setViewing(false)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }, [viewing])

      // The picture this workspace just produced becomes the reference underlay,
      // so the next pass can trace the result it got.
      useEffect(() => {
        if (!job || job.status !== 'done' || !job.imageUrl) return
        if (!job.id || pendingJobRef.current !== job.id) return
        pendingJobRef.current = ''
        setReferenceUrl(job.imageUrl)
        setDirty(true)
      }, [job])

      // Settled jobs must replace the stale "已提交，正在生成" note in the header.
      useEffect(() => {
        if (!job) return
        if (job.status === 'done') setStatus('生成完成')
        else if (job.status === 'error') setStatus(job.message || '生成失败')
      }, [job])

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
        const plainPrompt = String(summary || '').trim()
        if (boxes.length === 0 && !plainPrompt) {
          setStatus('画布上还没有框：可以先写整图描述做文生图')
          return
        }
        const layout = boxes.length > 0 ? buildMossLayout(summary, size.width, size.height, boxes) : null
        const stored = canvasModelsRef.current || {}
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
              plainPrompt: boxes.length === 0 ? plainPrompt : '',
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
          pendingJobRef.current = data.promptId || ''
          jobStore.start(data.promptId, 'canvas')
          setStatus('已提交，正在生成')
        } catch (err) {
          setStatus('提交失败：' + String((err && err.message) || err))
        }
      }

      const polishTotals = polishHistory.reduce(
        (acc, turn) => {
          if (!turn || turn.role !== 'assistant' || !turn.tokens) return acc
          acc.input += Number(turn.tokens.inputTokens) || 0
          acc.output += Number(turn.tokens.outputTokens) || 0
          return acc
        },
        { input: 0, output: 0 },
      )

      const formatTokens = (usage) => {
        if (!usage) return ''
        const input = Number(usage.inputTokens) || 0
        const output = Number(usage.outputTokens) || 0
        const total = Number(usage.totalTokens) || input + output
        return 'token 输入 ' + input + ' / 输出 ' + output + ' / 合计 ' + total
      }

      const parsePolishJson = (text) => {
        let raw = String(text || '').trim()
        const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw)
        if (fence) raw = fence[1].trim()
        try {
          const parsed = JSON.parse(raw)
          const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : null
          if (!items) return null
          return items
            .map((item) => ({
              id: item && item.id !== undefined ? String(item.id) : '',
              text: item && typeof item.text === 'string' ? item.text : '',
            }))
            .filter((item) => item.text)
        } catch {
          return null
        }
      }

      const runPolishNow = () => {
        const instruction = polishInstruction.trim()
        const mode = polishMode === 'board' ? 'board' : 'single'
        const selectedBox = selected !== null && boxes[selected] ? boxes[selected] : null
        const describe = (box) => {
          const meta = box.metadata || {}
          return meta.type === 'text' ? String(meta.text || '') : String(meta.desc || '')
        }
        const targets =
          mode === 'board'
            ? boxes.map((box, index) => ({
                id: String(index),
                kind: (box.metadata || {}).type === 'text' ? 'text' : 'obj',
                text: describe(box),
              }))
            : selectedBox
              ? [
                  {
                    id: String(selected),
                    kind: (selectedBox.metadata || {}).type === 'text' ? 'text' : 'obj',
                    text: describe(selectedBox),
                  },
                ]
              : []
        polishStore.start({
          mode,
          instruction,
          targets,
          summary,
          history: polishHistory,
          effort: polishEffort,
          provider: promptWriteProvider,
          model: promptWriteModel,
          key: polishKey,
        })
      }

      const applyPolish = () => {
        if (!polishResult) return
        if (polishResult.items) {
          const items = polishResult.items
          const matched = boxes.filter((box, index) => items.some((item) => item.id === String(index))).length
          setBoxes((current) =>
            current.map((box, index) => {
              const hit = items.find((item) => item.id === String(index))
              if (!hit) return box
              const meta = box.metadata || {}
              return Object.assign({}, box, {
                metadata: Object.assign({}, meta, meta.type === 'text' ? { text: hit.text } : { desc: hit.text }),
              })
            }),
          )
          setDirty(true)
          polishStore.setMessage('已写入 ' + matched + ' 个框')
          return
        }
        if (selected === null) {
          polishStore.setMessage('先选中一个框')
          return
        }
        const box = boxes[selected]
        if (!box) return
        const meta = box.metadata || {}
        changeBox(selected, {
          metadata: Object.assign({}, meta, meta.type === 'text' ? { text: polishResult.text } : { desc: polishResult.text }),
        })
        polishStore.setMessage('已写入当前框')
      }

      const clearPolishChat = () => {
        polishStore.clear(polishKey)
      }

      /** Freeze the whole board into a named archive that can be reloaded later. */
      const saveSnapshotNow = () => {
        const entry = {
          id: 'snap-' + Date.now().toString(36),
          name: (file ? file.replace(/\.json$/i, '') : '画板') + ' · ' + new Date().toLocaleString(),
          savedAt: Date.now(),
          file,
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
        }
        const next = [entry, ...loadSnapshotList()].slice(0, 50)
        persistSnapshots(next)
        setSnapshots(next)
        setStatus('已保存画板：' + entry.name)
        // Thumbnail is written asynchronously so saving stays instant.
        makeThumbnail(referenceUrl).then((thumb) => {
          if (!thumb) return
          const current = loadSnapshotList()
          const updated = current.map((item) => (item && item.id === entry.id ? Object.assign({}, item, { thumb }) : item))
          persistSnapshots(updated)
          setSnapshots(updated)
        })
      }

      /** Fill a missing preview when the user hovers a legacy snapshot. */
      const thumbSnapshot = (entry) => {
        if (!entry || entry.thumb || !entry.referenceUrl) return
        makeThumbnail(entry.referenceUrl).then((thumb) => {
          if (!thumb) return
          const current = loadSnapshotList()
          const updated = current.map((item) => (item && item.id === entry.id ? Object.assign({}, item, { thumb }) : item))
          persistSnapshots(updated)
          setSnapshots(updated)
        })
      }

      const applySnapshot = (entry) => {
        if (!entry) return
        const useWidth = typeof entry.width === 'number' ? entry.width : size.width
        const useHeight = typeof entry.height === 'number' ? entry.height : size.height
        setSize({ width: useWidth, height: useHeight })
        if (typeof entry.ratio === 'string') setRatio(entry.ratio)
        if (typeof entry.megapixels === 'number') setMegapixels(entry.megapixels)
        if (typeof entry.multiple === 'number') setMultiple(entry.multiple)
        setSummary(typeof entry.summary === 'string' ? entry.summary : '')
        setBoxes(sanitizeBoxes(Array.isArray(entry.boxes) ? entry.boxes : [], useWidth, useHeight))
        setGuides(Array.isArray(entry.guides) ? entry.guides.map(normalizeGuide).filter(Boolean) : [])
        setReferenceUrl(typeof entry.referenceUrl === 'string' ? entry.referenceUrl : '')
        setReferenceOpacity(typeof entry.referenceOpacity === 'number' ? clamp(entry.referenceOpacity, 0, 100) : 55)
        setNegative(typeof entry.negative === 'string' ? entry.negative : '')
        setSelected(null)
        setDirty(true)
        setSnapshotOpen(false)
        setStatus('已载入画板：' + entry.name)
      }

      /** Layout-JSON item (abs_centralized yxyx) to one canvas box. */
      const layoutItemToBox = (item, width, height) => {
        const bbox = Array.isArray(item && item.bbox) ? item.bbox.map(Number) : null
        if (!bbox || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) return null
        const [y1, x1, y2, x2] = bbox
        return {
          x: width / 2 + Math.min(x1, x2),
          y: height / 2 + Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
          metadata: {
            type: item.label === 'text' ? 'text' : item.label || 'object',
            character: item.label === 'character',
            desc: typeof item.caption === 'string' ? item.caption : '',
          },
        }
      }

      /** Fill the board (boxes, summary, ratio/MP, seed) from the reference image. */
      const importReferenceBoard = async () => {
        const reference = referenceUrl
        if (!reference) {
          setStatus('先选择参考图')
          setImportOpen(false)
          return
        }
        let filename = ''
        try {
          filename = new URL(reference, window.location.origin).searchParams.get('filename') || ''
        } catch {
          filename = ''
        }
        if (!filename) {
          setStatus('本地参考图没有画板参数')
          setImportOpen(false)
          return
        }
        setImportBusy(true)
        try {
          const res = await fetch('/plugin/comfy-status/output-meta?filename=' + encodeURIComponent(filename), {
            cache: 'no-store',
          })
          const data = await res.json().catch(() => null)
          const meta = data && data.ok ? data.meta : null
          let layout = meta && meta.layout ? meta.layout : null
          // The plugin's own generations carry the layout in the positive prompt
          // instead of a MOSSImageLayoutPrompt node.
          if (!layout && meta && meta.positive) {
            const raw =
              typeof meta.positive.raw === 'string'
                ? meta.positive.raw
                : typeof meta.positive.text === 'string'
                  ? meta.positive.text
                  : ''
            if (raw) {
              try {
                const parsed = JSON.parse(raw)
                if (parsed && typeof parsed === 'object') layout = parsed
              } catch {
                // Not a layout prompt: nothing to import.
              }
            }
          }
          const items = layout && Array.isArray(layout.items) ? layout.items : []
          if (!layout || items.length === 0) {
            setStatus('参考图里没有画板参数')
            setImportOpen(false)
            return
          }
          const width = meta && meta.size && Number.isFinite(meta.size.width) ? meta.size.width : size.width
          const height = meta && meta.size && Number.isFinite(meta.size.height) ? meta.size.height : size.height
          const summaryText =
            layout.summary && typeof layout.summary.caption === 'string'
              ? layout.summary.caption
              : typeof layout.summary === 'string'
                ? layout.summary
                : ''
          const nextBoxes = items.map((item) => layoutItemToBox(item, width, height)).filter(Boolean)
          setSize({ width, height })
          if (meta.resolution) {
            if (typeof meta.resolution.ratio === 'string') setRatio(meta.resolution.ratio)
            if (typeof meta.resolution.megapixels === 'number') setMegapixels(meta.resolution.megapixels)
            if (typeof meta.resolution.multiple === 'number') setMultiple(meta.resolution.multiple)
          }
          setSummary(summaryText)
          setBoxes(sanitizeBoxes(nextBoxes, width, height))
          if (meta.sampler && typeof meta.sampler.seed === 'number') {
            setCanvasModels({
              ...canvasModels,
              sampling: { ...(canvasModels.sampling || {}), seed: meta.sampler.seed },
            })
          }
          setSelected(null)
          setDirty(true)
          setStatus('已从参考图导入画板')
        } catch (error) {
          setStatus('读取参考图失败：' + String((error && error.message) || error))
        } finally {
          setImportBusy(false)
          setImportOpen(false)
        }
      }

      const removeSnapshot = (id) => {
        const next = loadSnapshotList().filter((item) => item && item.id !== id)
        persistSnapshots(next)
        setSnapshots(next)
      }

      /** Copy the sidebar's canvas-tab board into this workspace (one shot). */
      const importFromSidebar = () => {
        if (!file) return
        const source = readDraft(file)
        if (!source) {
          setStatus('侧边栏没有可导入的画板')
          return
        }
        const useWidth = typeof source.width === 'number' ? source.width : size.width
        const useHeight = typeof source.height === 'number' ? source.height : size.height
        setSize({ width: useWidth, height: useHeight })
        if (typeof source.ratio === 'string') setRatio(source.ratio)
        if (typeof source.megapixels === 'number') setMegapixels(source.megapixels)
        if (typeof source.multiple === 'number') setMultiple(source.multiple)
        setSummary(typeof source.summary === 'string' ? source.summary : '')
        setBoxes(sanitizeBoxes(source.boxes || [], useWidth, useHeight))
        setGuides(Array.isArray(source.guides) ? source.guides.map(normalizeGuide).filter(Boolean) : [])
        setReferenceUrl(typeof source.referenceUrl === 'string' ? source.referenceUrl : '')
        setReferenceOpacity(
          typeof source.referenceOpacity === 'number' ? clamp(source.referenceOpacity, 0, 100) : 55,
        )
        setNegative(typeof source.negative === 'string' ? source.negative : '')
        setSelected(null)
        setDirty(true)
        setStatus('已从侧边栏导入画板')
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
        ? h(
            'div',
            { style: EMPTY },
            error,
            /CreateBoundingBoxes|没有画板|工作流/.test(String(error))
              ? null
              : h(LaunchComfyButton, { marginTop: 8 }),
          )
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
                  transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')',
                  transformOrigin: zoomOrigin.x + '% ' + zoomOrigin.y + '%',
                  transition: 'transform .12s ease-out',
                },
              },
              h(RulerLayer, {
                width: size.width,
                height: size.height,
                rulerOn,
                guides: viewing ? [] : guides,
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
                rotatable: true,
                showDimensions: true,
                dimBoxes: zooming,
                hideBoxes: viewing,
                reference: referenceUrl
                  ? { url: referenceUrl, opacity: zooming || viewing ? 1 : referenceOpacity / 100 }
                  : null,
              }),
            )

      if (view === 'chooser' || view === 'online' || view === 'text2img') {
        return h(
          'div',
          {
            key: view,
            style: {
              height: '100%',
              opacity: viewFading ? 0 : 1,
              transition: 'opacity 150ms ease',
              animation: 'dshPageIn 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
            },
          },
          view === 'chooser'
            ? h(WorkbenchChooser, { onPick: changeView })
            : view === 'online'
              ? h(OnlineImagePanel, {
                  onBack: () => changeView('chooser'),
                  night: canvasNight,
                  themeMode: surfaceTheme.mode,
                  onTheme: surfaceTheme.cycle,
                })
              : h(
                  WorkbenchBoundary,
                  null,
                  h(LocalText2ImgPanel, {
                    onBack: () => changeView('chooser'),
                    night: canvasNight,
                    themeMode: surfaceTheme.mode,
                    onTheme: surfaceTheme.cycle,
                  }),
                ),
        )
      }

      return h(
        'div',
        {
          style: Object.assign({}, WORKSPACE_SHELL, {
            animation: 'dshPageIn 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
          }),
          className: canvasNight ? 'dshComfySurface-dark' : 'dshComfySurface-light',
        },
        h(Styles),
        h(
          'div',
          { style: WORKSPACE_TOOLBAR, className: 'dshComfyWorkbenchBar' },
          importOpen
            ? h(
                'div',
                {
                  style: {
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1300,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.45)',
                  },
                  onClick: (event) => {
                    if (event.target === event.currentTarget) setImportOpen(false)
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      width: 380,
                      maxWidth: 'calc(100vw - 40px)',
                      padding: '16px 18px',
                      borderRadius: 12,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-base)',
                      boxShadow: '0 24px 64px rgba(0, 0, 0, 0.35)',
                    },
                  },
                  h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 8 } }, '导入参考图画板'),
                  h(
                    'div',
                    { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
                    '将会覆盖当前的画板设置（画框、整图描述、比例 / MP、种子），是否确认填入参考图的画板参数？',
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 } },
                    h('button', { className: 'dshCanvasBtn', onClick: () => setImportOpen(false) }, '取消'),
                    h(
                      'button',
                      {
                        className: 'dshCanvasBtn',
                        style: { background: '#3b82f6', borderColor: '#3b82f6', color: '#ffffff' },
                        disabled: importBusy,
                        onClick: importReferenceBoard,
                      },
                      importBusy ? '导入中…' : '确认填入',
                    ),
                  ),
                ),
              )
            : null,
          h(
            'button',
            {
              title: '返回工作台选择',
              onClick: () => changeView('chooser'),
              style: {
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-2)',
                color: 'var(--dsw-alias-label-primary)',
                cursor: 'pointer',
                transition: 'transform .16s ease, box-shadow .16s ease',
              },
              onMouseEnter: (event) => {
                event.currentTarget.style.transform = 'translateY(-1px)'
                event.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'
              },
              onMouseLeave: (event) => {
                event.currentTarget.style.transform = 'none'
                event.currentTarget.style.boxShadow = 'none'
              },
            },
            h(
              'svg',
              { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('path', { d: 'M19 12H5' }),
              h('path', { d: 'm12 19-7-7 7-7' }),
            ),
          ),
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
          h(
            'button',
            {
              className: 'dshCanvasBtn',
              style: { flexShrink: 0 },
              title: '把侧边栏画框标签页的当前画板复制到这个工作台',
              onClick: importFromSidebar,
            },
            '导入侧边栏',
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
          h(
            'button',
            {
              type: 'button',
              className: 'dshCanvasBtn',
              style: { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 },
              title: '读取参考图的画板参数（画框、描述、比例、MP、种子）覆盖当前画板',
              onClick: () => setImportOpen(true),
            },
            h(Icon, { name: 'scan', size: 12 }),
            h('span', null, '取画板'),
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
                job.progress
                  ? h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          color: 'rgba(255, 107, 107, 0.85)',
                          fontVariantNumeric: 'tabular-nums',
                        },
                      },
                      job.progress.value + '/' + job.progress.max,
                    )
                  : null,
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
              },
              onClick: quickGenerate,
            },
            '快速生成',
          ),
          // Theme switch closes the row, like every other header in this plugin.
          h(SurfaceThemeButton, {
            night: canvasNight,
            mode: surfaceTheme.mode,
            onClick: surfaceTheme.cycle,
          }),
        ),
        h(
          'div',
          { style: WORKSPACE_BODY },
          h(
            'div',
            {
              ref: stageRef,
              style: WORKSPACE_STAGE,
              onMouseDown: (event) => {
                // Suppress the middle-button autoscroll.
                if (event.button === 1) event.preventDefault()
              },
              onPointerDown: (event) => {
                if (event.button !== 1) return
                event.preventDefault()
                // Middle double click resets zoom and pan.
                const now = Date.now()
                if (now - lastMiddleDownRef.current < 350) {
                  lastMiddleDownRef.current = 0
                  setZoom(1)
                  setZoomOrigin({ x: 50, y: 50 })
                  setPan({ x: 0, y: 0 })
                  panDragRef.current = null
                  setViewing(false)
                  return
                }
                lastMiddleDownRef.current = now
                panDragRef.current = {
                  startX: event.clientX,
                  startY: event.clientY,
                  startPanX: pan.x,
                  startPanY: pan.y,
                }
                setViewing(true)
              },
            },
            stageContent,
            h(
              'div',
              {
                style: {
                  position: 'absolute',
                  top: 10,
                  left: 12,
                  zIndex: 20,
                  display: 'flex',
                  gap: 6,
                },
              },
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  style: { padding: '3px 8px', fontSize: 10.5 },
                  onClick: saveSnapshotNow,
                },
                '保存画板',
              ),
              h(
                'button',
                {
                  className: 'dshCanvasBtn',
                  style: { padding: '3px 8px', fontSize: 10.5 },
                  onClick: () => {
                    setSnapshots(loadSnapshotList())
                    setSnapshotOpen(!snapshotOpen)
                  },
                },
                '档案',
              ),
              snapshotOpen
                ? h(
                    'div',
                    {
                      style: {
                        position: 'absolute',
                        top: 32,
                        left: 0,
                        width: 300,
                        maxHeight: 280,
                        overflowY: 'auto',
                        padding: 6,
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l2)',
                        background: 'var(--dsw-alias-bg-base)',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
                      },
                    },
                    snapshots.length === 0
                      ? h(
                          'div',
                          { style: { padding: 6, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                          '还没有保存的画板',
                        )
                      : snapshots.map((entry) =>
                          h(
                            'div',
                            {
                              key: entry.id,
                              style: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' },
                            },
                            h(
                              'button',
                              {
                                className: 'dshCanvasBtn',
                                style: {
                                  flex: 1,
                                  minWidth: 0,
                                  textAlign: 'left',
                                  fontSize: 10.5,
                                  padding: '3px 6px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                                title: entry.name,
                                onClick: () => applySnapshot(entry),
                                onMouseEnter: () => thumbSnapshot(entry),
                              },
                              entry.name + ' · ' + (entry.width || '?') + '×' + (entry.height || '?'),
                            ),
                            entry.thumb
                              ? h('img', {
                                  src: entry.thumb,
                                  alt: '',
                                  style: {
                                    width: 24,
                                    height: 24,
                                    objectFit: 'cover',
                                    borderRadius: 5,
                                    border: '1px solid var(--dsw-alias-border-l2)',
                                    flex: 'none',
                                  },
                                })
                              : null,
                            h(
                              'button',
                              {
                                className: 'dshCanvasBtn',
                                style: { padding: '2px 6px', fontSize: 10, flex: 'none' },
                                onClick: () => removeSnapshot(entry.id),
                              },
                              '删',
                            ),
                          ),
                        ),
                  )
                : null,
            ),
            h(
              'div',
              {
                style: {
                  position: 'absolute',
                  right: 12,
                  bottom: 8,
                  fontSize: 10,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--dsw-alias-label-secondary)',
                  opacity: 0.75,
                  pointerEvents: 'none',
                  userSelect: 'none',
                },
              },
              size.width + ' × ' + size.height,
            ),
            h(
              'div',
              {
                style: {
                  position: 'absolute',
                  left: 12,
                  bottom: 8,
                  fontSize: 10,
                  color: 'var(--dsw-alias-label-secondary)',
                  opacity: 0.55,
                  pointerEvents: 'none',
                  userSelect: 'none',
                },
              },
              '按住中键拖动：隐藏画框，预览参考图 · 双击中键复位',
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
                      !isText
                        ? h(
                            'label',
                            {
                              style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                marginTop: 6,
                                fontSize: 10.5,
                                color: 'var(--dsw-alias-label-secondary)',
                                cursor: 'pointer',
                              },
                            },
                            h('input', {
                              type: 'checkbox',
                              checked: Boolean(meta.character),
                              onChange: (event) =>
                                changeBox(selected, {
                                  metadata: Object.assign({}, meta, { character: event.target.checked }),
                                }),
                            }),
                            h('span', null, '标记为人物（character）'),
                          )
                        : null,
                    )
                  })()
                : null,
              h(
                'label',
                {
                  style: {
                    display: 'block',
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                    margin: '8px 0 4px',
                  },
                },
                '整图描述',
              ),
              h('textarea', {
                value: summary,
                style: WORKSPACE_AREA_INPUT,
                onChange: (event) => {
                  setSummary(event.target.value)
                  setDirty(true)
                },
              }),
              h(
                'label',
                {
                  style: {
                    display: 'block',
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                    margin: '10px 0 4px',
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
              h(
                'div',
                {
                  style: {
                    marginTop: 10,
                    borderTop: '1px solid var(--dsw-alias-border-l2)',
                    paddingTop: 10,
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
                  h('span', { style: { fontSize: 10.5, fontWeight: 600 } }, 'AI 润色'),
                  h('span', { style: { flex: 1 } }),
                  h(
                    'div',
                    { style: { width: 130, flex: 'none' } },
                    h(LlmModelPicker, {
                      provider: promptWriteProvider,
                      model: promptWriteModel,
                      title: '润色模型（跟随默认时用 DSH 当前选中的模型）',
                      dark: canvasNight,
                      onPick: (next) => {
                        const parsed = parseRouteKey(next)
                        setPromptWriteProvider(parsed.provider)
                        setPromptWriteModel(parsed.model)
                      },
                    }),
                  ),
                  h(
                    'div',
                    { style: { width: 96, flex: 'none' } },
                    h(Dropdown, {
                      title: '思考模式（档位按所选模型的支持情况列出）',
                      placeholder: '思考：默认',
                      value: polishEffort || '',
                      options: polishEfforts,
                      onPick: (value) => setPolishEffort(value),
                      dark: canvasNight,
                    }),
                  ),
                  h(
                    'button',
                    {
                      className: 'dshCanvasBtn',
                      style: { padding: '2px 8px', fontSize: 10 },
                      onClick: clearPolishChat,
                    },
                    '清除对话',
                  ),
                ),
                h(
                  'div',
                  { style: { position: 'relative', marginTop: 6 } },
                  h('textarea', {
                    value: polishInstruction,
                    style: Object.assign({}, WORKSPACE_AREA_INPUT, { minHeight: 52 }),
                    placeholder: '怎么润色（例如：更有电影感、补充材质细节）',
                    onChange: (event) => setPolishInstruction(event.target.value),
                  }),
                  polishBusy
                    ? h(
                        'div',
                        {
                          style: {
                            position: 'absolute',
                            inset: 0,
                            borderRadius: 6,
                            background: 'rgba(0, 0, 0, 0.38)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            color: '#ffffff',
                            fontSize: 11,
                            backdropFilter: 'blur(1px)',
                          },
                        },
                        h('span', {
                          style: {
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            border: '2px solid rgba(255, 255, 255, 0.3)',
                            borderTopColor: '#ffffff',
                            animation: 'dshComfySpin 0.8s linear infinite',
                          },
                        }),
                        '润色中…',
                      )
                    : null,
                ),
                h(SegmentToggle, {
                  value: polishMode,
                  options: [
                    { value: 'single', label: '选中框' },
                    { value: 'board', label: '整个画板' },
                  ],
                  onChange: (value) => setPolishMode(value),
                }),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginTop: 6 } },
                  h(
                    'button',
                    {
                      className: 'dshCanvasBtn',
                      style: { flex: 1 },
                      disabled: polishBusy,
                      onClick: runPolishNow,
                    },
                    polishBusy ? '润色中…' : '润色',
                  ),
                  polishResult
                    ? h('button', { className: 'dshCanvasBtn', style: { flex: 1 }, onClick: applyPolish }, '写入画框')
                    : null,
                  h(
                    'button',
                    {
                      className: 'dshCanvasBtn',
                      style: { flex: 'none' },
                      onClick: () => setPolishChatOpen(true),
                    },
                    polishChatOpen ? '收起对话' : '查看对话',
                  ),
                ),
                polishBusy
                  ? h(
                      'div',
                      {
                        ref: streamRef,
                        style: {
                          marginTop: 6,
                          maxHeight: 150,
                          overflowY: 'auto',
                          padding: '6px 8px',
                          borderRadius: 6,
                          background: 'var(--dsw-alias-bg-layer-1)',
                          fontSize: 10.5,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        },
                      },
                      polish.stream,
                    )
                  : null,
                polishMsg
                  ? h(
                      'div',
                      { style: { marginTop: 6, fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                      polishMsg,
                    )
                  : null,
                polish.ranAs
                  ? h(
                      'div',
                      { style: { marginTop: 4, fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                      '模型：' + polish.ranAs,
                    )
                  : null,
                polish.skillLength !== null && polish.skillLength !== undefined
                  ? h(
                      'div',
                      { style: { marginTop: 4, fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                      polish.skillLength > 0
                        ? 'moss skill：已加载（' + polish.skillLength + ' 字符）'
                        : 'moss skill：未加载（文件缺失？）',
                    )
                  : null,
                polishResult && polishResult.text
                  ? h(
                      'div',
                      {
                        style: Object.assign({}, WORKSPACE_AREA_INPUT, {
                          minHeight: 40,
                          maxHeight: 140,
                          marginTop: 6,
                          overflowY: 'auto',
                          fontSize: 10.5,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                        }),
                      },
                      polishResult.text,
                    )
                  : null,
                polishResult && polishResult.items
                  ? h(
                      'div',
                      { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
                      ...polishResult.items.map((item, index) =>
                        h(
                          'div',
                          {
                            key: index,
                            style: {
                              fontSize: 10.5,
                              lineHeight: 1.4,
                              padding: '4px 6px',
                              borderRadius: 6,
                              background: 'var(--dsw-alias-bg-layer-1)',
                              whiteSpace: 'pre-wrap',
                              maxHeight: 90,
                              overflowY: 'auto',
                            },
                          },
                          (item.id ? '#' + (Number(item.id) + 1) + ' ' : '') + item.text,
                        ),
                      ),
                    )
                  : null,
                polishChatOpen
                  ? null
                  : null,
              ),
            ),
            h(
              'div',
              {
                style: {
                  flex: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
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
                  title: '相册',
                  onClick: () => setAlbumOpen(true),
                },
                h(Icon, { name: 'images', size: 13 }),
                h('span', null, '相册'),
              ),
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
        polishChatOpen
          ? h(
              'div',
              {
                style: {
                  position: 'fixed',
                  inset: 0,
                  zIndex: 1400,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0, 0, 0, 0.42)',
                },
                onClick: (event) => {
                  if (event.target === event.currentTarget) setPolishChatOpen(false)
                },
              },
              h(
                'div',
                {
                  style: {
                    width: 720,
                    maxWidth: 'calc(100vw - 40px)',
                    maxHeight: '72vh',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 16,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-base)',
                    boxShadow: '0 24px 70px rgba(0, 0, 0, 0.3)',
                    overflow: 'hidden',
                    animation: 'dshPageIn 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
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
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--dsw-alias-border-l2)',
                    },
                  },
                  h(Icon, { name: 'info', size: 14 }),
                  h('span', { style: { fontSize: 13, fontWeight: 600 } }, '润色对话'),
                  h('span', { style: { flex: 1 } }),
                  h(
                    'span',
                    { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                    '累计 token：输入 ' + polishTotals.input + ' / 输出 ' + polishTotals.output,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setPolishChatOpen(false),
                      style: {
                        width: 24,
                        height: 24,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        borderRadius: '50%',
                        border: 0,
                        background: 'var(--dsw-alias-bg-layer-2)',
                        color: 'var(--dsw-alias-label-secondary)',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                      },
                    },
                    '×',
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    },
                  },
                  polishHistory.length === 0
                    ? h(
                        'div',
                        { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                        '还没有对话',
                      )
                    : polishHistory.map((turn, index) =>
                        h(
                          'div',
                          { key: index, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                          h(
                            'div',
                            {
                              style: {
                                fontSize: 10,
                                fontWeight: 600,
                                color:
                                  turn.role === 'assistant'
                                    ? 'var(--dsw-alias-brand-primary)'
                                    : 'var(--dsw-alias-label-secondary)',
                              },
                            },
                            (turn.role === 'assistant' ? '助手' : '你') +
                              (turn.tokens ? ' · ' + formatTokens(turn.tokens) : ''),
                          ),
                          h(
                            'div',
                            {
                              style: {
                                fontSize: 11.5,
                                lineHeight: 1.55,
                                padding: '8px 10px',
                                borderRadius: 8,
                                background:
                                  turn.role === 'assistant'
                                    ? 'var(--dsw-alias-bg-layer-1)'
                                    : 'var(--dsw-alias-bg-layer-2)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              },
                            },
                            String(turn.text || ''),
                          ),
                        ),
                      ),
                ),
              ),
            )
          : null,
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
                  albumPick ? 'Esc 返回 · ←/→ 切换 · 滚轮缩放' : '左键查看 · 右键设为参考图 · Esc 关闭',
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
                    const negativeText =
                      meta && meta.negative && typeof meta.negative.text === 'string' ? meta.negative.text : ''
                    const sizeText =
                      meta && meta.size && typeof meta.size.width === 'number' && typeof meta.size.height === 'number'
                        ? meta.size.width + ' × ' + meta.size.height
                        : ''
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
                          ref: albumZoomRef,
                          style: {
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 16,
                            overflow: 'hidden',
                            cursor: 'zoom-in',
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
                            transform:
                              'translate(' +
                              albumZoom.x +
                              'px, ' +
                              albumZoom.y +
                              'px) scale(' +
                              albumZoom.scale +
                              ')',
                            transition: 'transform .08s ease-out',
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
                        h('div', { style: WORKSPACE_PARAM_TITLE }, '负面提示词'),
                        h('div', { style: WORKSPACE_PARAM_BODY }, negativeText || '（没有记录）'),
                        h('div', { style: WORKSPACE_PARAM_TITLE }, '分辨率'),
                        h('div', { style: WORKSPACE_PARAM_BODY }, sizeText || '（没有记录）'),
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
                            // Off-screen cards skip layout and paint entirely; a grid
                            // of a hundred images stays smooth while scrolling.
                            contentVisibility: 'auto',
                            containIntrinsicSize: '160px',
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
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab', key: CANVAS_TAB_ID }, guardSlot(CanvasTab, '画框画布')),
          )
          tabCtx.slots.inject('sidebar.right.pane.tab.title', () =>
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab.title', key: CANVAS_TAB_ID }, guardSlot(CanvasTitle, '画框标题')),
          )
        })

        // The zoom view lives in the frame-wide overlay seat: it must cover every
        // column, and a `position: fixed` inside the pane is clipped by the layout.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'comfy-canvas-zoom' }, guardSlot(ZoomHost, '放大视图')),
        )

        // Standalone workspace: a left-sidebar entry plus the main-panel page it
        // switches to. The entry follows the preference so switching it off
        // removes it from the sidebar immediately.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: WORKSPACE_KEY }, guardSlot(CanvasWorkspace, 'Image 工作台')),
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
                  label: () => 'Image 工作台',
                },
                guardSlot(WorkspaceIcon, '工作台入口'),
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
        safe('状态卡', () => ctx.slots.inject('sidebar.footer.action', () => {
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
                guardSlot(ComfyStatus, 'ComfyUI 状态'),
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
        }))

        // This bundle's configuration block on its plugin page.
        safe('模块设置', () => ctx.slots.inject('plugins.bundle.config', () =>
          // Keyed by the bundle's package name: the plugin page looks configs up by that key.
        ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-comfy-enhance' }, guardSlot(ModuleSettings, '模块设置')),
        ))

        // The album is an optional surface: without the right sidebar the status
        // card above must keep working, so it registers on its own sub-context.
        safe('相册', () => ctx.inject(['sidebarRightTabs'], (tabCtx) => {
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
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, guardSlot(AlbumTab, 'ComfyUI 相册')),
          )
          tabCtx.slots.inject('sidebar.right.pane.tab.title', () =>
            tabCtx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, guardSlot(AlbumTitle, 'ComfyUI 相册标题')),
          )
        }))

        // The canvas half mounts its own tabs, overlay and page. It failing must
        // leave the cards above in place, so it gets the same guard.
        safe('画布', () => canvasHalf.apply(ctx))

        // The canvas draft card docks above the composer as a full-width entry —
        // the same place the queue/todo docks live — so it reads as part of the
        // conversation input instead of a floating overlay.
        safe('草稿卡', () => ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'dsh-comfy-draft',
              order: 40,
              label: () => 'ComfyUI 草稿',
            },
            guardSlot(DraftCard, 'ComfyUI 草稿'),
          ),
        ))
      },
    }
  },
})
