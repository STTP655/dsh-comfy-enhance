# 变更记录

## 0.17.0

润色模型改由 DSH 自己的模型目录提供，不再靠手打模型名。

- 新增宿主路由 `GET /plugin/comfy-canvas/models`：从 `ctx.llm` 读出 provider 与其广告的模型（含每个模型声明的思考档位），单 provider 失败进 `failures` 而不是整体报错，结果在进程内缓存 30 秒，`?refresh=1` 强制重读
- `provider` 与 `model` 成对传递：两者都给就照用；只给 model 时按目录反查 provider；都不给则沿用 DSH 当前的默认选择
- 润色面板与「提示词写作规则」弹窗里的模型输入框换成分组下拉，菜单宽度独立于触发器，条目按 provider 分组、可搜索；目录里没有的存量值仍保留为「当前值」条目
- 思考档位按所选模型声明的 efforts 生成，模型不支持时保留原来四档
- 润色完成后面板显示实际使用的 `provider / model`
- 修复：MOSS 画板润色的 `promptModel` 在 store 解构时被丢弃，模型设置从未进入请求体（`7e7f86f` 只补到调用处）
- 修复：在线 API 面板与文生图面板的 AI 写作只传 model，跨 provider 时必然错配

## 0.16.0

- 相册、画框画布、独立工作台合并在一个 bundle 内
