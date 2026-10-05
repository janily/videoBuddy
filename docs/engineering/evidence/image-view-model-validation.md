# T05 模型视图身份与只读恢复验证｜2026-10-05

范围：`85154ef…86102ce`。新增严格SourceImageProof及model-view原图/PNG绑定；Mastra适配器可发送实际方向校正后的PNG，同时保留原图assetId/sourceSha256/mime；只读恢复核真实原图、阶段副本、输出PNG以及同project/operation/job/镜像的completed native回执。

**默认ImageAnalysis stage/Worker尚未选择此视图。** 此处是接线前必要的协议和恢复模块，不代表完整T05、云图片语义/OCR或C0/C1/C2。生产stage仍保留上轮默认路径；下一步必须将视图proof冻结于模型effect之前、按实际PNG载荷预留预算，并让ready/Director冷读同一证明。旧completed/unknown不能换键重新发请求。

## 实际测试

- `image-view-proof.test.ts`：最初guard缺失RED→实现GREEN；严格绑定原图project/asset/SHA/bytes/MIME、producer/runtime/job/完整方向几何及对应journal身份。实际JPEG/PNG fixture来自上轮真实EXIF6 native探针，original37943bytes/SHA ef7bdf…、PNG35445bytes/SHA6ac249…、683×2048。
- `image-understanding.test.ts` loopback实际HTTP协议：真实PNG数据URI进入请求，不包含原始JPEG；原图JPEG身份保留，PNG SHA与oriented坐标证明进入context。调用前快照后修改viewBuffer不改变发送字节，篡改PNG在provider配置/请求前拒绝。**响应为本地测试提供方注入，不是云语义质量。**
- `image-view-recovery.test.ts`真实临时FileStore：无配置/0create/0producer的completed冷核通过；篡改原图在初版只核副本时实际RED（promise错误resolve），补重读上传原图后GREEN；输出篡改拒绝，journal unknown明确MEDIA_STOP_UNKNOWN且不写、不重试。
- 目标5文件12项通过；首次typecheck发现测试局部Record output类型，显式修正后types退出0。无`as never`或放松合同。
- 全套`npm test`141文件700项、75.99秒退出0；lint/build/构建后typecheck退出0。

## 原真实产物只读复核

`npx tsx scripts/video/probe-image-view-recovery.ts --verify-readonly-image-views`退出0，见[初次真实证据](image-view-recovery-probe.json)与[目录修正后证据](image-view-recovery-v2-probe.json)：直接读取source-image-v3的5份实际PNG/JPEG/WebP/EXIF/alpha源和视图、20条原native journal中的对应completed生产回执。全部视图实际SHA、bytes、尺寸/方向合同通过。无新native/container/fetch/cloud/model，没有原状态写入；原seed项目、旧Critic model unknown、旧direct native unknown和本次来源journal根下JSON快照全部不变。

本轮0新云模型调用，不退款/reset原unknown，不修改原正式批准/预览/影片/发布。formalProductionApproval=false、deliveryEligible=false、resultPublished=false。fixture是合成双色格式测试，不是真实用户图片，也不证明图内容正确；保留恶意OCR的不可信属性。

## 交付状态

implemented：以上合同/适配器/只读恢复模块。tested：本地HTTP请求和实际旧native产物冷核。deployed：否。固定初版bd9e1bc Standards clean、Spec发现父目录symlink P2；982ee1e真实filesystem RED→GREEN并补根/两级资产目录非链接检查。修正后86102ce两轴均clean。最终86102ce仅诊断报告v2路径以保留原记录。首次修正后全套并发构建：140文件/698项通过、既有voice-stage两项15秒超时（79.51s），日志保留；停止同期构建后原文件4项在同阈值21.86s通过，未放宽timeout或改测试实现；同代码完整单独重跑141文件700项全部通过，75.29秒；未改阈值。未push/部署，完整T05/全片QA/正式公共闭环/修改导出/43风格86基线及运维用户验收继续未完成。
