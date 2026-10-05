# 冻结来源条件的视觉验收接线

固定实现：`39b6bf682468291e0ff3e47b89d65ee2bb4c8131...7f3913b0572002304a891fe22ddd09b167b18df0`（初版 `545e2ee`；边界修正依次为 `0376ec2`、`14239c3`、`68afe82`、`7f3913b`）。这是 T11/T12 局部开发，完整项目、43风格和 C0/C1/C2 未完成。

新 facts v2 的完整事实、sourceRefs、独立审核条件及 immutable proofRef 从已核验冻结包进入 Visual context。事实清单的 canonical SHA 与字节数共同绑定；模型不能改选条件。Visual v2 逐项给出全部 literalChecks，不同姓名/日期可以分别在不同帧出现，但同音异字、遗漏条件、无可见文字、跨来源和跨轮报告不能通过。只有普通语义的事实在 Visual 中保持 not_checked，不能用抽帧取代完整内容 QA。

两轮聚合逐字面条件核验。新版 critical_facts 门槛同时要求字面条件通过和独立完整 Content QA 通过，绑定同影片、FilmSpec 及 factsManifest SHA，并保留两份证据。旧 facts/Visual v1 合同与其完整原文字面要求不升级。连续运动、听感等原发布门槛继续独立阻断。

发送前共享纯校验提前到预算/effect 准入之前，核实际 PNG 字节/SHA/签名、完整上下文、风格规则、请求上限。已有 completed/unknown effect 先读取，不再次要求新配置或预留预算；completed 输出在归档前重新 guard，unknown 不重试。

## 实际测试

- `npm test`：132 文件、668 项，66.16 秒，退出0。本次完整回归没有失败，也没有与构建/目标测试并发。
- `npm run build`、构建后 `npm run typecheck`、`npm run lint`、`git diff --check`：均退出0。
- 先失败后通过：新 context 缺 sourceCriteria；factsRef 字节数未核；native payload 未提供可复制的 criteria SHA；Visual evidence 未接冻结条件；错误 PNG 在预算准入前拦截；归档恢复错误要求 generation 配置；completed 缓存错误未在归档前重新校验。均为本地反例，不是云端模型质量判断。
- native transport 测试走实际 Mastra→本地 loopback HTTP，精确 usage 120/60 结算；它只证明协议及失败处理，不能作为真实视觉判断。
- 实际旧冻结影片：`audited-visual-legacy-preflight-probe.json`，31批244PNG全部通过新共享 preflight，第一 context 与原已归档请求一致；成片 SHA `cb5ac8454a867abb361fbe13fafd9fd07e09335c76685a672e94cc931bc6d0fd`，10,608,051字节前后相同。原项目及隔离 unknown 项目的全部 JSON 前后哈希一致，0 store writes、0 network/model/native executions。旧 facts v1 没有伪造来源审核或升级为 v2。

## 限制与复核

真实新来源分类/独立审核、v2 模型视觉判断及完整内容 QA 尚未执行。旧全片首请求 180秒超时，原始响应和 actual usage 未知；原 reservation/project/daily/gate 保留 unknown，不退款、不重试、不另建空账本绕过。没有 formal preview_button production approval，没有发布正式结果；未 push 或部署。

初次 Spec 轴发现 P2：字面锚点“8日”能从错误日期“18日”中被子串匹配接受。新增合法冻结条件反例先失败；v2 匹配保留数字间标点并检查数字/符号边界，8日/18日、十月八日/二十月八日、18元/1.8元、8元/−8元、8/8.5 均拒绝，正确文本均通过。旧 v1 匹配行为保持。目标两文件9项通过；首修正完整回归132文件669项64.75秒退出0，build/lint/构建后types退出0。

第二次 Spec 复核发现同 P2 的全角小数点与百分比遗漏：1．8元仍满足8元，8%仍满足裸8。追加两例及全角百分号、分数、科学计数法共5组 RED→GREEN；统一数值延续字符集合拒绝这些数值内截取。该版完整132文件669项65.10秒通过，尚有后续反例。

第三次两轴均发现普通英文 e/E 误拒：Grade 8、Grade: 8、There are 8 eggs、There are 8 examples。四组正确文本先失败；只识别实际指数数字序列后通过，1e8/8e3继续拒绝。`68afe82` 全套132文件669项58.69秒通过。Spec 随后发现带负号锚点会在范围内匹配（-8度/1-8度）；与同时新增 -8元/1-8元本地反例一致，先失败，扩展有符号数值左边界后通过，目标两文件9项通过。`7f3913b` 最终全套132文件669项65.28秒通过。以上初次发现与各固定快照结果完整保留，不把中间 green 作为最终完成。

最终固定 `39b6bf6...7f3913b` 两轴分别结论：Spec clean（目标纯合同9项通过）；Standards clean（内存执行最终函数17组正反例符合预期）。两轴只读且无云/媒体执行。最终 `npm run build`、`npm run lint`、构建后 `npm run typecheck`、`git diff --check` 均退出0。
