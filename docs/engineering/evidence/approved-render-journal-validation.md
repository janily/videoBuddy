# 正式渲染持久执行记录增量（2026-10-04）

本次只完成 T13/T14 中正式画面拼接、合成与成片语音复核的 Docker journal 接线，以及画面停止未知状态的错误传播。正式制作批准、完整视听 QA、发布和项目交付没有因此通过。

`composeApprovedFilm` 为当前真实项目/operation 绑定同一个 FileStore journal，传入合成与 postmix；`renderApprovedPictures` 将相同项目/operation 上下文传入画面拼接。postmix 的音频提取及独立 ASR 继续传递此 journal。省略 journal 的历史技术调用保持原接口。

原先画面执行失败后吞掉 `cancel` 错误，直接返回原始超时/状态错误；现在停止抛错或仍为 cancelling 时返回 `MEDIA_STOP_UNKNOWN`，保留 cause。只有确实返回 cancelled 时才返回原始执行错误。没有增加自动重试、公共 unknown 清除或批准权限。

Spec 审查发现缓存可能绕过 started/unknown：五条生产者缓存路径现重建相同 args hash 并核持久回执；仅 completed 可复用，stopped 拒绝，异常/损坏为未知。仅 StoreMissing 允许采用本操作尚无记录的历史产物，仍保留独立文件/QA/不可变来源检查；不写伪完成记录、不清公共 unknown。ASR 缓存还必须逐字等于 completed.output。

## 失败与通过

- timeout/inspect 两项停止失败测试：原实现返回 STAGE_UNKNOWN/MEDIA_STATUS_UNKNOWN，新增期望 MEDIA_STOP_UNKNOWN 后实际失败；修复后通过。
- cancelling 用例：原实现返回原始状态错误，实际失败；修复后通过。
- 拼接/合成/postmix 上下文用例：缺少 journal 时实际失败 MEDIA_JOURNAL_CONTEXT_MISSING；接线后通过。实际 cancelProduction 撤销后阻止 postmix 和阶段写入。
- 目标两文件 11 项通过；缓存 helper 4 项先因模块缺失实际失败后通过，真实 FileStore ASR 缓存 5 项验证 started/unknown/stopped 和合法但不同的 transcript 均拒绝、历史及完成相同文本可重读。相关4文件35项通过。
- 最终完整 `npm test`：102 文件 533 项，55.32 秒，退出0（此前524项亦通过）。
- `npm run lint`、`npm run typecheck`、`npm run build`、构建后 `npm run typecheck` 与 `git diff --check`：退出0。

测试协议端口明确模拟生产者/QA；只验证真实 FileStore、授权边界和参数传播，不能充作执行了影片 QA。

## 真实媒体

`npx tsx scripts/video/probe-render-journal.ts --render-journal` 初次和修复缓存后均退出0，最终记录见 [render-journal-probe.json](render-journal-probe.json)。初次目录 `.video-local/render-journal-r4J8ME` 有40次检查；最终独立 `.video-local/render-journal-MsJuMV` 复制已归档真实 1080p 镜头和 stereo 音乐/拟音轨，实际运行拼接与带 producer receipt 的合成。两个 journal 均 completed，43 次来源控制态检查，0 network/provider；新建 FileStore、mustExist 重读实际输出和回执保持相同。

成片20秒、1920×1080、24fps、480帧、AAC stereo，完整解码通过；SHA `b1c9e6c6c3d78ef50e6544aa743c0df241eb55139fceee2b715ace79a01efde9` 与原技术成片相同，响度 −14.08 LUFS、真峰值 −1.5 dBTP。原归档音乐轨 SHA 和项目 control 未变；原未知模型调用与失败的可读性检查保持原记录。

这次实际探针无旁白，不证明真实 postmix ASR journal 执行、运行中取消、全链冷清理、听感、许可或风格验收。镜头 detached executor 本身的启动/未知恢复、TTS/解码 QA/视觉抽帧等资源尚未全部纳入持久 journal；不能将本增量当作全资源覆盖。

未 push、未部署；C0/C1/C2 与43风格86基线继续未完成。
