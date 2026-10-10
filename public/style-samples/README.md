# 43 种同主题画风封面

所有封面都使用「一杯咖啡」和标题「给生活留一杯时间」。各画风的构图、线条、材质和配色根据仓库中的 `style-packs/{id}/STYLE.md` 编写为确定性的 SVG/HTML；不调用模型或付费服务，不在画面中放画风名称。

- `{id}.jpg`：640×360，progressive JPEG，每张不超过 60,000 字节。
- `src/{id}.html`：可复现源码；同一输入时间得到同一帧。统一取 1.5 秒处的画面。
- `manifest.json`：43 项完整清单，包括来源/规则/图片 SHA-256、字节数、配色、特征及局限。
- `review/contact-sheet.jpg`：全量缩略审查图；`review/representatives.jpg`：九种代表风格的原尺寸审查图。审查图不用于产品封面，不受单张封面 60KB 限制。

本次只交付 JPG。清单每项 `video` 都为 `null`；前端仅在该字段存在时才请求循环视频，避免不存在的 MP4 请求。`poster` 是相对于 `/style-samples/` 的文件名；`swatch` 顺序为背景、前景、强调色。

## 重新生成

需要项目锁定依赖、Node 22、FFmpeg/FFprobe 和本地 Chromium。`npm ci` 的 postinstall 会准备字体，也可显式运行 `npm run fonts:prepare`。在仓库根目录运行：

```sh
node --import tsx scripts/video/build-style-samples.ts
node --import tsx scripts/video/build-style-samples.ts --verify-only
```

可通过 `--chromium=/absolute/path`、`--fonts-dir=/absolute/path`、`--work-dir=/absolute/path` 和 `--output=/absolute/path` 指定环境。生成脚本通过现有 `createLocalRuntime` 渲染一帧本地片段（含运行时 AI 标识），解码后用 sharp 编码 progressive JPEG，默认质量 88、4:4:4；如超过字节预算，按 4 递减质量并严格验证。清单记录实际编码质量。四个并发任务受本地运行时池限制。

```sh
# 仅更新可复现源码，不启动浏览器
node --import tsx scripts/video/build-style-samples.ts --sources-only
# 开发检查一部分；写 manifest.partial.json，不覆盖完整清单
node --import tsx scripts/video/build-style-samples.ts --styles=ink-wash,blueprint,pixel-rpg --output=/tmp/style-subset
```

本次构建环境为 root 开发容器，Chromium 153.0.8010.0，显式传入 `--chromium=/tmp/chromium --unsafe-no-sandbox`。该开关在 production 环境被禁止；本次结果不能证明生产沙箱隔离。版本、运行时摘要及字体锁摘要见清单。位级复现需要相同依赖、字体、浏览器与 FFmpeg 环境。

## 验证与视觉审查

2026-10-10：43/43 封面通过 JPEG 格式、640×360 尺寸、progressive 标记、60,000 字节上限及确定性源码匹配检查；清单 SHA-256 与实际文件逐项核对。全部使用质量 88。另在独立空缓存目录重新渲染全部 43 种，比较源码与 JPG 哈希，以验证相同环境下的复现性。

人工查看了全量 contact sheet，并以原尺寸查看蜡笔绘本、纸灯、孔版印刷、数据可视化、像素 RPG、积木玩具、科幻卡通、阈限空间及玻璃产品等代表画面。检查关注标题可读性、主体完整性、画风差异和渲染缺陷；修正了纸灯标题对比、科幻卡通描边、阈限空间标题对比和积木落影位置。

这些封面是固定主题的代码样式研究，能展示选型差异，但不等于每个画风完整视频管线的认证。玻璃、积木、低多边形、微缩景深、HD-2D 和纸雕等采用 SVG 的材质/空间近似，未执行物理渲染；具体局限在各清单条目中标注。静态图不能验证时序、音效、长镜头或模型遵循风格规则的质量。后续产品视觉审查仍可迭代个别风格，不能把本次无模型样片宣称为付费模型真实出片效果。
