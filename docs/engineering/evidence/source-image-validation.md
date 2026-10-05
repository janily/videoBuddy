# T05 图片独立解码与缩图基础验证｜2026-10-05

范围：`4acf8b7…ebeae78`。本增量完成独立可信静态图片生产器、严格输入/回执合同、自托管 owned Docker 执行器和工程包脚本包含。**尚未接默认 ImageUnderstanding/Worker 的模型输入；完整T05、语义/OCR质量、C0/C1/C2和项目交付未完成。** 本轮0新增模型调用，未push或部署。

实现：原PNG/JPEG/WebP实际私有字节绑定asset/project、SHA和bytes；20MiB、30MP、元数据尺寸、codec/MIME、动画拒绝；独立Chromium只解码真实原图、不执行用户场景，读取EXIF方向后完整画幅缩至最长边2048，不裁剪/放大。原图仍保留供画面复用，PNG模型视图有独立SHA/bytes/实际尺寸/oriented坐标、producer SHA、固定镜像与job SHA证明。固定镜像安装源码先核验，网络关闭、只读原图、容器限制与撤销fence；所有native调用持久owned journal，unknown不重试。冷读取核原图/输出实际字节；跨项目journal拒绝。工程ZIP包含`prepare-image.mjs`，不包含模型权重或字体。

## 失败到通过

最初两文件因模块缺失而导入失败，实现后通过。补充30MP反例：4000×10000、正确2048×819视图在过宽初版被错误接受，实际RED失败；生产器及回执guard改为30,000,000后GREEN。最终纯合同/准入2文件4项通过。

首轮真实探针 [source-image-probe.json](source-image-probe.json) 保留failed：四格式实际解码/色彩/EXIF/冷核均通过，但损坏24字节PNG以`IMAGE_PIXEL_LIMIT`失败，与诊断预期不一致。真实journal为正常exit0且status=fail，**图片未被接受，也无unknown**；未重写首轮状态。生产器将缺失/零尺寸分类为`IMAGE_DECODE_FAILED`，正尺寸超过30MP才`IMAGE_PIXEL_LIMIT`。

修正后 [v2记录](source-image-v2-probe.json) 四格式、损坏和40MP头部拒绝通过。追加 [v3记录](source-image-v3-probe.json) 含实际透明PNG：5种用例全部通过，RGBA像素半透明红`[255,0,0,128]`、不透明绿`[0,255,0,255]`。该合成双色图仅证明格式运输/解码/方向/透明度/缩放，不证明真实用户图片语义或整片质量。

## 实际媒体与恢复

固定本地镜像 `sha256:648079ca4f9e34970773e11940a5bb4eb29b565ef0dfcfd94533872bd65a06d7`；可信解码源码 SHA `b6994af129c8a7751bcae64c4fe07e759641f72e5d6c48a2f830aa44fd741211`，6427 bytes。构建基于已固定旧镜像、`--network none --pull=false`，无下载/新模型请求；旧生成配置及冻结影片镜像不改。

3000×1000 PNG/JPEG/WebP产物2048×683；EXIF orientation=6 JPEG产物683×2048；两区域实际ffmpeg像素验证色彩/方向。每用例重放回执SHA相同且journal键无新增；篡改原图/视图分别阻断`RUNTIME_ASSET_CHANGED`/`SOURCE_IMAGE_CHANGED`，无新生产。损坏图`IMAGE_DECODE_FAILED`、40MP图`IMAGE_PIXEL_LIMIT`，均normal-exit失败回执、不留可接受view。

[v1/v2 native审计](source-image-native-audit.json)、[v3 native审计](source-image-v3-native-audit.json)：每个精确`vb-media-<invocation>`对应completed journal，Docker精确name查询全部absent，v3共20项；无stop/rm/force或未知态reset。所有探针反复快照核对原seed项目、旧Critic model unknown及旧direct native unknown根下JSON不变。原全片SHA/预览/控制态/预算/批准保持，formalProductionApproval=false、deliveryEligible=false、resultPublished=false。

## 工程验证

- `npx vitest run tests/video/source-image.test.ts tests/video/source-image-executor.test.ts`：2文件4项通过。
- `npm test`：139文件696项，70.85秒，退出0（生产代码1ab030e）。最终ebeae78仅增加已实际执行通过的透明度诊断，生产代码相同。
- `npm run lint`、`npm run build`、构建后`npm run typecheck`：退出0；透明度诊断追加后lint/types亦退出0。
- `npx tsx scripts/video/probe-source-image.ts --verify-source-images`：v1 failed分类不符（保留），v2四格式passed，v3五格式passed。
- 两轴审查固定4acf8b7…1ab030e均clean；最终4acf8b7…ebeae78两轴追加复核均clean。审查仅基础模块，不代表全规格达成。

implemented：上述基础与导出脚本包含；tested：真实私有上传+独立native解码/缩放、RGBA方向、冷重放/篡改/限额与单测/构建；deployed：否。

下一步：把视图及原图归属证明接入默认模型图片输入，模型effect/归档必须绑定实际view SHA、尺寸/方向和原图SHA，旧completed/unknown不得换key重调用；随后在既有预算门禁允许且unknown精确对账后验证真实云图片语义/OCR。其他独立来源分析、全片QA/正式批准/修改导出公共闭环、43风格86基线、恢复运维/用户验收仍待完成。
