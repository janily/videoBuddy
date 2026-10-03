# 无上限模型验证与实际迁移

2026-10-03，T03/T06/T12。用户明确授权后续正式全片和43风格验证“不限次数和费用上限”，[授权依据](../model-validation-authorization.md)及其SHA写入不可变本地授权。`VIDEO_MODEL_BUDGET_MODE=unlimited_validation` 只作用于显式授权的验证存储；默认预算/生成开关不变，媒体与TTS资源限制仍保留。

已知实际输出超预约仍记为overrun并增加保守计数，无上限验证允许继续；缺实际usage/进行中/未知消费继续冻结，旧阶段不得重跑。没有以Infinity/NaN替代整数账本，没有退款。

迁移专项先缺模块失败。审查发现缺失/空日计数会丢历史费用，以及冷恢复只比requestHash会接受损坏candidate，两项均经RED复现后修复。现在要求全部项目及所有历史日完整覆盖，并在每次恢复重建/核对整个计划。部分CAS/计划ACK丢失、旧回执不清新active、损坏候选、缺日计数、未知调用及已知超预约等28项专项通过；两轴独立复审关闭两项P2，无剩余实质发现。

实际 `tsx scripts/video/authorize-model-validation.ts --migrate` 退出0，见 [迁移报告](model-validation-migration.json)。旧诊断副本漏拷日JSON，显式导入SHA完全一致的原七次日账本。项目与日计数保留7次，input150282/output78879；原快照与计划保留，5原始响应/2历史报告均标historical，原制作源账本和诊断control未改，0新请求。不可把historical_report当作提供方账单认证。

随后真实 `node --env-file=.env.grsai.local --import tsx scripts/video/probe-approved-whole-critic.ts --review` 使用用户指定提供方/模型，对实际1080p影片第一批PNG发出1次多模态请求；120秒期限超时，退出1，见 [失败报告](approved-whole-critic-probe.json)。没有响应状态/原始body/实际usage，门闩及两计数为unknown，不自动重试；29批未完成、视觉质量未通过、control未改、未发布结果。不限费用并不能消除提供方响应超时或补造未知消费证明。

全量单元、lint/build/构建后typecheck结果见task-ledger；没有push或部署。恢复界面、其它未完成开发、43风格86真实基线和最终验收继续，C0/C1/C2仍未达到。
