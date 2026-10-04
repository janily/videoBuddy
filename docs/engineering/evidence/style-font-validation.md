# 手写字体资源验证 — 2026-10-04

代码固定差异：`b5987de…379c4a5`。本次完成字体资源锁、构建上下文准备和受限运行时实际查询，尚未完成绘本字幕或影片验收。

## 来源与构建

锁定官方 Google Fonts commit `406197b91ff39a93061c2c2eeaee67ddf2ae1f0d` 中的 Ma Shan Zheng 和 Patrick Hand；字体、OFL 和 METADATA 各自固定 SHA/bytes。来源锁见 [fonts.lock.json](../../../runtime/media/fonts.lock.json)，使用与许可保留见 [FONTS.md](../../../runtime/media/FONTS.md)。二进制留在忽略的私有缓存和镜像，未加入 Git 或源码 ZIP。

首次构建退出1：BuildKit 将 `FROM sha256:<id>` 解释为 docker.io/library/sha256，远端匿名令牌请求 EOF。原始上下文保留，未创建成功镜像记录。新的构建使用全基镜像 ID 命名的本地引用，构建前后均核 ID，`--network none --pull=false` 实际退出0，六文件 SHA 全部匹配；新镜像的层前缀和环境与原基镜像一致。

实际基镜像：`sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919`。

实际新镜像：`sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb`。

构建原始证据见 [style-font-build-probe.json](style-font-build-probe.json)。没有替换应用默认镜像。

## 实际运行时

`npx tsx scripts/video/probe-style-fonts.ts --verify-built-font-runtime` 退出0。在无网络、非root、只读根目录及受限资源容器中，两款字体分别生成 completed 原生回执，实际 font/OFL/METADATA SHA 与锁一致。Ma Shan Zheng 有7015 glyph，原四句中文缺失字符为0；Patrick Hand有513 glyph，英文样本缺失字符为0。回执、实际哈希、样本和字符覆盖见 [style-font-runtime-probe.json](style-font-runtime-probe.json)。本次新增模型调用为0。

## 验证与审查

新增两文件四测试记录模块缺失 RED 后 GREEN，覆盖固定资源身份、文件篡改、字体别名/charset、未固定镜像、未知字体、缺失及链接源拒绝。协议 mock 测试与真实 Docker 查询分别记录，没有把 mock 计为原生结果。

- `npm test`：110文件575测试，退出0，50.20秒。
- `npm run lint`、`npm run build`：退出0。
- 构建结束后 `npm run typecheck`：退出0。
- `git diff --check`：退出0。
- Spec 审查：clean；独立核六文件、两 completed 回执与 glyph 数。
- Standards 审查：clean；独立核固定来源、上下文限制、链接拒绝及精确回执参数/输出。

两个审查均针对固定差异 `b5987de…379c4a5`，只读核验，未新增 producer 或模型调用。

## 仍待完成

字体尚未接入 TimingDraft、CaptionPackage、实际绘本字幕合成或源码 ZIP 资源清单。需要版本化字体身份、纸底与安全区，并实际生成新的完整影片、核旁白及事实、执行完整 QA。既有 Noto 字幕、失败/unknown 操作、原影片哈希及用户单句试听确认保持原作用域；这些确认不自动授权新影片。43风格及项目其他验收范围仍待完成，C0/C1/C2未达到。本次未push或生产部署。
