# T14 导出任务与下载权限验证（2026-10-03）

## 实现范围

POST `/api/video/projects/:projectId/exports` 已接入 MP4 直接下载及 source_zip 异步导出。只有 owner 当前或上一份已发布结果可用；重新验证冻结 bundle、质量策略/全部 mandatory checks、实际 MP4 hash/bytes，再执行导出。没有合格成片时拒绝；其他格式明确 `CAPABILITY_UNAVAILABLE`，不创建示例文件。

source_zip：持久命令/输入槽 → 导出 operation 与本地队列 → 已冻结资料的真实 ZIP → 私有不可变对象/逐 artifact 发布记录 → 控制态 CAS 开放下载 → 独立 outcome 归档及持久 SSE 终态。缺少 Worker 心跳或入队失败，503 返回同一 reserved receipt；冷进程从输入槽恢复原命令身份、操作及队列。重复命令保留原身份；不同命令合并同一活跃尝试；明确新命令允许在取消或失败后创建新尝试，旧操作不复活。

取消导出通过独立控制态取消意图及操作 fence，和 ZIP 可见性 CAS 竞争；不修改制作状态、consentEpoch 或视频指针。孤立的 prepared ZIP 不可下载。发布/取消/预约 ACK 丢失均可收束；终态导出清理队列前先补归档和 SSE。删除/过期后的既有发布可恢复操作终态，但访问仍被拒绝，也不重建已清理的文件。

不可变对象写入器：150 MiB 界限；每级目录采用 descriptor + O_NOFOLLOW；排他0600临时文件、hash/bytes校验、原子link、file/目录fsync；不覆盖已有对象，只修复同 digest/同 inode 可解释临时别名，拒绝未知硬链接。普通下载继承短期 owner/purpose 令牌、实际文件 hash、私有缓存头和删除权限检查；ZIP 无 play 权限。

Worker 仅在聊天/预览任务执行前检查模型生成配置；文件导出无需模型凭据。真实 Worker 子进程在只有 PATH、NODE_ENV、VIDEO_DATA_DIR、generation=false 的环境下启动，写真实心跳，SIGTERM 后退出0；没有把生成开关绕过给聊天或预览。

## 失败→通过与实际证据

新 seam 先因缺少模块失败；初始流程通过后，两轴审查分别发现/复现并修复四项恢复缺陷：取消后新命令无法再导出、发布丢ACK后删除无法收束、槽创建丢ACK导致原命令身份改变、取消终态丢ACK导致无归档/无SSE。相应断言先失败，修复后通过。最新导出15项及队列4项通过。

覆盖 authenticated Request/Response handler 的 POST202 receipt →实际 Worker executor→持久终态→POST200 access→文件响应/真实ZIP字节；不同会话及删除后404。该正向协议测试使用明确标记的合成 QA manifest/非视频 fixture，不能当成真实最终影片质量通过。

`Node22 npx tsx scripts/video/probe-export-object.ts --exports` 使用先前真实工程包：64条目、27,307,795字节、SHA `6d72359566d6047f3685067bafd397196b1e4ff4e6313b119588339cf098aac1`。实际写入/replay hash一致、0600、nlink=1；不同内容替换同对象被拒绝，Python独立ZIP CRC通过。真实批准诊断项目只有预览、没有最终已发布合格结果，导出申请被 `RESULT_STALE` 拒绝，queuedOperations=0。原控制态未改，新增模型调用0；见 [export-object-probe.json](export-object-probe.json)。没有为此构造假的真实 QA 或修改原制作预算。

完整回归、构建和两轴复审结果见任务账本。implemented/tested 为上述服务增量；deployed=false，未 push。

## 尚未完成

本页记录 source_zip 初次服务验证。随后 SRT/Treatment/CREDITS/quality 已接入同一服务，范围和测试限制见 [文字导出验证](export-documents-validation.md)。产品下载交互、poster、素材分发许可与清理仍未完整接通。正式影片的实际视觉/连续运动/听验及原子发布、自然语言修改、43风格86横竖基线和全验收仍未完成，C0/C1/C2 未达到。旧项目7次历史模型调用缺完整实际用量，仍为 `MODEL_ACCOUNTING_MIGRATION_REQUIRED`；未重置账本，未新增付费请求。
