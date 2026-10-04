# Medium 生产调用路径验证（2026-10-04）

实际命令 `npx tsx scripts/video/probe-asr-medium-runtime.ts --medium-runtime` 配置固定镜像 `sha256:caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4`，退出0：四句冻结中文、中文日期和英文日期六条原WAV全部通过原文比较及正长度/不重叠词时间检查。六份持久回执completed，逐条使用 `mustExist` + 冷FileStore重读，结果相同，0network，原项目control/预算不变。见 [完整原始结果](asr-medium-runtime-probe.json)。

代码现在支持显式 `VIDEO_ASR_MODEL=Systran/faster-whisper-medium`，生产默认仍small。返回实际模型必须匹配配置；模型名和固定镜像digest共同进入缓存key，small历史key不变；旁白归档/voice-stage保留实际模型身份。medium限制6GiB/4CPU/int8/300秒，沿原owned journal执行，未知回执不能重试。预期台词和词时间检查未放宽。

四项新TypeScript测试实际RED（配置/缓存/错误模型/归档）后GREEN，另voice-stage medium实际RED后GREEN。四文件18项目标测试、完整102文件541项、lint/build/构建后types通过；Python身份测试缺函数报2errors，实现后2项通过。两轴独立审查clean。

首次镜像 `a31c834…` 的权重root所有0600，独立受限用户读取检查确认不可读。首producer回执unknown，仍保留且不重复，见 [权限失败证据](asr-medium-runtime-permission-failure.json)。修正文件0444时目录不能遍历，非root构建测试实际失败；加目录0555后固定镜像构建成功，非root无网依赖import/读取检查通过，实际 `pip check` 退出0。只调整公开模型文件的镜像权限，不调整私密材料权限。

原small失败及完整上下文“芽”零时长的medium失败均保留。这次通过的是六句原始WAV的生产ASR调用与冷读，不是完整AAC/postmix、听验、正式预览发布或43风格QA。新主题升级验证使用独立root与 `new-theme-upgraded-probe.json`，不会覆盖旧项目或证据；实际在新第二句洒/撒字符差异处失败，未发布预览。C0/C1/C2仍未达到。
