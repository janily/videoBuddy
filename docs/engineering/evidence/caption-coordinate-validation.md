# T10/T11 字幕逻辑坐标修正（2026-10-04）

已把字幕单位修正接入冻结 FilmSpec 包、预演合成和正式合成。新影片使用明确的逻辑画布；已有影片按原冻结规则验证。本增量只完成坐标/缩放，crayon-book 手写字体、轮廓色、纸底与安全区仍须实现和验收，不能把尺寸修正当作风格 QA 通过。C0/C1/C2未达到。

## 实现

- 新包 policy 为 `v5.1-package-2-caption-coordinates`，CaptionPackage schemaVersion=2；横版逻辑画布1920×1080，竖版1080×1920。各 profile 共同使用68字号、72底边距、3描边的逻辑单位，full/preview/probe分别按原画面 profile 等比显示，不改变断行和布局规则。该通用字体样式仍为 Noto Sans CJK SC 白字黑边，不宣称符合蜡笔绘本风格。
- `CaptionStyle` 的成对 PlayResX/PlayResY 进入已存在的 style hash，合成器实际 force_style 设置明确画布。缺半个尺寸、奇数或越界尺寸拒绝；新/旧样式生成不同 composition key，旧最终影片不覆盖。
- 完整 FilmPackage verifier 根据冻结 policy 推导严格 schema/profiles/font/逻辑画布；跨policy/schema错配拒绝。新包只写新规则，已有 `v5.1-package-1` 包冷读使用旧 schema1 及原 profile 值，不把旧影片重新解释为修正版。
- `prepareFilmPackageStage` 从既有不可变 FilmSpec 读取原policy，然后重算整个旧graph并比较实际 refs；新revision采用policy2。`prepareCompositeStage` 先mustExist验证完整 FilmPackage，再按它的输出/policy选择样式；缓存仍走 actual QA/postmix/frozenFilm/fence。正式 `composeApprovedFilm` 已从同一 frozen CaptionPackage 读取 full profile，无另写字幕规则。

实现本地 commit：`4c64c78`；固定 base `e920a33` / head `4c64c78` 两轴复审均clean。Spec独立核同completed stdout与七PNG SHA/字节数；Standards首模块导入、来源/缓存身份及冷恢复只读核验通过，无provider/nativeproducer/状态修改。保护原Git/origin/design，未push/生产部署。

## RED→GREEN与工程检查

新增横/竖/legacy三个测试实际全部RED：原 full/preview样式不同、缺明确画布、新旧composition key相同。实现后3项GREEN，既有composition3项回归通过。

接线期间 voice-stage trusted=true 实际分别在 FilmPackage 和 Composite 报 CAPTION_LAYOUT_REQUIRED；补逻辑输出与冻结policy后三参数small/medium/trusted全部GREEN。完整schema2包、跨schema/policy拒绝、schema1完整graph冷验及existingstage按原ref不变的用例通过。这些存储/合成PCM/mock测试不代表真实影片风格验收。

`npm test`：108文件571项，退出0，53.35秒。`npm run lint`、`npm run typecheck`、`npm run build`、构建后types与`git diff --check`通过。原冻结实片包实际冷加载仍为policy1，完整源音频/视觉/素材graph通过，只读取已存在的真实字节；未复活原 failed preview 或触发新创作。

## 原生尺寸验证与失败保留

固定实际媒体镜像 `sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919`，无网、只读根、非root、2cpu/1GiB，输入原SRT和原picture sequence均只读。真实生成横竖各full/preview/probe六张单位诊断PNG，并将修正版字幕烧在原picture sequence的frame51单帧上；没有生成新全片/AAC或调用模型。

首轮 `--diagnostic-only` 返回退出1/INVALID_KEY，最终报告未完成；journal为unknown、仅两个PNG可见，不能据此推断原生终态或补成completed。初始报告及原unknown保存到 [失败审计](caption-coordinate-original-failure.json)，原journal不重置、不重跑。实际查同invocation无匹配容器，但此观察不提升unknown为通过。

修订诊断采用深色字形/描边阈值（首轮为近白字形阈值），独立新producer/private journal/input args identity。`--diagnostic-v2` 实际生成全部七张PNG，唯一原生回执completed；宿主汇总因listKeys的depth10超过允许8再次退出1/INVALID_KEY。此前pending报告不覆盖，不能用宿主失败冒充原生失败，也不能再执行同producer。

修正查询为实际journal直属depth1后，`--recover-completed-v2` 退出0：重新计算全部原生arguments hash，严格读同 completed receipt 的固定stdout，验证六case/style/filter/PNG SHA和坐标；0新producer、0model。已有public PNG核同hash，缺失才由同已核字节复制；非重渲染。完整原project control/budget及两个旧failed operation前后hash、原SRT/picture SHA均不变。见 [只读恢复报告](caption-coordinate-runtime-recovery.json)；原两份pending报告保留。

| 横竖/profile | 输出尺寸 | 深色字形及描边包围盒 |
|---|---|---|
| 横/full | 1920×1080 | (677,952)–(1214,1001) |
| 横/preview | 1280×720 | (451,634)–(810,668) |
| 横/probe | 320×180 | (113,158)–(203,167) |
| 竖/full | 1080×1920 | (257,1792)–(794,1841) |
| 竖/preview | 720×1280 | (171,1194)–(530,1228) |
| 竖/probe | 180×320 | (43,298)–(133,307) |

六种尺寸按同逻辑画布归一后的包围盒误差≤3像素，没有尺寸引起的重排。坐标诊断背景为纸色测试底，不算真实竖版内容布局或43风格基线。

实际原画面单帧 [修正版尺寸](caption-coordinate-actual-picture-caption.png) 已目视查看，字幕明显缩小并靠下。该帧仍为白字黑边且未做手写/纸底，不能将其说成蜡笔风格通过；frame405根系、安全区/动态遮挡、全部字幕与关键事实还要另验。原完整AAC影片及其单句确认仍绑定原film SHA，不继承到新全片。

## 后续范围

完成 crayon-book 及各StylePack的真实字体/许可/字形、字幕样式和安全区；冻结新的完整revision/影片并重新验证AAC/最终混音/Excerpt/Critic及事实。不能移除 `$schema` 或反复重跑原Critic来绕过真实质量问题。公共review/retry/完整正式制作UI、43风格86基线、92验收、16行为、用户测试、自托管部署/恢复/安全等继续未完成。
