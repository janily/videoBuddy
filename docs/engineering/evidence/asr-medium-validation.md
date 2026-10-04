# 固定 medium 识别诊断（2026-10-04）

`npx tsx scripts/video/probe-asr-medium.ts --asr-medium` 实际退出1：原第三句 SHA `fc0ffd60…` 识别“種子醒來了 探出綠芽”，文本/正长度词时间通过；完整20秒原轨 SHA `0b212379…` 全文正确，但“芽”14840–14840ms，严格拒绝 `ASR_TIMINGS_UNAVAILABLE`。没有合成新音频或更改预期。

模型为 [Systran/faster-whisper-medium](https://huggingface.co/Systran/faster-whisper-medium)，固定 revision `08e178d48790749d25932bbc082711ddcfdfbc4f`，四文件逐一SHA验证；1,527,906,378字节权重 SHA `9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae`。使用原固定引擎镜像、独立冻结诊断脚本、只读挂载、无网络、CPU int8/4核/6GiB；输入只有语言和原WAV，没有 expected 或 initial_prompt。

最初下载在1,360,907,045字节提前结束，校验失败。官方HTTP206且 Content-Range 精确匹配剩余范围后补齐，完整文件哈希通过；永久fetcher随后实际校验四缓存文件退出0。保留失败manifest与范围记录于 [下载证据](asr-medium-download-validation.json)。审查发现固定临时路径链接覆盖风险，已改为独占随机临时文件/fsync/原子replace，并拒绝最终文件与manifest链接；隔离symlink/hardlink实测目标未改。

两项实际容器回执都completed，stdout与识别报告一致；源control/预算不变，0模型/API网络调用。实际报告见 [原始结果](asr-medium-probe.json)。Python语法、lint/build/构建后types实际退出0；此增量不修改生产识别器。原small识别失败记录保留，其他四句/英文日期未以medium核验，未完成AAC/postmix/听验/整片QA或43风格验证，C0/C1/C2均未达到。
