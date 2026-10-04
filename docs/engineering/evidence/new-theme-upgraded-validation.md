# 升级语音的新主题实际制作尝试（2026-10-04）

实际执行 `npx tsx scripts/video/probe-new-theme.ts --new-theme --upgraded-speech`，使用用户指定真实GRSAI/gemini-3.8-flash，固定新voice `b145374…` / medium ASR `caa3fca…`。独立root `seed-oD7Sxk`，project `4a5c6131-3842-440c-a551-7d8fcf6e7c95`；不是旧unknown项目重试或重置，旧报告保留。[原始结果](new-theme-upgraded-probe.json)包含实际响应SHA、阶段和控制态。

真实Director流/消息归档/preparePreview队列/Worker/pipeline已运行，Director与Treatment两付费调用均settled，实际input/output为4993/2509、4346/3350。报告预算预约76858/13000不是实际总usage。Director原响应为SSE，response记录的JSON usage为空，实际SDK对账usage已持久化，不能据此声称原响应缺失或未结算。

四条真实TTS均已生成。第一句“把小种子轻轻放进泥土里。”盲medium识别/时间通过；第二句原文“洒下适量的水，润湿土壤。”识别成“撒下适量的水,润湿土壤。”，严格 `ASR_MISMATCH`，操作 `46cc7a4f-4d53-439f-b681-f818df76f7b9` failed，control attention、未发布预览/结果，后两句尚未ASR。

未改expected、字幕或失败状态。按 [AT-079](../../hand-off/videobuddy-v5.1/docs/07_ACCEPTANCE_AND_DEPLOYMENT.md:170)“重新发音/可信复核”，实际第二句WAV已复制为 [试听音频](new-theme-spoken-review.wav)，SHA `3c9f907ed0e6af737c4d2a21c709e1306c784f32759f1eeeb08a0c25a25a6c02`，324044bytes。询问负责人实际试听判断；截至本记录没有确认或豁免，“洒/撒”同音不自动通过。原有严格门槛继续有效，后续复核需绑定该音频/原文/识别与身份，不能声称字面ASR通过。

未进入此版timing/visual/audio/全片混音QA阶段，不是预览、正式制作、听验或43风格验收成功。C0/C1/C2未达到，不push/生产部署。等待试听期间继续可独立功能。
