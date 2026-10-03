# 新主题中文预览真实验证（2026-10-04）

这是独立的“种子发芽”验收场景，不是对历史未知全片调用的重试。使用用户指定 GRSAI / gemini-3.8-flash 与持久 unlimited_validation 授权，未改动原项目的预算、control 或 unknown 门闩。真实结果见 [new-theme-probe.json](new-theme-probe.json)。

实际命令：`node --env-file=.env.grsai.local --import tsx scripts/video/probe-new-theme.ts --new-theme`。凭据文件保持忽略，命令/日志/报告没有打印密钥。脚本本次退出1，阶段 voice、错误 ASR_MISMATCH，预览未发布，正式制作未批准。

真实 Director 原生 stream 将场景转换成 Understanding，原输入消息先归档；随后走生产 preparePreview 的幂等 intent、持久队列和真实预览 Worker/pipeline，没有用协议假影片返回成功。真实 Treatment 产生四镜头20秒脚本。两次提供方响应文件 SHA 均已重新读取核对；SSE 原响应 actual usage 4992/1893、Treatment actual usage 4290/4737（input/output）与两条 settled 账目一致。预算总计保留76656/13000预约，不冒充实际消费；没有超预约、未知用量或自动重试。

四条实际中文 TTS WAV 已生成。第一条“把种子轻轻埋进泥土。”独立 ASR 识别一致（仅繁简差异），第二条冻结台词“适量浇水，润湿大地。”被识别为“适量浇水、润湿大的。”；检查失败后 Worker 保存 failed/ASR_MISMATCH，无 currentPreview/currentResult。后两条尚未完成 ASR 验证，不能据存在 WAV 算通过。

进一步只读定位当前固定语音镜像的实际 JS 音素化输出，见 [voice-phoneme-diagnosis.json](voice-phoneme-diagnosis.json)。`@uzen/kokoro-js@1.2.4` 将“大地/土地”的地转成 `ㄉㄜ5`（轻声de），应为 `ㄉㄧ4`（dì）；“慢慢地走”中的 `ㄉㄜ5` 则符合助词读音。安装代码包含对多字词末尾“地”的无条件 de5 覆盖及粒子归并规则。该镜像实际输出确认了可修复的前端错误，而不是把原台词改成识别结果。此定位没有合成新声音、运行ASR或调用模型，不能据此宣布发音修复通过。

本次类型检查首轮因 env 对象推导丢 index signature 退出2，显式 Environment 类型后 typecheck/lint/build/构建后typecheck/diffcheck退出0。此前生产代码完整533单元通过；本次只新增独立诊断脚本和证据，没有 UI/生产功能改动，不重复计旧检查为新影片验收。两个独立只读审查轴核对响应SHA/实际账目/失败来源后 clean。

下一步：针对名词与助词写实际 phonemizer 的失败测试，修复并固定新的语音镜像摘要，保持这四句原始台词，实际重新生成/独立 ASR 验证，再推进完整预览/全片视听QA。原青禾/清和发音和可读性、旧全片unknown、43风格86基线和最终用户验收仍未解决。

未 push、未生产部署，C0/C1/C2 未达到。
