# T14 删除准入及取消恢复验证（2026-10-03）

范围：删除命令落盘、原命令冷重放、即时撤销授权、操作取消及 Worker 冷扫描。尚未完成物理文件、缓存、容器与未知外部 effect 的清理；202 始终 `cancelling`，不是删除完成。没有新增界面入口，也不将 AT-045 标为整体通过。

DELETE 使用实际 clientCommandId，命令 intent 与 control tombstone/receipt 通过持久创建和 CAS 保持幂等。owner、过期、跨命令 ID 冲突均检查；删除后拒绝 GET、素材访问和新下载，旧短 URL 仍以既有服务规则为准。重复同命令不再次增加 consentEpoch/controlVersion；不同命令不能读取删除回执。取消失败返回可重试错误，原删除标记保留，原命令重放继续扫描。

操作库存扫描包括不占 activeProduction 的 export 与孤立操作，严格绑定 projectId/id/status/fence。未 claim 的 reserved/queued 取消，运行中操作加 fence 进入 cancelling，terminal 不修改；不触碰别的项目或预算账目。首次 Worker 派发前及后续维护扫描恢复 tombstone 的取消进度；库存有界且拒绝符号链接。单项目损坏记录会记录失败，不阻止其他健康 tombstone 的取消。

失败→通过：

- 新服务模块缺失，首轮 project-deletion 测试失败；实现后冷重放/取消/跨项目/写入失败/并发/命令冲突通过。
- Director 删除前调用、调用中成功、调用中失败三个真实本地 FileStore 测试原先都因 ACCESS_NOT_FOUND 无法收口；修复后没有新消息归档，删除前 0 模型入口，操作 cancelled，失败 effect 原 started 状态不变。
- 两轴独立审查复现 P1：tombstone CAS 成功后 ACK 丢失、取消扫描未执行，冷队列仍发起生产入口；以及模型 started 账本 CAS 期间删除，SDK 仍发 HTTP。修复为首次扫描先于派发、Director effect 前新鲜检查、原生 generate/stream 的 markModelCallStarted 前后双检查、删除后不归档而收口。
- 实际 Mastra SDK + localhost HTTP 的两项 RED 原先抵达本地400，GREEN 为 provider HTTP 0 次；mark 后撤销仍保留 unknown 账目，不退款、不重试。审查者用独立 CAS 注入/fetch 拦截确认两个窗口闭环。

最终命令结果：`npm test` 85 文件 / 411 项通过；删除+Director+SDK五文件目标 32 项通过；`npm run lint`、`npm run build`、构建后 `npm run typecheck`、`git diff --check` 通过。DELETE route 两项使用真实生产 FileStore/Python CAS 与匿名签名 cookie，202/no-store/冷重放/404/403/400 通过。未变更界面，因此没有新增截图或浏览器计数。

新真实收费调用 0；实际诊断项目、未知模型账本和媒体均未删除或修改。C0/C1/C2 未达到，implemented=partial，tested=上述范围，deployed=false；未 push 或生产部署。

后续：停止关联资源的持久证明、未知 effect 的处理、私有文件与全局缓存的依赖库存/安全清理、30天过期协调、最近项目删除与持久重连接口、运维恢复。不能仅凭 operationsPending=0 就清空目录或报告删除完成。
