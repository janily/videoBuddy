# 绘本字幕绘制器验证 — 2026-10-04

本增量实现实际绘制器，尚未接入冻结字幕包和生产合成。审查固定基线为 `68ab1ef`；最终审查候选为 commit-tree 快照 `6f8f7eca765d228891c55156d03512754b4e4ccd`，不移动 HEAD。实际代码提交 `4dba5ed` 与候选代码树相同。

## 实现

依据 [Crayon STYLE §4/5](../../../style-packs/crayon-book/STYLE.md)，受信任模块使用52px手写字体、棕色墨迹、浅色撕边纸底和固定纸纹；逐字从左至右约350ms显现，字形倾斜/偏移按12fps确定性变化。中文使用已固定 Ma Shan Zheng，英文使用 Patrick Hand。布局读取实际 Canvas 字体度量，接受明确预留 safeBox；超出两行或保留区域直接拒绝，不缩字或隐藏。返回 stableReadableStartMs，后续统一时间轴必须据此核完整可读停留时间。

这是透明字幕层，图片查看器中的黑色为透明区域显示背景，实际 alpha bounds 已检查。调用方仍须绑定安全区域与真实镜头主体，当前绘制器不会证明语义上无遮挡。

## 实际诊断与失败保留

- 首次 [probe](book-caption-runtime-probe.json)：缺 timeout 配置，执行前失败，无 native invocation。
- [v2](book-caption-runtime-probe-v2.json)：实际完成16PNG和正反序/12fps验证，但视觉检查发现纸纹 hash 相关性形成对角线；结果保留，未算风格通过。
- [v3](book-caption-runtime-probe-v3.json)：加入 hash avalanche 后重新实际绘制，中英文纸纹视觉检查通过；仍未包含之后的纸边余量修正。
- Spec 只读 Canvas 协议复现：120px高单行/192px高双行布局允许纸底占满区域，ragged边±2.5px越界。修复预留6px，紧边界回归4测试通过。
- [v4](book-caption-runtime-probe-v4.json)：新独立诊断 MEDIA_STOP_UNKNOWN，renderer invocation 保留 unknown。后续只读 Docker 列表未见此 invocation 容器；没有因此修改它的状态，也不推断其丢失的原始错误。
- [v5](book-caption-runtime-probe-v5.json)：新 runner 持久 failure.json 并返回已完成诊断回执，明确捕获 BOOK_CAPTION_OVERFLOW。实际字体 advance=52.00004577636719，诊断接受盒误用整数宽158；这是诊断输入过紧，不放宽生产布局规则。
- [v6](book-caption-runtime-probe-v6.json)：诊断接受盒改160×126，实际退出0，两字体加 renderer 三条 completed；16PNG SHA/bytes逐项核对，正反调用像素一致，2000/2040ms相同、2084ms变化，alpha bbox全部位于预留区域。120/192px拒绝、真实浮点字宽与160×126盒余量核验通过。

最新实际 renderer SHA：`74d0e41f99a34f7b2da803427d4ba0a5144237e5a96c798adb1cce377a0a167a`。

最新 runner SHA：`35034f2888b1cffa9783a33279702fa2416fa13c18a0e0cbabe79eb71ba41a02`。

镜像固定 `sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb`；无网络、非root、只读输入及资源约束。每次独立准入、私有根目录与持久 journal，原 report 不覆盖。全部诊断新增模型调用0，未改变应用默认镜像、旧影片或审批。

## 自动检查

模块缺失 RED 后新增测量排版/显现与确定性/非法文本和度量/纸边紧界及真实浮点回归，当前4测试通过。

完整 `npm test`：111文件579项，退出0，53.88秒。最终新增真实浮点断言后同文件4项再次通过。`npm run lint`、`npm run build`、构建后的 `npm run typecheck` 退出0，diff check退出0。build后续变更仅诊断脚本及回归断言，v6实际执行与typecheck均已验证。

独立 Spec 审查：clean，纸边界P2已修复；独立 Standards 审查：clean，真实浮点诊断盒问题已关闭。两轴均对最终固定候选，只读核两源码、16PNG和三completed回执，没有新增producer。

## 接下来

需要把该受信任绘制器接入新的 CaptionPackage/TimingDraft/policy/cache身份和生产字幕层合成，绑定实际字体与源码哈希、保留SRT/源码ZIP许可资源清单，并核350ms显现后的阅读时长。新镜头要显式预留区域，再做真实完整影片的旁白/事实/全画面QA。旧policy1/2和原失败/unknown不能自动迁移。本次不是正式生产批准、43风格验收或完整交付，C0/C1/C2未达到，未push/部署。
