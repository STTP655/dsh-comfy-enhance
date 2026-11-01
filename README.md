# dsh-comfy-enhance

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的 ComfyUI 面板套件。一个 bundle 里包含三个模块，在插件页里可以分别开关。

> 它不依赖 ComfyUI 的浏览器界面——Host 端直接调用 ComfyUI 的 HTTP 接口（`/system_stats`、`/history`、`/view`），所以只要 ComfyUI 进程开着就能用。

## 模块

### 1. 侧边栏状态卡片

左侧边栏底部常驻，不用离开对话就能看到引擎状态：

- 在线 / 离线、ComfyUI 版本
- 队列：运行中 / 等待中
- 显存占用（带进度条，运行中吃紧时变色）
- 最近一次产出的耗时和文件名

### 2. 相册标签页

右侧边栏的输出图画廊：

- 缩略图按日期分组（今天 / 昨天 / N 天前）
- 大图预览，点右下角放大到全屏，`Esc` 关闭
- 每张作品的完整信息：提示词（正 / 负，MOSS 的结构化 JSON 会自动抽出 caption）、模型、采样参数
- 顶部「正在生成」条实时显示运行中任务的提示词
- 「清空」只影响插件里的显示，不碰 ComfyUI 的历史记录和输出文件

### 3. 画框标签页（MOSS）

**MOSS-Image 专用**的版式画板。产出的不是普通文本提示词，而是 MOSS 的 layout JSON（`abs_centralized` + `yxyx` 坐标），别的模型认不了。

- 读取 ComfyUI 工作流里 `CreateBoundingBoxes` 节点的内容
- 拖动移动、右下角缩放、右键删除
- 双击框内编辑：text 框写字面内容，其它框写描述
- 整图描述（summary）—— 对应 `MOSSImageLayoutPrompt` 的 prompt 输入
- 比例 / 像素量跟随工作流的 `ResolutionSelector`，尺寸自动对齐 16 的倍数
- 叠图参考：从相册选图或选本地图片，垫在画框下面对着画
- 全屏大视图：左侧画布 + 右侧框列表，重叠的框也能单独选中
- 一键把 MOSS layout 发给 agent 补描述
- 编辑内容按工作流文件自动存草稿，切换 tab、刷新都不丢

## 安装

### 让 agent 装（推荐）

把仓库克隆到任意位置，然后在 Harness 会话里说：

```
用 plugin_manager 从 <克隆目录> 安装这个 bundle
```

### 手动装

```bash
# 1. 克隆
git clone https://github.com/<you>/dsh-comfy-enhance.git

# 2. 链接到 profile（Windows 用 junction）
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-comfy-enhance" "路径\dsh-comfy-enhance"

# 3. 在 profile 的 cordis.patch.yml 末尾追加
```

```yaml
- insert:
    - id: dsh-comfy-enhance
      name: dsh-comfy-enhance
```

重启 Harness，插件页里会出现「ComfyUI 增强」。

## 配置

`cordis.patch.yml` 里的 `comfyUrl`，默认 `http://127.0.0.1:8188`：

```yaml
- insert:
    - id: dsh-comfy-enhance
      name: dsh-comfy-enhance
      config:
        comfyUrl: http://127.0.0.1:8188
```

也可以用环境变量 `DSH_COMFY_URL` 覆盖。

**为什么走 Host 代理**：Web GUI 可能从另一台机器打开（比如经 Tailscale），浏览器里的 `127.0.0.1` 是访问者自己的回环地址，不是跑 ComfyUI 那台。所以所有请求都由 Host 端代理，同源转发。

## 三个模块怎么开

插件页 → 找到「ComfyUI 增强」→ 点进去：

```
侧边栏状态卡片                 [开]
相册标签页                     [开]
画板标签页（MOSS）             [开]
```

关掉哪个，对应界面就不出现（画板关掉后 tab 类型会注销，右栏入口直接消失）。

开关存在浏览器 localStorage，同一浏览器刷新后保持。

## 工作流文件

画框模块直接读写 ComfyUI 的 `user/default/workflows` 目录，路径从运行中实例的 `/system_stats.argv` 自动推导，不需要手填。

读取和保存都会做路径校验（拒绝 `..`、非 `.json`、目录外路径），保存前自动留一份 `.bak`。

## 内部路由

| 前缀 | 用途 |
|---|---|
| `/plugin/comfy-status/*` | 状态快照、相册列表、图片代理 |
| `/plugin/comfy-canvas/*` | 工作流列表、工作流读写、比例选项 |

前缀沿用早期两个独立插件的名字，没有跟着包名改——它们不出现在 UI 里，改动的收益小于风险。

## 目录结构

```
index.js          状态 / 相册的 Host 路由
canvas-host.js    画框的 Host 路由（同包内导入）
client.js         全部 UI（两个标签页 + 侧边栏卡片 + 插件页配置）
cordis.patch.yml  bundle 入口
locale/           中英标题与描述
icon.svg          插件图标
```

## 已知限制

- 画框模块只支持带 `CreateBoundingBoxes` 节点的工作流；其它工作流打开会提示没有画板
- 叠图参考里本地选的图片不跨页面刷新（浏览器 blob URL 的限制），相册来源的会保留
- 画框草稿存在浏览器 localStorage，换浏览器不同步
- 画框产出的 layout JSON 只有 MOSS-Image 认，别用在 SD / Flux 上

## 版本

**0.11** —— 输入法与交互修复：

- 画框内编辑、Inspector 描述、整图描述三处都能正常输入中文（受控 textarea 会重写 `value`，打断输入法组合）
- 放大视图改用独立的编辑会话与不受控编辑器，双击即可编辑，不再经过 store 中转
- 主界面画布右侧新增画框列表：点击选中，显示序号与前五个字
- 放大视图右侧支持切换元素类型、标记人物、加框、两步确认删除

**0.1** —— 首个可用版本：三个模块、MOSS layout 导出、叠图参考、大视图、草稿持久化。
