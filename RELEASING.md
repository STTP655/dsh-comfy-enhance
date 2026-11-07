# 工作流程与发版

给维护者的完整流程。**硬约束清单见 `AGENTS.md`**，这里写"为什么"和"出事了怎么办"。

## 一、每次改动

插件被运行中的 DSH 直接加载（profile 的 junction 指向本目录），**存盘即上线**。

```sh
node scripts/snapshot.mjs 这次改什么     # 1. 拍快照
#                                2. 改文件
node scripts/preflight.mjs               # 3. 三个入口文件必须都能解析
#                                4. 同步到仓库、提交
```

- `node scripts/snapshot.mjs --list` 列出快照
- `node scripts/snapshot.mjs --restore <id>` 用某份覆盖回来
- 快照在 `backups/`（已 gitignore），默认保留最近 20 份

`preflight` 只保证文件能解析，挡的是最致命的失败——半截保存的文件被发给浏览器。

## 二、两棵树

| 目录 | 作用 |
| --- | --- |
| `dsh-comfy-enhance` | git 仓库，历史与 tag 在这里 |
| `plugins/dsh-comfy-enhance` | 运行中的插件，profile 的 junction 指向它 |

两者**独立**，靠手工同步。流程是：改运行目录 → 复制到仓库 → 提交。

复制之后逐文件比哈希，确认没有漏：

```pwsh
Get-ChildItem plugins\dsh-comfy-enhance -Recurse -File |
  Where-Object { $_.FullName -notmatch 'backups|node_modules|\.bak' } |
  ForEach-Object { ... 比对仓库同名文件的 SHA256 ... }
```

**这条规则是被教训出来的**：0.18.0 之前，漫画工作台那 137 KB（client.js 645→782 KB）
只存在于运行目录，仓库里没有，靠人工比对才发现。如果那时目录损坏，这部分工作就直接没了。

## 三、改动分级

| 类型 | 做法 |
| --- | --- |
| 参数、文案、模板数值、样式微调 | 直接改、提交、推。不写 CHANGELOG 分节 |
| 成组的新功能 / 行为变化 | 提交，并在 CHANGELOG 当前版本节里补条目 |

只有接到"发版"这句话才动版本号。

## 四、发版

```sh
# 1. 定版本号（补丁位正常进位，例：0.17.0 → 0.17.1 → 0.18.0）
#    改 package.json 的 version
# 2. 整理 CHANGELOG：把「未发布」并成 ## X.Y.Z（日期）节，分「修复 / 变更 / 新增」
# 3. 提交
git commit -m "release: X.Y.Z —— 一句话概括"
# 4. 打标注 tag（带补丁位，与 v0.17.1 / v0.18.0 一致）
git tag -a vX.Y.Z -m "X.Y.Z 一句话"
# 5. 推
git push origin HEAD --follow-tags
```

**CHANGELOG 整理原则**：开发过程中会有互相推翻的临时条目（例如"倍率改成一次性缩放"后来被推翻、
"LATENT_SCALE 补偿"后来换成修节点）。发版时**必须合并成最终事实**，不要把过程稿直接当发行说明。

### tag 命名

从 0.17.1 起带补丁位：`v0.17.1`、`v0.18.0`。更早的是 `v0.15`、`v0.16` 这种不带补丁位的，
不要重命名已发布的 tag。

## 五、推送（含沙盒限制）

```sh
git push origin HEAD --follow-tags
```

在这个沙盒里，`git push` 会因 ssh 无法创建 msys 命名对象而失败：

```
fatal: Could not read from remote repository.
... NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0...): 0xC0000022
```

**这不是权限问题也不是远程问题**，是沙盒限制。用 `sandbox_permissions: danger-full-access`
重试同一条命令即可，一次就过。

推送后核对：

```sh
git log origin/main..HEAD --oneline    # 应该为空
git status --short                      # 应该为空
```

## 六、回滚

按"改动还没提交 / 已提交没推 / 已推"三种情况：

### 1. 改动有问题，还没提交

```sh
# 丢掉工作区改动，回到上次提交
git checkout -- .
# 或者只回某个文件
git checkout -- client.js
```

### 2. 已提交、还没推

```sh
git revert --no-edit <sha>     # 生成一条反向提交（推荐，历史可查）
# 或直接回退指针（只在确认没人拉过时用）
git reset --hard <上一个 sha>
```

### 3. 已经推上去了

```sh
git revert --no-edit <sha>
git push origin HEAD
```

**不要用 `push --force` 改写已发布的历史**：tag 和别人的克隆都会对不上。

### 4. 代码已经在跑、但坏了（最急的情况）

优先用快照，比 git 快、也不依赖仓库状态：

```sh
node scripts/snapshot.mjs --list
node scripts/snapshot.mjs --restore 20261108-031909-release-0.18.0
node scripts/preflight.mjs
# 宿主文件改动 → 重启 DSH；前端改动 → 刷新页面
```

快照只覆盖 `index.js / canvas-host.js / client.js / package.json / CHANGELOG.md`。
**模板（`templates/*.json`）和 `presets/` 不在快照里**——这两处改坏了，从 git 取：

```sh
git show <sha>:templates/moss-image-sft-api.json > templates/moss-image-sft-api.json
```

### 5. 彻底回到某个已发布版本

```sh
git checkout v0.18.0 -- .
node scripts/preflight.mjs
```

改完记得把 `package.json` 的 version 也一起退回，否则版本号会骗人。

## 七、已知的事实（省得反复试）

| 改了 | 生效方式 |
| --- | --- |
| `client.js`（前端 bundle） | 刷新页面；宿主缓存导致可能要 reload 两次 |
| `index.js` / `canvas-host.js`（宿主） | **必须重启 DSH** |
| `templates/*.json` | 每次提交任务时从磁盘读，**不用重启** |

- `output-meta` 的 `size` 读 PNG 的 **IHDR**（真实像素）；内嵌工作流里的 width/height 只是请求值
- `EmptyFlux2LatentImage` 配当前 VAE 会让出图正好减半，模板用 `EmptyLatentImage`
- `CLIPLoader.type` 是引擎枚举，本机是 `qwen_image`；写死 `flux` 会被 `prompt_outputs_failed_validation` 拒
- 模型没选全时前端会先拦下来并打开模型弹窗，不要绕过这个检查
