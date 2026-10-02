# VideoBuddy · Codex完整开发交付包 v5.1｜空仓库起步版

**已确认界面：Easy Companion 2.1。** 本包把最终UI与Vercel、Mastra、SSE、无应用数据库/无登录、43风格及媒体生产全部合并。不需要再翻找旧版本。

**起点已更正：用户在独立的 videoBuddy 空仓库开发。presentationBuddy 仅为外部参考，不预设当前已有任何应用文件。无需先手工复制或 fork 原仓库。**

## 使用

将整个目录放到目标代码仓库的 `docs/hand-off/videobuddy-v5.1/`（或其他清楚的位置），让Codex读取 [CODEX_START_HERE.md](CODEX_START_HERE.md)。保留文件相对位置。该位置只是交付参考目录，生产代码由Codex按实施计划在仓库根目录新建src，不把整个原型复制到生产public当应用。

人类快速阅读：[合并完整开发文档](VideoBuddy_Codex_Development_Spec_v5_1.md)。看已批准交互：[独立原型](design/preview.html)。原型里的对话、8秒无声片和状态演示不代表真实服务。

## 包含什么

| 位置 | 作用 |
|---|---|
| [00 空仓库初始化](docs/00_EMPTY_REPO_BOOTSTRAP.md) | 原仓库保护、Next.js初始化、选择性复用、T00子步骤与8条补充验收 |
| [01 产品与UI](docs/01_PRODUCT_AND_UI.md) | 22项功能、已认可视觉与小白交互、视频和上传范围 |
| [02 领域与状态](docs/02_DOMAIN_AND_STATE.md) | 语义版本、预览批准、时间映射、修改授权、状态机 |
| [03 运行与存储](docs/03_RUNTIME_STORAGE_SECURITY.md) | Workflow/Sandbox/Blob、并发、幂等、安全、恢复与留存 |
| [04 Agent与媒体](docs/04_AGENT_AND_MEDIA.md) | 逐步引导、真实资料理解、导演、代码、声音、QA与全风格 |
| [05 API与SSE](docs/05_API_AND_SSE.md) | 请求、快照、13类领域事件、去重续接、错误码 |
| [06 实施计划](docs/06_IMPLEMENTATION_PLAN.md) | T00–T21：文件、接口、依赖、测试、交付证据 |
| [07 验收与部署](docs/07_ACCEPTANCE_AND_DEPLOYMENT.md) | 真实验收、云配置、发布层级、运维与92条基础用例 |
| [08 决策与来源](docs/08_SOURCES_AND_DECISIONS.md) | 旧方案冲突消除、模板路径映射、官方资料与43风格清单 |
| [contracts/public.schema.json](contracts/public.schema.json) | 22个外部合同定义，闭合请求/事件payload；仍需业务校验 |
| [examples/manifest.json](examples/manifest.json) | 合法/非法JSON示例、SSE重试示例、节选时间映射 |
| [acceptance/](acceptance/) | 需求、任务、92用例、16项Agent评估、43×2风格验证目标 |
| [design/](design/) | 用户已确认的原型、CSS/JSON变量、9张截图和演示素材，60文件原样保留 |
| [config/env.example](config/env.example) | 云端与模型配置名称；无实际凭据，默认关闭生成 |
| [checks/validate_handoff.py](checks/validate_handoff.py) | 本交付包的结构/合同/来源引用/设计hash自检，非应用测试 |
| [HANDOFF_VALIDATION.md](HANDOFF_VALIDATION.md) | 本次真实执行的文档检查结果与未验证边界 |

## 重要约定

用户已经批准视觉，无需重新选风格或做一版“更专业”的控制台。右侧聊天、单输入、渐進收集和一次正式确认是产品规则，不是只改CSS。全部43视频风格范围不缩减；按批次开发不等于把后几批变成可选。

本包是研发规格与参考资产，**不包含已实现应用、配置好的云资源或真实成片验收结果**。测试矩阵初始均为未执行。无字体文件、模型权重或凭据随包提供。完整架构的真实平台兼容性、运行费用、3D性能和质量由T00及后续真实测试确认。

## 本次变更范围

仅调整空仓库启动、参考项目定位、T00、相应验收及Codex入口；业务API/schema、92条基础验收数量、43风格范围与60份已批准设计参考保持不变。已有v5包的用户可直接改用此完整包，不需要同时交付两套。云平台/API资料延用v5的来源记录，本次没有重新进行平台探针或应用测试。

## 检查交付包

```sh
# 安装jsonschema仅用于本包自检，可在隔离Python环境执行。
python -m pip install jsonschema
python checks/validate_handoff.py
```

这个命令通过只代表交付文件彼此一致，不代表VideoBuddy软件通过了92项验收，也不是对历史原型测试的重复执行。
