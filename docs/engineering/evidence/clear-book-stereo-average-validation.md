# T10/T11 新字体实片与立体声混音提取修正

2026-10-05。应用增量已实现并测试；未部署，未完成 Critic 或正式交付。

## 真实新片

通过独立 `--clear-book-caption-preview` 标志、独占新报告和固定 c91e4b 媒体镜像，创建新 operation `7abd57da-019e-4c7b-8a37-5921a6c3b3c5` / revision `4838f74b-4b34-4156-9511-0629ec18cb78`。原已核验四句旁白及 Treatment 按持久授权复用；实际重新生成 Audio 计划、配乐音效及四个 Visual 镜头并离线渲染，冻结 policy4/新清晰字体。首次 shell 没有导出 env，配置预检 Invalid URL，0模型/任务创建；正确导出后开始本次唯一新任务。

5 次真实 `gemini-3.8-flash` 请求均 HTTP200，全部原始响应存在、SHA核验、实际 usage 与5个新增 accounting 项一一匹配 settled：42238 input + 40568 output tokens。没有缺响应或未知新增账目。详见 [请求报告](new-theme-clear-book-caption-preview-probe.json) 与 [账本核对](clear-book-model-accounting-audit.json)。

实际 MP4 SHA `ceaa9448c41fd7dd54e3cea4686f716524d9285c9e5cc4212a199bb6c3c5b552`，5339754 bytes；20秒、480帧、1280×720、24fps、stereo AAC。独立容器完整解码/元数据/MP4 faststart/hash通过；最终响度−13.49LUFS、true peak−2.23dBTP通过。

## 故障与根因

任务在 composition 失败，公开安全错误为 PROVIDER_UNAVAILABLE，未进入 Critic/发布。不是一次预览或最终QA成功。

首次只读诊断额外传入 frozenFilm，但原 operation 不是 frozen continuation，正确被 FROZEN_PREVIEW_CHANGED 拒绝；该报告保留，它只说明诊断配置被拒，不能作为原故障根因。第二次诊断仅覆盖控制态以允许只读复查，所有store写入禁止，compose和postmix强制读取现有证据；实际 stack 定位 `probeVoiceWav` 的 VOICE_OUTPUT_INVALID。原control/journal未改。见 [首个诊断](clear-book-composition-diagnosis.json) 和 [实际故障诊断](clear-book-composition-diagnosis-v2.json)。

成片 stereo 峰值合格，但 FFmpeg 默认 stereo→mono 的求和在这里增加约3.01dB。实际首句 WAV 93600 samples、SHA `5234f3fd…`，峰值1.0252019167（+0.216dBFS），2个超1采样；严格解析器正确拒绝。没有降低音频安全阈值、把超范围音频算通过或修改原失败任务。

## 实现与实际验证

新 clear policy4 且实测 stereo 的 Preview/正式 Composition 使用显式 `pan=mono|c0=0.5*c0+0.5*c1`。提取key为独立 `postmix-v2-stereo-average`，默认旧参数和 postmix-v1 key逐字保留。新 downmix 身份进入单句 challenge/context/proof，并由同源旁白policy读取同版本实际混音WAV；跨版本复核拒绝。旧冻包、旧 WAV、成片字节和渲染producer未改。

RED：新算法参数测试先3pass/1fail（尚无filter）；实现后通过。追加旧key一致/新key隔离及可信复核绑定版本，相关2文件14项通过；最终117文件606项全部通过，50.61s。lint、Next16.3.8 build、构建后typecheck全部退出0。

命令 `npx tsx scripts/video/probe-clear-book-postmix.ts --verify-clear-book-stereo-average`，实际8个owned native completed（4提取+4ASR），四句为 pass/trusted_policy/pass/pass；原识别原文保留，第二句洒/撒沿用负责人同源授权，不再问试听。冷恢复全部一致、0新增native；0模型调用；原control/budget/failed op及原native journal均不变。新首句 WAV SHA `e68471ec…`，峰值−2.794dBFS、93600 samples。

[完整真实探针](clear-book-stereo-average-probe.json)、[逐采样比较](clear-book-downmix-comparison.json)：新旧同采样数，与旧值/√2最大误差1.8752e−7，新超1采样为0；旧非法WAV原SHA保存，证明是下混增益修正而非删字、剪短或放宽校验。

## 下一步与限制

新旧模型effects与失败operation保留，不重置未知调用。当前运行时冻结继续仅接单句 postmix_review，需接入已拥有者授权的同源旁白整组验证及精确 native journal 引用，再创建独立技术继续任务，复用同成片进行 Excerpt/Critic/发布。诊断的completed回执不能复制到原operation或冒充正式批准。

本次没有实际 Critic、新公开预览、新 source ZIP 或1080p正式全片QA。原旧字体 frame409事实失败记录仍保留；不宣称新的字形已通过 Critic。公共试听/重试/正式制作/修改/取消清理、素材分析、全部43风格86真实基线、22功能/92验收/16Agent行为与部署验收继续推进；C0/C1/C2尚未完成。无push/生产部署。
