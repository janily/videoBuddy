# Canvas约束后的真实音画与最终混音（2026-10-04）

## 已完成实现和协议验证

Visual生成规则要求动态主Canvas每次render重置完整状态、按种子/时间重新建立随机序列；静态离屏素材保持，旁白字幕统一交合成器，不重复绘制字幕底板/打字机字幕。原43风格及design不改，确定性门槛仍为同时间PNG字节相等。

Audio若在SDK对象校验时失败，先让transport完成并记录实际usage，再拒绝无效对象。SDK的warn不等于业务放行：undefined object明确MODEL_OUTPUT_INVALID，原strict AudioPlan/domain guard仍执行，不删未知字段、不用fallback、不重请求。实际localhost Mastra/HTTP协议测试从失败到通过：带多余$schema的响应仍被拒绝、usage100/200 settled、请求只有1次。安全失败码增加渲染、词时间、模型格式和最终混音不匹配；4项实际FileStore/SSE/冷读取测试先失败后通过，确认不暴露native路径/细节，不重复执行。

## 第一轮新预览的已知格式失败

[Canvas约束预览](new-theme-canvas-reset-preview-probe.json)：operation `dafc18d9-5419-4367-ad29-db65e0361604`，revision `0a457df3-201a-420e-8b1c-f081372d2395`。四原旁白、Timing已通过，Audio HTTP200返回多余$schema，严格schema拒绝；没有进入Visual。原始响应SHA `18e54df0ea89983c3a395633ddc3c0d62f556c0cf93e4d2bb12930139fe6c231`，实际9048 input/4233 output。

旧SDK抛出前未给业务usage，预算保守unknown。[单次原响应对账](canvas-reset-audio-usage-reconciliation.json)严格核唯一请求/原SHA/模型/usage/total/context seed/timing/预约cost hash/时间/终态op，用既有settleModelUsage补记录已知费用。现已settled，没有退款、模型重试或更改旧failed op/control/started effect；原unknown历史报告保留。原effect依旧started，不伪造有效结果。

## 第二轮真实音画结果

[记账修复后预览](new-theme-accounted-audio-preview-probe.json)：operation `5b25cce7-3723-4128-8fa8-b252053386e9`，revision `35f71e39-809d-479d-b23e-3aca60ab6e41`，同project `4a5c6131-3842-440c-a551-7d8fcf6e7c95`。复用原已完成Treatment及四原WAV；新Audio与四Visual实际请求各一次，全部HTTP200、原响应SHA归档、预算settled。五次用量input/output分别9063/6625、7342/8437、7330/9171、7327/9692、7319/9371，新增实际38381/43296。项目共11次调用均settled；不把预约量当实际消耗。

四镜头每个120帧，原严格确定性检查均通过，完整20秒音画/字幕文件已生成：SHA `7c381b9b2f75e9a05ccaa7e542686268df18a23c02fff7dd487cabcf00312ce3`，10492984字节。最终混音第二句“洒下”仍识别“撒下”；原混音校验阻断，operation已failed/composition，未执行Excerpt/Critic/发布。旧public mapper归为PROVIDER_UNAVAILABLE，不代表供应商失败；已修复后续分类，历史终态不重写。

[冷读取诊断](accounted-preview-postmix-probe.json)没有重生产/ASR：第1句pass，第2句ASR_MISMATCH，后两句原流程not_reached。试听副本是最终AAC实际提取的3.675秒原WAV，SHA `e7683805520462ea967123d8082cc306fb9b18cd8360aae9d920530526a42967`；不同于原TTS WAV，不用原确认豁免。

[独立全解码与剩余声音检查](existing-preview-film-remainder-probe.json)在新root复制逐字节相同影片，新owned journal下核真实20秒/480帧/1280×720/双声道AAC/全解码，响度−14.29LUFS、真峰值−4.05dBTP通过。仅提取/盲识别从未达到的第3、4句，两句pass；完整原plan SHA `24cb6d8168c3036809c4d8f97cafc46f6948562b3e05f568cad2348524adf74d`和原manifest SHA留证。此subset结果不能替代全片QA或第2句复核；deliveryEligible=false，sourceControl/budget/op不变，0新模型调用。两个诊断引用已加强为冻结voice-stage快照及完整ObjectRef/prefix/SHA/bytes校验；执行时实物与冻结引用均由独立复审核对一致，未重跑或覆盖历史报告。

## 负责人实际最终混音确认与下一步

负责人回答“读音正确，确认这句最终混音试听复核”。[原字面确认](new-theme-postmix-spoken-review-confirmation.json)绑定精确questionItemId、影片/WAV/完整plan/原transcript SHA、单句line_2及识别原文；formalProductionApproval和fullFilmListeningApproval均false。它目前是非授权的实际事实记录，尚未实现最终混音的owned运行时review capability，旧failed操作和ASR_MISMATCH仍原样保留。

下一步实现独立的最终混音可信复核能力，与原TTS proof隔离，绑定影片SHA/完整plan/提取窗口/WAV/完整transcript/词时间/owner/确切确认消息。然后通过新命令和新operation技术继续同一冻结revision/影片，保留原failed/started，不重新随机生成新影片而错误套用本次确认；所有已完成创作结果可验证复用，未知结果不可重跑。继续实际Excerpt/Critic及正式QA/公开入口，不把本次事实当正式批准。公共试听/受限重试、正式制作与修改/导出/清理、全部43风格86基线及T21仍待完成，C0/C1/C2未达到。无push/生产部署。

最终验证记录：105文件560测试通过；lint/build/构建后typecheck通过。之后两个诊断脚本完整引用修复另经typecheck及双轴复审clean；最终提交前重新lint/build/构建后types。
