# 模型验证超时诊断增量

2026-10-03。用户追加调用次数和费用无上限授权继续有效。本增量没有新增真实模型请求，没有修改既有 control、预算、未知调用或部署门闩。

提供方只读文档检查：官方 [Chat API](https://grsai.com/dashboard/documents/chat) 和 [POST /v1/chat/completions](https://qmy27nhsd9.apifox.cn/452418916e0) 描述返回响应 ID；图片/视频分类下的 [GET /v1/api/result](https://qmy27nhsd9.apifox.cn/452409577e0) 要求任务 id。既有全片 Critic 超时没有返回供应商 ID，不能把本地 reservation 哈希当作供应商任务 ID；上述已读文档没有说明按本地请求或请求时间查询文本聊天消费的方法。这不是证明供应商完全没有其它查询能力。未向查询接口发送猜测 ID，未知消费继续保留。

诊断工具改动：通用 helper 默认仍为120秒；正式全片只读探针默认600秒，可通过 VIDEO_CRITIC_PROBE_TIMEOUT_MS 显式选择1至900000毫秒。非法期限/次数在安装 fetch 包装之前拒绝。保持零自动重试、原有目标限制和 caller/Request 的取消信号。扩大期限不会解锁旧未知账目，也不允许重放旧 effect。

每次尝试保存 startedAt、timeoutMs、收到的 HTTP status、响应体读取完成或失败时的 finishedAt，以及有限错误类型；没有响应就没有 usage，不伪造零消费。响应正文超时立即处理诊断 Promise，避免未处理拒绝或 flush 覆盖原请求失败导致最终报告丢失。诊断文件保存失败单独标记 DiagnosticWriteError。原响应仍由真实消费者处理；账本结算规则未改。

TDD：新增3测试在旧实现均失败（非法限制未拒绝、短期限不生效、缺超时元数据）；实现后通过。两轴复审独立发现 HTTP headers 后正文超时的 P2，修复并新增第4项回归。两目标文件6项通过，使用临时目录、mock transport 和既有 localhost 原生 Mastra 测试；不冒充远端模型质量验证。

本增量没有界面改动，不重跑浏览器截图作为模型证据。真实全片29批、视听质量、自然语言修改、物理清理、43风格86基线和完整交付仍未通过；C0/C1/C2未达到，未 push 或生产部署。

最终检查：87文件437项完整单元测试通过；lint、build、构建后typecheck和diff-check均退出0。
