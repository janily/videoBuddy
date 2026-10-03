# T04/T06 原生增量回复

默认聊天 Worker 使用 Mastra `objectStream` 的实际部分 JSON 回复。每个增量立即写持久事件，结束后严格解析 GuidanceDecision；预算记录实际 usage，再验证风格和语义。没有计时器模拟文字，也不再等完整模型结果后拆回复。

本地 HTTP SSE 测试中，提供方必须等首个回复回调才发最后一段，证明增量在结束前发生；UTF-8 表情跨网络字节拆开仍正确，最终非法 style 被拒且实际用量已经 settled。真实提供方见 [director-stream-probe.json](director-stream-probe.json)：Gemini HTTP200、首片段8.002秒、完整10.646秒、3个片段、输入4110/输出1807 token。仅一物理调用，零重试，120秒截止。

停止回复保留已有文字并抑制后续片段，不更改制作通道；网络失败归档已有片段；冷 Worker 从同 epoch/message 的持久事件恢复文字，未知 started effect 不重复请求模型。

失败→通过：缺少流式模块；中断/停止丢失 partial；冷 Worker 丢失日志文字；超过16KiB的合法长中文片段；append已fsync但确认丢失时归档为空。最后两项由独立复审复现。修复后1024字符安全拆事件，offset连续、表情完整；错误归档前以持久日志为权威。日志不可读取时不提交空终态，保持可恢复。取消在增量写入、归档对象创建、控制态提交三个边界的独立测试确认制作通道保持不变。

`npm test` 63文件258项通过；lint、build、构建后typecheck退出0。保留实际预览、审批、正式制作和导出 Worker/UI 的未完成项；不能据此声明C0/C1/C2。没有 push 或生产部署。
