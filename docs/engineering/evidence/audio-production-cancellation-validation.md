# T13/T14 音频阶段撤销与停止未知恢复

2026-10-04（上海）。基线 `8ae9c06`；implemented/tested，deployed=false，C0/C1/C2 未达到。

`prepareAudioExecutionStage` 向 sound/master 传递同一个持久授权检查。sound 改用唯一名称、标签及镜像绑定的 owned Docker 执行器，采用配置超时；启动前、运行中、完成后和输出核验后检查授权。任务、Python 工具和既有音频算法未变。

无法证明停止时，preview/render 固定归档 interrupted/MEDIA_STOP_UNKNOWN，持久 SSE 可冷重放且不重复生产者。控制态保留 unresolvedMediaStops，预览和批准准入及最终 CAS 均拒绝新制作，HTTP 409/retryable=false，现有错误展示说明内容已保留。旧任务迟到不清新制作槽、已有结果或其他任务的标记。

两轴审查补出并关闭了这些真实 FileStore 恢复窗口：

- 未知停止 outcome 持久化前断电，cold cancelling 被误报 cancelled。取消现在在撤销控制态的同一次 CAS 写入待核标记，先阻断新制作；冷任务不从逻辑 fence 推断物理停止。
- 没有用户取消的超时/停止失败后断电，同 epoch running 会再次调用 producer。两个 Worker 在调用制作链前持久 CAS 写 mediaAttemptStarted；已有启动记录且没有固定终态/可验证发布的冷任务保守中断，不能重进生产者。
- 未 claim 的预约取消成功后，清标记 CAS 丢 ACK。冷取消重放及冷队列核验 cancelled、null canonicalRunId、无 mediaAttemptStarted 后清理该操作标记，零 producer；已启动未知任务不能用这条路径清标记。
- 已提交预览 control 但 outcome 写入前断电，started 标记曾抢先阻断成功恢复。现在同 preview/brief/epoch 的已发布路径先核固定 publication、不可变包与实际媒体 SHA，零 producer 收尾成功。审查以原真实归档媒体的隔离副本独立复现；仓库对应回归使用明确标注的协议字节，不冒充媒体 QA。

RED→GREEN 记录：sound 四项原先 UNOWNED_EXECUTION，stage 三项原先 PRODUCER_FENCE_MISSING；公开 unknown 原先 cancelled；两 Worker 各三项断电用例分别复现 cancelled、producer=2、撤销后 blocker 缺失；冷队列未 claim 取消修复原先遗留 blocker。每个业务失败均执行后修复。两轴最终 clean；审查未调用提供方或 Docker。

实际媒体命令（Node 22.23.1）：

`node --import tsx scripts/video/probe-audio-production-cancellation.ts --audio-cancellation`

退出 0，见 [原始探针记录](audio-production-cancellation-probe.json)。固定断网 Docker 实际重建归档模型音乐、拟音和默认 mix，三个 SHA 均与旧归档相同；原项目 control/budget 未变、networkCalls=0、没有发布结果。隔离诊断项目调用真正 cancelProduction 后，检查三次、39ms 拒绝返回 stems，cold control epoch=1/activeProduction=null，operation 仍 cancelling。

本次 cancellationPhase=completed_before_return、containerId=null、containerRemoved=null。**没有观察运行中的容器，也没有真实 live-stop 或完整物理清理证明**。旧探针 limits 关于观察运行实例的条件不构成本次成功结论；脚本后续文案已明确，单独观察 running 后 absent 也不能证明在制作完成前中断。探针控制态仅用于生产者诊断，不是用户批准 FilmPackage、正式预览闭环或新修改结果。

验证 checkpoint：5 文件43项相关测试、首轮99文件504项全量测试通过；新增发布恢复测试所在文件13项通过。lint、build、构建后 typecheck 均退出0。最终全量结果另记下文。

限制：started 标记提供保守防重复，不提供容器 handle 的持久查询/核实清理；无发布证明的中断制作可能需要人工核实，不能重置标记后自动重做。正式修改准入/new revision/完整 QA/发布、loudnorm 与音乐下降意图的测量、实际运行中停止、物理清理、历史模型 unknown 用量及43风格86真实基线继续未完成。未 push 或部署。

最终全量：99 文件505项通过，47.10秒；最终 lint、构建后 typecheck 与 git diff --check 退出0。生产 build 退出0。本轮无视觉修改，未重跑浏览器套件；此前45项结果保持为历史记录，不计本次新增实测。
