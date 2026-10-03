# T06/T09/T12 画面审查增量

原生 Mastra Critic 接收实际 MP4 解码的 PNG，而非示例视频或模型生成占位图。四帧为第 60/192/324/432 帧。提供方 HTTP 200，实际输入 9,384、输出 10,541 token；预算按实际使用结算。原始结果见 [visual-critic-probe.json](visual-critic-probe.json)。`validated` 仅指严格合同和来源通过，报告的风格、可读性均为 fail。

抽帧、合同、传输测试最初因缺少模块失败。本地多模态请求首次因 SDK 用 fetch 解码 inline PNG 被目的地限制拒绝，实际提供方调用为零；诊断保存在 [失败证据](visual-critic-preflight-failure.json)。仅允许有界 PNG data URI 的本地解码，HTTP 仍限定提供方及物理调用数。零重试。

独立审查发现 Composite 输入未完整桥接冻结包，以及自签缓存可把真实第 324 帧冒充第 60 帧。来源字段与生产键现在完整重算，`mustExist` 禁止补生成。v2 抽帧将实际 PNG 哈希与固定输入地址回执绑定，旧 v1 缓存不接受。[真实来源验证](composite-binding-probe.json) 和 [真实换帧攻击验证](visual-evidence-probe.json) 均通过，零新增模型调用。两轴复审分别在只读 overlay 中验证声音/视觉引用变化、PictureSequence 哈希变化以及冷缓存换帧重签均拒绝。

历史付费报告仍原样保留；[缓存报告复验](cached-critic-validation.json) 对相同字节的 v2 帧绑定重验通过，仍 `qualityPassed=false`。四帧并不覆盖全片，两轮、关键动作、阅读时间、听感和 43 风格基线未通过。

验证：`npm test` 62 文件、251 项通过；`npm run lint`、`npm run build`、构建后 `npm run typecheck` 与 `git diff --check` 退出 0。Node 22.23.1。真实探针为 `node --import tsx scripts/video/probe-composite-binding.ts --verify`、`probe-visual-evidence.ts --frames` 和 `verify-cached-critic.ts`。

没有 push 或生产部署。T06/T09/T12 partial。
