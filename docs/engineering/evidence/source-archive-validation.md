# T14 冻结工程包验证（2026-10-03）

这是工程包生成器增量，不是 T14 或整项目完成声明。该次探针只生成私有 ZIP 字节，不创建最终视频、公开下载令牌、export operation 或发布控制指针。后续服务接入见 [导出任务验证](export-operation-validation.md)，不改变本探针的质量与发布边界。

## 实际执行

Node 22.23.1：`npx tsx scripts/video/probe-source-archive.ts --archive`。未载入模型密钥，fetch 全部拒绝，新增模型调用 0。使用已有批准诊断项目中真实冻结的 20 秒成片制作包；原制作记录、批准、控制状态及旧预算账本未修改。

ZIP 共 64 条目、27,307,795 字节，SHA-256 `6d72359566d6047f3685067bafd397196b1e4ff4e6313b119588339cf098aac1`。完整路径见 [source-archive-probe.json](source-archive-probe.json)。两次冷读取生成的 ZIP 字节完全一致。Python 标准库 zipfile 独立解压器验证所有条目 CRC、长度、SHA-256 与 manifest 一致；解压到全新存储目录后 `loadVerifiedFilmPackage` 通过，含原画面源码、实际 WAV 音轨及 sound/master 固定执行回执。字体获取清单指向 [Noto 官方下载入口](https://github.com/notofonts/noto-cjk) 与 [官方许可](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE)，保留冻结字幕字体 SHA；实际包无字幕，不能为浏览器回退字体编造冻结 digest。

内容只来自冻结引用闭包和显式 runtime 文件清单：film、timeline、Treatment、事实/Understanding、HTML、音频计划/执行/回执、实际 voice/music/foley/mix 音轨、CREDITS、依赖锁、许可说明、参考 runtime 源码及重建说明。不遍历或打包仓库、消息历史、cookie、环境文件、临时下载 URL、字体、模型权重、缓存。尚无素材分发许可契约，遇到引用用户素材时明确 `ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED`，不能把使用许可当作分发许可。

## 失败→通过与回归

新增 seam 测试先因缺失 source-zip/source-archive 模块退出 1；实现后 19 项通过，包括 Python 独立读取、重排输入确定性、Unicode 路径、越界/重复/跨平台碰撞/特殊设备文件名、密钥与编码 URL 拒绝、ZIP 总体上限、跨 owner、冻结对象篡改、控制态不变。独立审查发现字体清单缺失和 OAuth client_secret 漏检，两条断言先失败；修复后通过。完整冻结事实/脚本中的合成凭据拒绝导出，WAV 重命名文本和 WAV 元数据中的凭据也被拒绝。探针输出改为专属新目录、排他0600创建及file/目录fsync，避免覆盖已有哈希路径/跟随同名链接。

完整测试 74 文件 333 项通过；lint、生产 build、构建后 typecheck、diff-check 均退出 0。独立规格/工程规范审查结果记录于任务账本。

## 未完成与限制

公开 source_zip 的 202 operation/worker/SSE/幂等下载绑定尚未接入；MP4、poster、SRT 等完整导出流程也未全部完成。本包没有全片视觉/听验质量通过记录，不是最终合格交付。参考 runtime 源码没有历史镜像源代码一致性证明，重建原环境须取得锁定镜像。字体、TTS/ASR 模型按许可另行获取；不承诺一键离线重建。实际包没有引用用户素材，亦不证明含旁白/字幕素材包的完整重建。C0/C1/C2 仍未达到，43 风格 86 条横竖基线未完成。未 push 或部署。
