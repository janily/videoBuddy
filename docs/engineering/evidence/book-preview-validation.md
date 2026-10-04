# 新绘本真实预览与用户声音偏好（2026-10-04）

T10/T11 真实新预览已使用固定字体镜像与 policy3 / CaptionPackage3，重新生成四段画面、原创配乐与音效，保留原核验旁白。首独立任务的 Audio 响应 HTTP200、9758/8576 tokens 已结算，Schema通过但音效引用未声明 source，严格拒绝；[离线重放分析](book-preview-audio-failure-analysis.json)保存实际原因，没有改响应或重启历史 effect。修正声音模型的逐字符 ID 自检要求；三个声音编排错误现在持久保留到 SSE 和冷 ProjectView，附安全可读文案，不泄漏路径。三个分类测试先失败后通过。

第二独立任务五次实际 HTTP200（42250 input / 43383 output tokens）全部结算，生成20秒480帧1280×720双声道影片 SHA c84f066a5a875650c2fa0a2e75215688de512779c88d3f49abb8988563dc0cf7，13,047,106bytes。全解码、faststart、−13.86 LUFS/−1.65 dBTP通过；mustExist冷合成严格绑定原 completed 回执，10→10，无新producer。参见 [真实预览报告](new-theme-book-caption-preview-v2-probe.json)及[冷合成/混音报告](book-preview-postmix-probe.json)。

实际最终 AAC 第2句仍识别“撒下…”；负责人原话“读音正确，音频这快就全部通过，不需要每一个影片都来验证”已完整保存，未改成固定短语。新的 server owner action 绑定精确 challenge SHA / 单句最终混音 scope / decision，普通聊天 strict schema 和 Agent 输出不能附加该权限；冷 proof 仍核 owner、消息、固定槽及原 WAV/转录/计划。旧固定短语路径保留，实际自由文本及错 challenge、普通聊天拒绝测试已先失败后通过。见[实际回复及长期偏好](new-theme-book-postmix-spoken-review-confirmation.json)。

继续自动核第3/4句新增四个 native completed（10→14）；第3句通过，第4句识别“观察成长 内心照料”，保留 POSTMIX_ASR_MISMATCH。第2句 owned 可信复核已完成，第4句未伪造 pass，任务/预算未改、预览未发布。负责人要求不再逐片问试听；已记录同源旁白复用授权，**standing runtime policy 尚待实现**，后续应自动核来源/字节/时序并记录真实 ASR 与授权豁免，不再索要逐片确认。见 [后续只读对账](book-preview-followup-audit.json)，原失败报告独立保留。

独立 owned 帧提取通过，实际第51、405帧纸底和主体没有重叠；第405帧根系可见。这只是两帧观察，不算连续运动/全镜头可读性或全片质量通过。[抽帧报告](book-preview-frame-probe.json)保留真实 SHA/native 回执；PNG 位于私有 book-preview-review-frames 目录。

完整114文件595测试（49.15秒）、lint、build及构建后typecheck退出0；固定最终 17d06b0…e907abb 的 Spec 审查 clean；Standards 首审指出诊断裸引用与授权写入顺序两个 P2，均以真实负例修复，最终 Standards clean；两轴未发现剩余实质 P1/P2。实际私有复制输入保持 verified key、破坏 SHA/bytes，完整 recorder 退出1 NARRATION_REF_CHANGED；reviewWritten=false、源状态和native journal不变，见 [拒绝证据](book-preview-reference-rejection.json)。未push/部署，C0/C1/C2未达到。下一步实现用户授权的同源声音自动复核、同冻结影片技术继续及真实 Critic/发布，再推进公共复核入口、正式制作/修改和全部43风格86条真实基线与92项验收。

授权顺序负例：同项目另一真实影片的 challenge 必须在首次 intent/message 写入前核验完整 context。新的只读 assertPostMixReviewChallenge 绑定项目/revision及全部音频上下文，正确与错误绑定单测通过；完整 recorder 的私有复制输入实际退出1 POSTMIX_REVIEW_CHANGED，零 review 写入，原状态/预算/native journal/确认目录保持一致。见 [实际拒绝报告](book-preview-challenge-rejection.json)。私有 speechReviewAction 从公开 ProjectView 和 messages GET 投影剔除，保留内部存档查证；实际泄露测试 RED→GREEN。最终审查快照 e907abb663ae93cd341980d9b7dac30e975c40f0。
