# 手写字形歧义定位与新字体资源（2026-10-05）

T10/T11：原 Critic 的 frame409 “料→科”阻断保留，不重写原结果或降低事实门禁。本轮首先实读固定 Ma Shan Zheng 字体，绘制 U+6599/U+79D1/U+7C73/U+79BE 在104/52/34.67px下的字形及两个完整句子。原“料”具有近似禾字旁的笔形，放大后仍有歧义；三个字号的料/科 alpha mask IoU 分别约0.613/0.678/0.684，字节不同，未伪称 cmap 相同或错码。[原实际对照图](book-glyph-original.png)、[三 completed 诊断回执](book-glyph-ambiguity-probe-v1.json)。这属于字体字形证据，不能推断全字体存在错字。

候选 Long Cang 取自相同 Google Fonts 固定 commit406197b91ff39a93061c2c2eeaee67ddf2ae1f0d；[官方元数据](https://raw.githubusercontent.com/google/fonts/406197b91ff39a93061c2c2eeaee67ddf2ae1f0d/ofl/longcang/METADATA.pb)将其列为 HANDWRITING、OFL、Hans。实际 font/OFL/METADATA 三文件分别SHA e5bf2c3…/603546b…/c7d6c01…，5162508/4390/601 bytes，完整[来源锁定证据](clear-handwriting-font-acquisition.json)与catalog一致。不是系统字体回退或临时 CDN。

在原受限镜像中挂载已校验候选做独立诊断，fc-query 核 family 与原四句全部字符；FontFace真实加载后绘制。明确标记 captionFamilyOverrideForDiagnosticOnly，此候选句子不是生产片段。料/科在三个字号IoU约0.373/0.408/0.433；直接查看 [候选对照图](book-glyph-clear-candidate.png)，米字旁和禾字旁更易区分。[候选诊断](book-glyph-ambiguity-probe-v2.json)三个 completed；像素差异只是支持性证据，不等于 OCR/事实或全片审美通过。

catalog 新增独立 longcang ID，旧 mashanzheng/patrickhand 三资源的每项 SHA/bytes均保留，原 book renderer、policy3、已冻结制作包与默认runtime未改。新字体完整引用核验测试先实测 STYLE_FONT_UNSUPPORTED 失败，再正例通过；旧字体冒充、font/OFL/metadata任一替换均拒绝，两个文件5项相关测试通过。

新的受信任 build context 从三个锁定资源缓存构造，不用远端镜像tag替代本地base。实际 docker build --network=none 的9项hash检查通过，新 image sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623；基础镜像层前缀、实际base/tag身份、font-lock和base标签核验一致。实际三个字体完成回执、7015/513/7015 glyph，原四句及对应英文样本 missing=[]。见[新镜像实际运行报告](clear-handwriting-font-runtime-probe.json)。本轮累计9个 owned native completed，0模型请求；未修改原业务任务或影片。

116文件599测试50.26秒、lint/build/构建后typecheck退出0。固定4dfb1ed…fd13ca2 Spec与Standards双轴clean，未发现剩余实质P1/P2。下一步建立保留旧policy3的独立新字幕版本，接线字体/Timing/冻结包/工程来源清单，复用原画面与已确认同源音轨重新合成并执行真实Critic；未发布、未正式批准，C0/C1/C2未达，无push或部署。
