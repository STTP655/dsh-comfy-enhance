# 发布流程

版本号只在发版时确定。日常提交不动 `package.json`，改动先堆在 `CHANGELOG.md` 的「未发布」小节里。

## 约定

- 提交信息带前缀：`feat:` / `fix:` / `docs:` / `chore:` / `release:`
- 发版提交写作 `release: X.Y.Z（一句话概括这一版）`，同一个提交里把 `package.json` 的 `version` 改成该值
- tag 用 `vX.Y`（跟 `v0.15` / `v0.16` 一致，不带 patch），并用 **annotated**：

  ```sh
  git tag -a vX.Y -m "dsh-comfy-enhance X.Y.Z"
  ```

- 发版时把 `CHANGELOG.md` 顶部的「未发布」小节改名为版本号

## 发版

```sh
node scripts/preflight.mjs                  # 三个入口文件必须都能解析
# 改 package.json 的 version，改 CHANGELOG 的小节标题
git add -A && git commit -m "release: X.Y.Z（…）"
git tag -a vX.Y -m "dsh-comfy-enhance X.Y.Z"
git push && git push --tags
```

## 回滚

```sh
git checkout vX.Y -- .                      # 工作区回到某个已发布版本
```

工作区就是运行中的插件：profile 里 `web/node_modules/dsh-comfy-enhance` 用 junction 指向本目录，
所以 `git checkout` 之后刷新页面（宿主侧改动需重启 DSH）即生效。
