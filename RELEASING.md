# 工作流程与发版

## 每次改动

插件是被运行中的 DSH 直接加载的（profile 用 junction 指向 `plugins/dsh-comfy-enhance`），**存盘即上线**，
所以改动前先留一份副本：

```sh
node scripts/snapshot.mjs 这次改什么     # 1. 拍快照
# 2. 改文件
node scripts/preflight.mjs               # 3. 三个入口文件必须都能解析
```

- `node scripts/snapshot.mjs --list` 看有哪些快照
- `node scripts/snapshot.mjs --restore <id>` 用某份覆盖回来
- 快照存在 `backups/`（已 gitignore），默认保留最近 20 份

`preflight` 只保证"文件能解析"，抓不到逻辑错误；它挡的是最蠢也最致命的失败——半截保存的文件被
直接发给浏览器。

## 版本号

**当前定在 `0.16.0`，不随每次改动变动。** 改动先堆在 `CHANGELOG.md` 的「未发布」小节里。

维护者觉得积累够了，会明确说"发一个版本"，那时才：

1. 定版本号，改 `package.json` 的 `version`，把 CHANGELOG 的「未发布」小节改名
2. 提交 `release: X.Y.Z（一句话概括这一版）`
3. 打 annotated tag（跟 `v0.15`、`v0.16` 一致，不带 patch）：
   `git tag -a vX.Y -m "dsh-comfy-enhance X.Y.Z"`
4. 推：`git push && git push --tags`

没接到"发版"这句话之前，不要自己 bump 版本号。

## 两棵树

| 目录 | 作用 |
| --- | --- |
| `dsh-comfy-enhance` | git 仓库，历史与 tag 都在这里 |
| `plugins/dsh-comfy-enhance` | 运行中的插件，profile 的 junction 指向它 |

两者是**独立目录**，靠手工同步。改完运行中的那份要同步回仓库再提交，否则 git 里的历史就不等于
实际在跑的代码。长期的解法是让两边变成同一棵树（把 profile 的 junction 直接指向仓库，或把运行目录
换成指向仓库的 junction），这需要在没有正在改插件的窗口里做。
