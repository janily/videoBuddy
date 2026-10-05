# T11/T12：正式内容检查持久阶段与新发布门禁

2026-10-05，基线 `06e1213903de8249997cd893807d48f31fc79b0c`，初版 `accf9d7e5926221e0269ed0a1c107452e774345d`，修正 `f43b2b592622ac7491faa2ea227dc4a844289d8f`。

## 已实现

- `reviewApprovedContent` 使用当前 owner、正式 preview_button 批准、operation/fence、完整冻结 FilmSpec/facts、已完成成片、两轮抽帧计划和最终混音 ASR。所有图片在第一笔付费调用前实读，逐批 context/requirements/review 归档，完整覆盖记录持久化。
- 未分类事实采用完整来源文字的 literal 要求；Critic 不能自行改为 semantic。每批独立副作用记录，未知调用不重试，归档错误立即停止；已完成调用的归档恢复不重复决策。
- `mustExist` 复核通过禁止底层 create/CAS 的 store 读取已有合成和所有图片，不启动模型或媒体任务。取消、epoch 或源文件变化拒绝继续。
- 正式 pipeline 追加 content 阶段及 `delivery-qa-v2-stage`，保留已有批准包的质量策略哈希。新发布需要阻断级 `content_coverage`，并只读重验当前批准的完整持久阶段、实际 MP4 SHA、FilmSpec 和证据路径。单独传入 pass 行不能放行。
- 旧 critical_facts、听感、连续运动、许可、字幕同步等缺口不被内容检查覆盖。已有结果读取与冻结策略不改；发布成功的相同回执保持幂等。

## 实际测试

Node 22.23.1；所有命令在仓库根目录运行。

| 命令 | 结果 |
| --- | --- |
| `npm test -- tests/video/new-delivery-content.test.ts` | 原占位实现 RED；实现独立新发布门禁后 1/1 GREEN |
| 持久 stage 初始三测试 | 先 RED，随后 3/3 GREEN；见本轮执行记录 |
| `npm test -- tests/video/approved-content.test.ts tests/video/render-qa.test.ts` | 2 文件、11 项通过，22.35 秒 |
| `npm test` | 126 文件、638 项通过，55.22 秒 |
| 修正后 `npm test` | 126 文件、641 项通过，61.84 秒 |
| `npm run lint` | 退出 0 |
| `npm run build` | 退出 0，Next 16.3.8 生产构建成功 |
| 构建后 `npm run typecheck` | 退出 0 |
| `git diff --check` | 退出 0 |

持久阶段覆盖首次归档、只读冷核零写入、缺失阶段不触碰合成、超时只执行一次、决策期间取消、图片变化拒绝及归档故障后复用 completed effect。发布测试覆盖缺失 content、错电影、外部证据路径、缺失持久阶段、发布幂等及发布 ACK 丢失后的冷恢复。生命周期测试中的媒体/QA 是明确的单元边界注入，不能算作真实成片或内容质量验收。

## 实际媒体与阻断

本轮没有网络、付费模型、ASR 或 native 媒体执行，没有修改原真实项目、预算、unknown 回执或媒体文件。此前实际 20 秒 1080p 成片和 244 PNG 的技术证据继续保留；没有获得新的全片 Critic 或 Content Critic 判定。

旧全片 Critic 首次请求超时且没有 usage，unknown reservation 保留，后续真实调用不能用新空账本绕过。当前真实事实是整段流程约束，保守 literal 默认不会凭空转为语义通过；可信语义要求的生产与冻结仍待实现。完整听感/运动/许可 QA、公共正式按钮及修改闭环、43 风格 86 条实际横竖基线等仍未完成。C0/C1/C2 未达到；本项是可独立推进的生产接线，不是完整项目交付。无 push、无生产部署。

## 审查与修正

初版 Spec 发现 P2：completed effect 的 guard 只在首次调用的回调内执行，归档失败后的冷恢复可接受坏缓存。真实 FileStore 单元反例先 RED：改错 context SHA 并删 literalChecks 后，整个 stage 仍返回 pass 并继续其余 28 批。外层再次 guard 后拒绝；补充错 SHA 与缺 literal 两项，均只执行首个决策、不归档坏 review、不提交 stage。首次修正测试的预期错误类别写成 CONTENT_REVIEW_INVALID，实际严格 guard 返回 CONTENT_BASELINE_CHANGED，调整断言后通过。

Standards 发现另一 P2：stage/effect 键缺 round 时，采样图集相同的两轮会复用判断。使用真正采样算法的合法 24fps/480 帧/20 个每秒字幕时钟，在采样边界注入该计划，实际 RED 为 18 calls 对 36 batches。增加 context.reviewBatch、stage/effect key 及持久 descriptor 的 round/index 后独立调用，36 个 context/effect 身份不同。图片可复用，但不能复用两轮判断。旧无 reviewBatch 的 context 仍保留原哈希；没有迁移实际诊断资料。

固定修正快照 `f43b2b592622ac7491faa2ea227dc4a844289d8f` 双轴复核 clean。Spec 独立重跑坏缓存恢复，拒绝错误 baseline、首决策仅 1 次、归档 0；相关 2 文件 16 测试通过。Standards 独立纯内存核实相同图集的两轮产生 36 个独立键，错误 baseline/缺 literal 的 completed 输出均在归档前拒绝、0 新模型调用。两轴没有执行外部网络或真实媒体生产。这里只完成此增量审查，不代表完整项目所有规格通过。
