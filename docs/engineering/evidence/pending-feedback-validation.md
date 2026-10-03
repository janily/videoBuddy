# T13 制作期间反馈与冷恢复

2026-10-03，本增量实现 AT-021/AT-042 的制作中聊天反馈保存与基线保护部分，不将完整自然语言修改标完成。

Director 获取服务端制作状态，制作中更正默认只作为后续反馈。理解 Patch 仍按原 Understanding 和实际用户来源验证；更正、或没有 Understanding 字段可用的音乐音量反馈，保存不可变 pending-feedback 和分页索引。记录原本轮 completed 用户消息 ID、制作操作、briefVersion、consentEpoch、当前结果及可选 proposedPatch，execution 始终 not_started；当前制作的 brief、理解对象与预览有效性不被这些反馈改写。

用户自己发送的归档消息是来源，模型回复不能当用户授权。公共 pendingInputs 仅投影仍匹配原 consentEpoch/brief/currentResult 的消息 ID；取消或恢复改变授权时，旧记录保留而不再 eligible。不自动执行、合并、重新混音或发布。

失败→通过证据：

- 两个初始行为测试确认有效 Patch 导致旧实现直接把制作中 brief0 改成 brief1，退出1；实现后保持原 brief。
- 音乐反馈无 UnderstandingPatch 的测试先无索引失败，后按 pending_followup 保存原用户消息。
- SPEC 独立发现回复期间新资料 brief0→brief1/新制作开始，把旧 patch 装进新基线。修复保持原语义版本，新增回归当前 pendingInputs 为空。
- 两轴独立发现已完成模型 effect 后进程退出、制作取消、冷恢复重新读取 live context 导致预约哈希冲突/反馈丢失；缺原输入的 seed 不能代替真实已预约路径证据。修复先于预算/effect 保存带规范 hash 的 director-input，冷恢复核对项目/操作/brief/hash 并读取原输入和成本；旧 completed effect 无输入证明时拒绝推断新基线。
- 真实 FileStore 故障注入：effect completed CAS 实际落盘后使所有读取失败，原进程退出；新 FileStore 执行真实 cancelProduction，随后冷 Director 恢复。producer=1、budget.calls=1、原 epoch0/not_started 反馈归档，当前 epoch1/brief0/cancelled，pendingInputs=[]，回复 completed。

命令 `npm test -- tests/video/director-pending-feedback.test.ts tests/video/local-director.test.ts`：19 项相关测试通过；新文件5项覆盖正常制作、取消竞态、新基线竞态、无Patch音乐反馈、真实掉电恢复。完整 `npm test`：88 文件442项通过。lint、build、构建后 typecheck、diff-check 均退出0。两轴最终 clean。

测试使用临时 FileStore 和注入的结构化模型决定，0远端模型请求；不是新主题、音乐修改或全片质量的真实模型证据。本增量没有 UI 布局修改，没有新截图或媒体产物。既有真实项目、未知费用、全片质量门槛不改。完整 safe_direct 新mix→QA→新result、preview_required 修改闭环、物理清理、43风格86基线及 C0/C1/C2 继续未完成，未push或生产部署。
