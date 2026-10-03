# T13 音乐修改候选的来源冻结

2026-10-03，接续音乐总线与浏览器目标增量。music-change-plan.ts 新增内部候选草稿的持久化/冷核验；尚未接 Director、公开 API 或 worker。不按文字关键词执行，输入为严格单一整片 musicGainDb −6..0、无事实改变的结构化候选。更广泛改动应走未来 preview_required，当前此专用入口拒绝。

候选与正式授权分开：candidateRisk=safe_direct 只是拟议类别；execution=not_started、budgetReservation=null。确认原用户来源不等于已验证用户语义，尚缺模型语义判断、音乐总线存在/原增益证明、真实预算预留/幂等操作准入、混音/全片QA与发布。不能将候选作为正式执行批准，不能计 AT-040/T13 完成；静音协议夹具也不证明实际有音乐可调。

实际行为：核对匿名 owner 和 live ready/currentResult；原来源必须为已归档 completed 用户消息，保留真实 clientMessageId/operationId，明确 artifact/revision 且无局部时间。消息索引根/块/消息引用均验证项目前缀、canonical hash、UTF-8字节数，冻结原消息hash。只读实际影片文件/hash与冻结交付策略/完整检查，原结果必须为当前结果。固定 changePlanId 同内容冷重放，同ID改变候选拒绝。候选冻结 result/hash/bundle/brief/consentEpoch、原检查清单；不会更新control、排队、混音或调用模型。

失败→通过：6项 FileStore 测试先因缺模块退出1，模块实现后初5通过。新增真实竞争行为测试：读preview manifest时CAS递增consentEpoch，重检原先错误返回候选（有效RED）；最后再次核 live ready/epoch/brief/currentResult/messagesIndexRef 后GREEN。此检查不是将来操作准入的原子CAS替代品，执行时仍须重新核验。

6新测试覆盖冷重放/幂等漂移、foreign owner、assistant建议/null/错误目标/局部时间、事实/色彩/超范围/重复/注入authorization拒绝、取消/brief/result/activeProduction变化、源消息bytes篡改、实际影片bytes篡改、完整质量记录缺失，以及读基线期间撤销。使用真实生产FileStore/Python CAS与临时objects；影片内容明确是协议字符串，不是媒体质量通过，也不证明真实render/模型。

相关change-policy/消息route/新草稿共13项通过。完整91文件455单元通过，43.96秒；lint、build、构建后typecheck、diff-check退出0。两轴独立复审clean，SPEC独立6项全部通过。本切片没有UI变更，不新增截图；前一提交完整45浏览器通过，见 feedback-target-ui-validation.md。

0 provider、0媒体生产、0既有真实control/预算改变。原unknown用量门闩保留，不限调用/费用授权有效。正式改稿、小白闭环、43风格86实际基线和C0/C1/C2均未完成；没有push/生产部署，项目继续。
