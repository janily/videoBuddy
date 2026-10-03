# 封面导出验证（2026-10-03）

基点 `aff05e47b66f0c0f1d45d2e1d12fbfbd2ef05247`。T14 poster 接入已存在的持久导出协议；不替换影片、视觉设计、批准或质量政策。

封面取冻结整片首镜头中点，帧号来自 full timeline，保留真实输出宽高。先读已发布 current/previous result、冻结制作包与 mandatory quality checks，重新核验实际 MP4 哈希，再用该冻结 runtime digest 在禁网、只读、资源受限 Docker 中解码。明确 publishedArtifact 参数仅允许该 project/artifact 的 canonical 私有 `files/final.mp4`；原抽帧函数默认仍只读 composition 输入。抽帧结果与影片 SHA、尺寸、runtime、帧号、PNG SHA/长度绑定，可信提取回执和 PNG 缓存继续验证；保存不可变 poster provenance。

导出仍为 202 receipt→独立格式槽→Worker→私有 PNG→控制 CAS 开放下载→持久 outcome/SSE→200 短期访问。复用匿名鉴权、取消/发布竞争、旧命令重放和 current/previous 可见性。PNG 固定名 `VideoBuddy-poster.png`、MIME `image/png`，8MiB上限、0600/nlink1/no-follow 写入与拒覆盖；无 play 权限。结果界面的“更多”已启用“下载封面”，使用原按钮、原导出恢复交互，无额外生成/模型调用。

## 失败→通过

- 修改前 79 文件 / 373 项单元基线通过。
- posterFrame 模块缺失先失败，实现后 2 项通过；拒绝非法时钟/空或不连续镜头区间/覆盖不完整。
- poster operation 正向先 `CAPABILITY_UNAVAILABLE` 失败；接入后实际完整 PNG 协议文件/私有 access/冷重放/单终态/禁止播放/删除拒绝通过。错误影片抽帧证据在读图或发布前 `EXPORT_POSTER_INVALID` 拒绝；默认和错误 project/artifact 的新读取路径拒绝验证通过。
- Playwright 封面动作先因 disabled 失败，开放后通过；下载专项 9 项通过，含真实 Chromium download 事件与新鲜 PNG access（明确协议字节）。
- STANDARDS 独立发现冷扫描格式白名单遗漏 poster：结果槽已写、op尚未写时无法恢复。真实 FileStore ACK 丢失回归先 pending=[] 失败；扫描改用 DurableExportFormatSchema 后修复 operation、排队一次并保留原命令。独立复现 `operationRepaired=true,pending=1`，P2关闭。

## 真实媒体证据

执行 `npx tsx scripts/video/probe-poster.ts --poster`，退出0，报告 [poster-probe.json](poster-probe.json)。

从既有真实 20 秒 1080p 影片 `b1c9e6c6c3d78ef50e6544aa743c0df241eb55139fceee2b715ace79a01efde9` 复制到隔离私有 artifact 存储，抽取冻结首镜头中点第59帧。输出 [poster-real-frame.png](poster-real-frame.png)：1920×1080，2,235,204字节，SHA256 `52355eb7b3b249b205c1af72fff70042d212790b44122bcf71578927eb19ce7b`。独立 Python 全部分块 CRC、IDAT 解压与1080行长度检查通过，并实际查看画面。可信回执冷读一致、PNG实际私有写入600/nlink1、二次相同写入一致、不同字节拒覆盖。2.24MB超过原文字2MiB上限，实际验证PNG扩展8MiB分支。

源诊断项目没有已合格发布成片，prepareExportPoster 仍 RESULT_STALE；sourceControlUnchanged=true、0模型请求/0付费、没有 fake QA 或绕开发布。上述真实抽帧与存储探针不等于真实最终 QA/公开成片下载验收。

最终验证：3个目标文件共30项（完整套件包含），80文件/379单元测试、27浏览器测试、lint、build、构建后typecheck和diff-check均退出0。设计严格静态审核0finding；SPEC与STANDARDS独立复审均无残余实质问题。仅本地提交，implemented/tested，不是deployed或C2完成。

## 仍未证明

原 MODEL_ACCOUNTING_MIGRATION_REQUIRED 门闩、全片连续运动/听验/字体许可/正式旁白字幕/质量修复与最终用户闭环仍待解决；修改/恢复产品流程、清理、43风格86实测和最终验收未完成。真实竖屏封面仍需随竖屏影片基线实测。C0/C1/C2 未达到。未push/生产部署。
