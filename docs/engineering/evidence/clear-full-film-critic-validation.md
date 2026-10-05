# T11 全片视觉 preflight 与真实超时阻断

2026-10-05。implemented/tested；未部署、未全片视觉通过、未正式批准或发布。

新增 prepareWholeVisualContexts：先重算完整计划并核31批覆盖、轮次/index/精确帧序、每批影片与runtime及protected facts，生成严格VisualReview context；缺批/换帧/换影片或runtime实际两项RED→GREEN。调用方首次付费前实读核验全部244PNG；各批调用后再核图片，汇总前再次核全部PNG及MP4 bytes/SHA。上下文/评论独立不可变归档、继承真实用户不限费用授权到新验证账本，原project/budget/两operation保持不变。每批至多1调用，HTTP deadline180秒、0retry，raw SHA/usage/accounting精确对账，未知请求或账目停止。不改变旧literal facts guard、不删除protected facts或用方案代替实际画面。

初脚本typecheck发现generic括号/Environment推断，修复后lint/types通过；首次121文件618项51.12s/build通过。Standards P2发现评论归档fsync/ACK丢失被catch误记为输出blocked，可能继续付费；独立重放复现 paidCalls=2。新增runAndArchiveProbeReview只捕获四种明确semantic rejection，归档在catch之外，其它storage/execution错误上抛。两个协议测试实际RED→GREEN：首归档ACK丢失只执行一次、语义拒绝不归档且STORE错误原样抛出。最终122文件620项52.83s，lint/build/构建后typecheck退出0。固定快照 c1700209aebd0dd910acd5a6ee5e00a7c1d623cd（base714c5bb）两轴clean。

## 实际模型失败

[实际请求记录](clear-full-film-critic-probe.json)：运行根 .video-local/clear-full-critic-UGy32l，首 round-1-batch-0 / gemini-3.8-flash 于02:16:33Z开始，02:19:33Z TimeoutError，180秒。无HTTP状态、原始响应或可核对用量。reservation SHA 5dd18334…，预约86779 input/16000 output只代表保留额度，不能冒充实际消费。withAccountedModel保存unknown，脚本退出1 CLEAR_FULL_CRITIC_USAGE_UNCERTAIN。后30批没有请求，0新增native，未清空/退款/重试或另开账本绕过未知阶段。

[独立超时审计](clear-full-film-critic-timeout-audit.json) 冷读精确project/daily/gate：calls=1，accounting及active gate=unknown；原始响应不存在，实际token为null，原project/control/budget/operations不变。计划和244PNG付费前检查已经执行，不等于模型审完这些帧。

真实进程在归档P2修正前已加载初版；没有收到模型响应，因此未执行评论归档且无该归档错误。新错误保护由故障注入测试证明，不声称真实请求使用新helper，也未重复请求以补证明。首次脚本把网络超时记blocked后，原已有unknown检测停止全部后续调用；最终代码对非语义异常直接向外抛出，两个版本都保留原unknown事实。

## 仍待完成

这次不是视觉通过：没有有效review/aggregate，全部全片质量仍未完成。未知首请求不能静默重新执行。下一步继续独立QA契约：区分跨镜头流程语义与精确字形/名称/数字证据，旧严格记录及失败保留；连续运动、完整听感、字幕停留、字体/许可、正式公开闭环、43风格全部真实基线与完整验收仍待完成。C0/C1/C2未达，无push或生产部署。
