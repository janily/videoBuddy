# T12 正式制作 Worker 与批准 API 验证（2026-10-03）

## 实现

POST `/api/video/projects/:projectId/preview/approve` 已使用既有 schema5 唯一 preview_button 批准逻辑：匿名 owner、Origin、generation 配置、真实 Worker 心跳、brief/preview/revision/bundle/script/facts hash、幂等 command。返回202 render receipt；入队失败保留原批准/原 operation 并返回 START_FAILED receipt，不另造审批。冷 Worker 从已提交 activeProduction、取消指针及 renderOutcomes 恢复队列；不执行尚未提交批准的孤立 reserved operation。

正式任务默认执行冻结 `loadApprovedRenderInputs` → 原全片1080p画面/音画/字幕与 postmix 核验 → 原生两轮 Critic → 持久完整交付检查候选。角色配置先于媒体/付费调用；创作模型不重新生成已批准源码、故事、音轨。每阶段维护批准/owner/consent/fence/版本约束，阶段 activity 进入真实持久 SSE。

新的交付检查编译器检查成片、响度、postmix、视觉报告的 film SHA 一致，保留实际技术项、critical facts结果与失败观察。两轮 sampled_frames 即使 pass，也不能代表连续运动通过；无旁白配乐/音效仍需听验。只有已解码的 intentional_silence 加实际响度不适用证据允许 listening/loudness/true_peak N/A。字幕、字体、许可缺独立证据保持 not_checked；不自动豁免。

只有严格 validateDelivery 全部通过、实际文件字节和批准基线仍匹配时，Worker 才复制最终 MP4 到私有不可变对象，写 artifact manifest 并调用 publishResult。复制限制 composition/<SHA>/output/final.mp4、单链接、O_NOFOLLOW、前后stat和实际hash；对象端 descriptor/no-follow/0600/link/fsync 规则复用既有写入器，固定 final.mp4，界限150MiB。quality 阻断在复制/开放下载之前。

发布的 control CAS 同时更新 current/previousResult、清 activeProduction、写固定 success结果hash到 renderOutcomes。失败/取消/超期分别保留旧片段/旧结果、撤销生产lane并保存固定 outcome。随后固定 render-outcome归档、去重 result.ready/operation.terminal、操作终态与队列清理；ACK 丢失只恢复已提交结果，不重新生产/付费。删除后的已提交成功也能收束终态，不重建已清理对象或开放访问。

ProjectView 现在能返回正式失败说明，使用终态 controlVersion 排序；旧记录回退关联 receipt 顺序，不按角色固定优先。

## 失败 → 通过与实际执行

- 新正式 Worker 测试先因模块缺失失败，最初关联旧队列测试实际暴露无control技术fixture扫描失败，修复为跳过缺失control而继续健康任务。目标测试随后通过。
- SPEC 审查发现旧 render 失败遮蔽同brief/epoch下更新的 preview 失败。失败断言先得到旧 operationId/QUALITY_BLOCKED；改按真实提交顺序后，通过实际 runApprovedRenderOperation → preparePreview → runPreviewOperation → ProjectView 流程，返回新的 operationId/PREVIEW_QUALITY_BLOCKED。独立完整复现关闭P2。
- 批准 authenticated HTTP202/幂等重试、改请求hash409、异会话404；失入队保留原receipt并冷发现。Worker验证发布/失败CAS ACK丢失、删除后已提交成功收束、预先取消、制作中取消、冷重放单SSE、旧结果/片段保留、不执行未提交批准的孤立操作。
- 正向发布生命周期用明确标记的合成QA及2048字节非视频协议夹具；只是验证真实文件写入/指针/访问与恢复边界，不代表真实MP4或最终影片质量通过。
- 实际 Node22 Worker 子进程没有模型凭据、generation=false，未预先入队，冷扫描发现批准任务；实际心跳、GENERATION_DISABLED固定失败、单终态SSE和SIGTERM退出0均通过。没有媒体制作、模型请求或展示成功影片。
- 质量编译器3项直接验证：sampled visual pass不代替运动/听验/字体/许可；music无旁白不获听验N/A；错影片证据拒绝，真实fail保持fail。

Node22 `npx vitest run tests/video/render-operation.test.ts tests/video/approved-delivery-checks.test.ts` 2文件14项通过。完整 `npm test` 78文件371项通过；lint、Next16 build、构建后typecheck、diff-check均退出0。两轴独立审查无剩余实质发现。

## 未完成

本页只把 T12 API/Worker/发布生命周期接通，T12不标完成。真实正式渲染生产者与抽帧的历史证据见 approved-composition/approved-visual 报告；本次0新增模型调用，没有运行新的真实完整QA或正式用户批准闭环。原7次旧账本仍 MODEL_ACCOUNTING_MIGRATION_REQUIRED，未清零或绕过。

默认完整报告的连续运动/听验/字体/许可仍缺独立通过证据，严格 gate 会阻断；正式UI按钮保持disabled，未把技术成片作为可交付结果。还缺正式旁白字幕实测、实际全片Critic/听验、质量修复、最终发布用户闭环、下载交互/poster/修改/清理、43风格86基线及完整验收。C0/C1/C2未达到。implemented/tested为本页增量，deployed=false，未push或部署。
