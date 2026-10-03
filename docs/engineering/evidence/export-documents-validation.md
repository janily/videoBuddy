# T14 四种文字导出验证（2026-10-03）

本次沿用既有 POST exports / 持久导出 operation / Worker / SSE / 私有下载协议，增加 `srt`、`treatment`、`credits`、`quality`。每种格式按最终 result 和 format 独立预约、发布；旧 source_zip key 与记录兼容。poster 仍明确不可用，下载界面尚未接通，不能将此增量称为完整 T14。

所有入口先重新核对当前或上一份已发布结果、冻结包、实际 MP4 字节与原质量策略的全部强制项。文字生成前后再次读取基线，并在写入/发布前沿用 operation fence、owner、取消意图和结果指针检查。没有重新调用模型，不以文档生成取代视频 QA。取消、原命令身份、终态恢复、私有发布 CAS 与删除后访问拒绝沿用已有服务。

- SRT 从冻结全片 timeline 的 captions 生成，按起止帧排序、编号，开始毫秒向下取整、结束向上取整，UTF-8/CRLF。保留中文及单行换行，不把 ASR 期望文本或效果节选当成字幕。无字幕返回固定 `EXPORT_NOT_APPLICABLE` 终态，不发布零字节文件；非法区间、非整数帧、控制字符、空白分段或时间箭头文本拒绝。
- Treatment 是冻结 summary 与完整 script 的 UTF-8 TXT。
- CREDITS JSON 保存冻结音频与素材的来源 hash、经重新校验的原 rights 声明、style/runtime 版本。明确声明这些记录不授予素材、字体、模型或第三方软件的分发权；不复制素材字节或捏造许可证。
- quality JSON 保存原最终 result 的 MP4 hash/bytes、完整 qualityPolicy/checks、结果时间与修订版。没有把 not_checked 改写为 pass。

全部输出复用凭据检测，并限 2MiB；Python 不跟随目录 symlink、0600 文件、hash/bytes、不可变原子 link、fsync 和单链接校验保留。文字文件仅允许 `captions.srt`、`treatment.txt`、`credits.json`、`quality.json`，ZIP 仍为 source.zip / 150MiB。下载解析严格绑定 format 对应路径/MIME、逐 artifact 发布记录、control 可见性 hash 与原 result hash；文字无 play 权限。

## 实际运行与限制

SRT 编码新测试先因模块缺失退出1。四格式服务断言先全部以 CAPABILITY_UNAVAILABLE 失败；接通后通过。后续实际测试包括独立文字/ZIP 槽、移除队列后的冷恢复、只读重放单 SSE、实际文件字节/摘要、删除后的下载拒绝、无字幕不发布，以及 Treatment/quality 中虚构凭据阻断和 SSE 不泄露。

字幕测试实际调用 Python 写入 UTF-8 SRT，读回全字节、重算 SHA、核 0600/nlink=1，两次写入完全相同，不同字节替换被拒绝。例子从第3601到7199帧、60fps，得到 `00:01:00,016 --> 00:01:59,984`，证明没有压缩为效果片段时间。

正向服务测试使用明确的非视频 protocol fixture 和合成 QA，仅验证导出协议与实际文字文件；SRT 正向测试验证编码和写入，不代表真实含字幕影片的完整发布/HTTP下载链或最终媒体质量通过。原诊断影片仍缺合格正式发布，未改原控制态、未绕过历史预算、未新增模型调用。

最终命令与完整检查结果见任务账本。两轴独立审查无剩余实质发现。implemented/tested 为上述增量；deployed=false，未 push 或部署。正式 Worker/真实全片视听 QA/原子发布、poster、下载界面、修改/清理与43风格86基线和最终验收继续未完成，C0/C1/C2未达到。
