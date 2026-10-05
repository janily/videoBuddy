# T10/T11 清晰手写字体冻结接线

2026-10-05；代码已实现、测试通过；未部署。此增量接续真实透明字幕层，不是新的影片质量验收。

新 Timing 字体族 `Crayon Book Clear Handwriting` 严格绑定 Long Cang、Patrick Hand 两个固定资源及新 renderer `f05641cb89861f8a931025b09637470dfe569ce0bacd0e9c6a8f391ebbf87591`。新自动绘本 Timing 使用此族；350ms 显现和9帧保留阅读起点不变。已有 Timing 只读恢复继续保留原身份。

CaptionPackage4、policy `v5.1-package-4-clear-book-captions`、BookDescriptor2 对应；旧 package3/policy3/descriptor1 保留。字体回执使用独立 `clear-book-font` 槽，旧 `book-font` 槽不迁移。FilmPackage 冻结、Composite、预览 renderInputs、发布与 source ZIP 根据实际冻结版本选择字体及源码。ZIP 附合法获取清单和匹配 SHA 的 renderer，不分发字体二进制或模型权重。

## 失败到通过

- 新两项契约测试第一次均因未知 clear 字体被严格 schema 拒绝。首次测试初始化错用了接口 AtomicStore，修为 FileStore 后再次确认两项真实 schema RED；实现后通过。
- 第一次全回归117文件602测试：601通过、1失败；旧 voice-stage book case 仍期待 package3，实际新任务为 package4。更新此断言并补 clear family/policy3 降级拒绝，独立4项集成19.87s通过。
- 额外验证同 runtime 新旧 receipt 共存、历史 package3、错误 receipt 命名空间、混排字形实际字体选择；相关2文件6项通过。
- 最终 `npm test`：117文件603项全部通过，50.99s。
- `npm run lint`、`npm run build`、构建后 `npm run typecheck`：全部退出0。Next16.3.8实际构建所有页面与API。
- 固定代码差异 `57a407bbb817eb1369215746deccf47e14f4d5f9..7b1a13ff4d2969283200754532d7e8f43b1ceb44`：Spec、Standards独立审查clean，无实质P1/P2。

## 真实运行证据

命令：`npx tsx scripts/video/probe-clear-book-package.ts --verify-clear-book-package`，退出0。[原始报告](clear-book-package-probe.json)。

实际镜像 `sha256:c91e4b1e1fe665b5017da982aed5a0f7b45fa11e2416207caa09304135d92623`，运行根 `.video-local/clear-book-package/probe-boNJkX`；两个owned native字体读取均completed，实际SHA/字节/许可/metadata/charset核验。原真实四句Timing完整ObjectRef核验并派生独立诊断包；横1920×1080和竖1080×1920三profile均冻结同一逻辑样式。冷读字体回执与包一致，0新增native。原control/budget/failed operation不变；0模型调用。

另以当前代码实际调用 `loadVerifiedFilmPackage` 冷读原书稿冻结包：FilmSpec SHA `bab1a0327241438692b613a6d6412881022ebb2993f0d257824c513f487af0a0`、2626bytes，policy3/旧字体保持；实际完整引用、音轨、镜头来源和字体receipt校验通过，原control/budget/op不变，0native/0model。此检查没有重跑原失败操作或改写原Critic。

## 尚未证明

本探针只证明字体/字幕包冻结基础，并不把诊断Timing安装到原业务revision。新字体整片合成、真实Critic、源码ZIP实际新影片导出、1080p最终QA仍待执行。原frame409的事实质量阻断保留；未宣布预览/正式交付通过。后续须新operation/revision和已核验runtime生产，不篡改旧freeze/hash或复用未知effect。

公开复核/制作/修改/取消/导出清理、素材分析、全部43风格86真实基线、22功能/92验收/16Agent行为/5用户观察及部署验收仍按原范围推进，C0/C1/C2均未证明完成。无push或生产部署。
