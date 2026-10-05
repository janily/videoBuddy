# T11/T12：来源审核证明接入新预览、冻结制作包与内容 QA

2026-10-05；base `47d90ca`。

## 实现范围

新预览先创建完整来源分类、独立审核，再进入 treatment/声音/画面创作。来源审核 reject/not_checked 时没有可用证明，不能启动后续创作。技术重试读取原已冻结影片，不重新分析来源或升级旧冻结包。

新版 facts manifest 为 schemaVersion 2，在完整 facts 外引用所属 project/revision 的不可变 `content-requirements-proof`。证明绑定完整 Understanding ObjectRef、context、候选分类、独立审核和派生条件；加载冻结包时只读验证整个图和 SHA/bytes/命名空间，不能使用被改动的审核、替换原文、遗漏事实或伪造派生条件。原阶段读取复用同一验证器；历史 facts v1 原哈希继续保持。

新制作包装配要求来源阶段存在、当前 preview operation/epoch/Understanding 匹配；装配只消费已审核结果，不启动模型。复用已有冻结包直接读其中的 facts/proof，不依赖新可变来源阶段，不改包。

正式 ContentCritic 输入读取冻结条件；context 的事实清单 SHA 包含 v2 proof 引用，引用改变也会改变输入。旧影片继续完整原文字面检查；**原 Visual v1 critical_facts/name guard、听感、运动及发布门禁没有放宽**。本项不宣称其他 QA 或 T11/T12 全部完成。

## RED → GREEN 与检查

- 新证明读取与冻结 facts v2：3 项先因 NOT_IMPLEMENTED/不支持 v2 失败；实现后通过。首次期望误写成另一个 fixture 的 `Known fact`，改为此 fixture 的真实固定原文“活动在十月八日开始”。测试检查真实 FileStore 图的只读零写入、原文/审核/派生条件/归属篡改及历史包不变。
- 原 voice→timing→audio→visual→film→excerpt 集成的 4 组合：初版新断言显示缺来源仍错误冻结 v1，RED；新准入后先要求来源证明，再冻结 v2。补齐此测试原先没有的真实 preview operation/commandId，并为后续另 revision 取消场景更新 operation binding；没有放松生产 fence。5 文件共 29 项通过，41.39 秒。
- 正式内容读取：初始仍按 v1 清单重算 SHA，报 CONTENT_INPUT_CHANGED，RED；新版 context 同时绑定 v2 proofRef 后，检查实际传入 semantic 普通关系、literal 日期“十月八日”，存储完整审核条件并冷读；审核被篡改后拒绝，无新决定。
- 新 pipeline 源审核拒绝：移除未验证的接线后，实际先向 treatment 请求并发生输出结构错误，RED；接线后仅 source activity 和两次 native Mastra 本地 HTTP、二者 123 input/67 output 精确 settled，随后 CONTENT_REQUIREMENTS_UNAPPROVED；没有 treatment、媒体执行或交付。1 项通过，2.12 秒。

这里的模型响应、合成音频/媒体输出均为现有本地协议 fixture，只证明调度、持久图、fence、准入和记账行为；**没有把它们当作真实模型分类、真实影片质量或云验收**。本轮外部付费调用 0，不创建生产批准，不改此前真实 control/预算/unknown，不 push/deploy。

实现 commit `4c1286d`。全套 `npm test`：131 文件、661 项通过，65.71 秒；`npm run lint`、`npm run build`、构建后 `npm run typecheck`、`git diff --check` 全部退出 0。初始 typecheck 发现测试的 ObjectRef mime 被宽化为 string，显式保持 `application/json` 后通过。固定 `47d90ca…4c1286d`：Spec clean，独立 2 个 FileStore 套件 12 项通过、0网络/模型/native；Standards 提出下述 P2，修正后结果待追加。

## 原真实冻结影片的只读重验

使用修正后代码，通过 `npx tsx -e` 执行 readonly FileStore 诊断（原 private technical/published/critic 报告定位原始引用），结果见 [真实旧制作包重验记录](source-requirements-frozen-history-probe.json)。真实 FilmSpec `2218d7f2…`、facts `60f3ad98…`、Understanding `2b6fd6be…` 完整 graph 读取成功；facts 仍 v1、完整 1 项、没有新来源审核证明，原哈希保持。

读取器禁止 create/cas，fetch 被禁止：实际 writes=0、network=0、model/native=0。原 control、budget、两 operation、9 native journal 及隔离诊断的 unknown project budget/gate 前后相同。该实核只证明原真实包在新读取器下不升级、不篡改；不代表真实新分类、模型审核或成片 QA 通过。

## 后续

仍须真实生成并独立审核新来源条件、验证完整全片内容和新包公开闭环；原 full Critic 的 180 秒 timeout 没有原始响应/用量，unknown 留存，不因新证明解除。原批次 frames、运动/听感/许可/字幕 QA、修改发布闭环、43 风格 86 横竖及公开 profiles、22 FR/92 AT/16 Agent/5 用户、恢复/运维与 Vercel Preview 等仍未完成。C0/C1/C2 未达。

## 审查 P2：冻结条件与内容消费者的 Unicode/有效文字契约

Standards 纯契约反例：完整来源 `Café 和 Cafe\u0301`，两名称都 literal、审核全 accept，但初版按原字符串 Set 去重，正式内容合同按 NFC 要求唯一；不可变 proof 可以形成，却在后续 CONTENT_INPUT_INVALID。标点-only literal `。` 也被生产者允许、消费者拒绝。

两项合同回归先 RED：规范化名称错误保留两项、标点条件没有拒绝。修正保留原完整 facts/segments/proposal/audit，只按 NFC 为派生 exactText 去重、保留第一次出现的原写法；生产者和消费者复用 `guardContentRequirements`，在创作/冻结前拒绝无法消费的条件。不改原文、不删独立审核条款，不使用 semantic 回退。修正 commit `f9a659d`；定向 4 文件30项通过（56.07秒），lint/build/构建后types退出0。首次修正后全套与定向及build并发：130文件/662项通过，但 voice-stage 的 Systran/faster-whisper-small 组合触发原15秒 test timeout（总68.82秒、1失败），不能称全套通过。所有并发进程结束后，保持相同代码与15秒阈值单独重跑全套；单独重跑 `npm test`：131 文件、663 项通过，63.30 秒，未改超时阈值或生产代码。固定 `47d90ca…f9a659d43` 两轴复核均 clean。

- Spec：独立两个纯合同套件18项通过，完整来源/候选/audit不变、无 semantic 回退，旧v1/原发布门禁保留；0网络/模型/native。
- Standards：独立原 NFC 名称反例可生成合法 v2 内容 context；纯标点冻结前拒绝；0网络/模型/native，无剩余实质发现。
