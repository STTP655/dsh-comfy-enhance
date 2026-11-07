# dsh-comfy-enhance · 给后续 agent 的硬约束

这个插件被**运行中的 DSH 直接加载**（profile 的 junction 指向本目录），**存盘即上线**。
下面每一条都是实际踩出来的，照做；不要为了"更规范"而改掉它们。

## 动手之前

1. **先拍快照**：`node scripts/snapshot.mjs 一句话说明这轮改什么`
   搞砸了用 `node scripts/snapshot.mjs --restore <id>` 覆盖回来，`--list` 查看已有快照。
   快照在 `backups/`（已 gitignore），默认保留最近 20 份。
2. **改完必跑** `node scripts/preflight.mjs`。它只保证"三个入口文件能解析"，**抓不到逻辑错误**，
   逻辑要自己复核。它挡的是最致命的失败：半截保存的文件被直接发给浏览器。
3. **大段替换用脚本 + 断言**：脚本里 `indexOf` 找不到 marker 就 `throw`，不要盲改；
   脚本跑完先 `node --check`，再 preflight。手改几百行必出错。

## 两棵树，必须同步

| 目录 | 作用 |
| --- | --- |
| `plugins/dsh-comfy-enhance` | 运行中的插件，profile 的 junction 指向它 |
| `dsh-comfy-enhance`（工作区根下） | git 仓库，历史与 tag 都在这里 |

两者是**独立目录，靠手工同步**。改完运行中的那份，**必须复制到仓库并提交**，否则 git 历史
不等于实际在跑的代码。提交前 `git status` 必须是干净的，并且确认：

```pwsh
# 逐文件比哈希，找出还不同的
```

长期解法是让两边变成同一棵树，但要在没人改插件的窗口里做。

**教训**：曾经有 137 KB 的漫画工作台功能只存在于插件目录、仓库里没有，靠人工比对才发现。

## 三个"改完怎么生效"

| 改了 | 生效方式 |
| --- | --- |
| `client.js`（前端 bundle） | 刷新页面；宿主有缓存，可能要 reload 两次 |
| `index.js` / `canvas-host.js`（宿主） | **必须重启 DSH** |
| `templates/*.json` | 每次提交任务时从磁盘读，**不用重启** |

不知道属于哪一类时，按"需要重启"处理，别假设热更新。

## 不要做的事

- **不要删文件或目录**。要清理先移进 `backups/`，任何时候都别做不可逆删除。
- **不要在没接到"发版"指令时**改 `package.json` 的 `version` 或打 tag。
- **不要用 PowerShell 的 `Set-Content` 拼多行代码**：`\n` 不会被解释，会写出字面量反斜杠 n，
  直接把文件搞成语法错误。多行内容用 `write` 工具或 here-string。
- **不要整体重排 `client.js`**：780 KB 单文件，一次重排会让 diff 失控、无法 review。只做定点编辑。
- **不要相信元数据代替事实**：PNG 里内嵌的工作流是"请求值"，真实像素尺寸要读 IHDR。
  同类错误导致过一轮误判（详见 CHANGELOG 0.17.1 的 `output-meta` 修复）。

## 提交与推送

- 提交信息用 here-string（`@'...'@`），不要用双引号字符串——反引号会被 PowerShell 当转义。
- `git push` 在这个沙盒里会因为 ssh 无法创建 msys 命名对象而失败（`0xC0000022`）。
  这是沙盒限制不是权限问题：用 `sandbox_permissions: danger-full-access` 重试一次即可。
- 推送后确认 `git status` 干净、`git log origin/main..HEAD` 为空。

## 改动分级

| 类型 | 做法 |
| --- | --- |
| 参数、文案、模板数值 | 直接改、直接提交、直接推，不写 CHANGELOG 分节 |
| 成组的新功能 / 行为变化 | 提交，并在 CHANGELOG 当前版本节里补条目 |

发版流程、tag 规范、回滚步骤见 `RELEASING.md`。
