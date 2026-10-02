# 08｜决策记录、参考代码映射与来源

## 1. 本版是唯一规范，不是给旧文档增加第六个补丁

| 旧决定 | 本版最终决定 |
|---|---|
| 默认当前目录已有presentationBuddy衍生工程 | 用户的videoBuddy为空仓库；先初始化，再选择性参考复用，不替换Git仓库 |
| 本机两进程、local project.json、轮询 | Vercel + Private Blob + Workflow + SSE，媒体Sandbox |
| 账号/数据库/pg-boss | 不建设；匿名访问凭证、平台持久化和小型Blob CAS控制态 |
| 单Swiss、20/30秒、720p横屏 | 全43风格，20–120秒，横竖版1080p正式输出，风格fps实测 |
| 左导航、4个标签、分镜条、进度仪表盘 | 已确认Easy Companion：左结果右聊天、一个输入与当前一个主动作 |
| 两次故事/画面人工确认 | preview_first：完整文案+关键事实+真实AV节选的一次正式确认 |
| 所有改动先大提案卡 | 明确低风险可逆修改按消息授权直接执行；大改简短确认后新预览 |
| HTTP断开即取消 | SSE读者与执行分离；停止回复、停止制作分别执行 |
| UI样片能播放即完成 | 真实用户内容+真实媒体+全风格/安全/恢复验收 |

## 2. 外部参考代码如何选择性复用

外部参考研究基线 `e8df7ecd6cd339bf859bcfa76c7301023e7972f6`；以下路径属于presentationBuddy，**不是用户当前videoBuddy仓库已有文件**。Codex可在仓库外只读查阅，再按实际需要创建新模块；不把videoBuddy reset到参考提交，不更改origin。许可、依赖与迁入模块逐项记录。[R01]

| 外部参考路径（当前仓库不存在） | 处理 | 新建位置/职责 |
|---|---|---|
| `src/app/globals.css` | 不复制旧PPT主题；直接按已批准设计创建限定作用域变量 | `src/styles/video-easy-tokens.css` |
| `src/components/presentation-studio/presentation-workspace.tsx` | 复用左右分区思想，不带左工具栏和旧尺寸 | CompanionShell |
| `.../agent-panel.tsx`、`agent-markdown.tsx` | 复用安全文本呈现/附件习惯；分离PPT类型 | ConversationSidebar/ChatComposer |
| `.../presentation-studio.tsx` | 不继续追加分支到大文件 | 薄video page + domain/hooks |
| `.../html-preview.tsx` | 不复用srcDoc执行权限 | 原生video/img+签名访问 |
| `src/hooks/use-presentation-workflow.ts` | 不从消息parts反推工作流状态 | ProjectView + use-project-events |
| `src/app/api/analyze/route.ts` | 不沿用abort→cancel或请求内长制作 | 新`/api/video`命令+事件route |
| `src/mastra/index.ts` | 不复制旧LibSQL/Memory；新建仅Agent注册 | `src/mastra/video/index.ts`仅Agent能力 |
| `src/mastra/workflows/presentation-generation-workflow.ts` | 只借鉴分阶段schema与有限修复 | `src/workflows/video/`由Workflow SDK编排 |
| `src/utils/model-provider.ts` | 保留provider/网关解析并补capability测试 | 统一model-adapter，不强制换供应商 |
| `src/services/materials/` | 复用素材交互与理解适配思想，不沿用本机owner文件寿命 | video/assets + Private Blob |
| `src/services/frontend-slides/skill-loader.ts` | 复用安全路径读取思路 | 只读style知识，不加载全部demo |
| `.../style-contract.ts` | 不把CSS标记当风格质量 | 实际渲染与质量基线 |
| `src/services/presentation-artifacts/artifact-store.ts` | global Map不能作权威 | 不可变Blob artifacts + CAS pointer |
| `src/services/agent-proposals/proposal-store.ts` | 借版本/执行ID思想，不用Map | ChangePlan + command/fence |
| `src/utils/save-html-to-file.ts` | 视频不依赖生成HTML公开目录 | 私有对象与AccessGrant |

空仓库不创建旧PPT功能，不搬入/api/analyze、旧preview路由或生成HTML目录。若迁入参考代码时误带旧入口，路由级移除或隔离，不能只隐藏菜单。不创建没有用户需求的双产品壳。

## 3. 冻结版本与开放技术探针

已认可的是交互和功能边界，不是某个未经运行的SDK patch组合。当前文档可用的API能力与模板旧版依赖存在代际差异；T00冻结一组可编译、可执行的组合，并记录升级原因。不要在没有必要时大规模升级业务依赖，也不要为了不升级而使用不持久的临时实现冒充云端功能。

Sandbox是否满足复杂3D由真实renderer、帧率、画质、成本测试判定；未证明GPU就是未证明，不凭平台名称推断。云额度、模型ID、音频使用许可和具体存储签名参数由实际项目配置/SDK类型验证；本包不生成用户凭据或承诺预算数额。

## 4. 来源索引（正文方括号编号）

公开资料复核日期2026-10-02。仓库引用锁定commit；云文档可能更新或搜索缓存落后，应优先发布日期更近的官方变更说明与本地实际SDK类型，再跑契约探针。仅核对文档与固定源码，不把它们等同于目标账号实测。

### [D01] 用户确认的Easy Companion 2.1

本对话交付的 `VideoBuddy_Beginner_Design_System_v2_1.md`、`CODEX_UI_HANDOFF.md` 与原型ZIP。用户明确确认这版视觉交互。本包完整承接其必要规则，design中60个文件原始字节保持不变；hash清单见 `design/reference-manifest.json`。设计示例不是能力证据。

### [R01] presentationBuddy应用骨架

- https://github.com/janily/presentationBuddy/tree/e8df7ecd6cd339bf859bcfa76c7301023e7972f6
- https://github.com/janily/presentationBuddy/blob/e8df7ecd6cd339bf859bcfa76c7301023e7972f6/package.json
- https://github.com/janily/presentationBuddy/blob/e8df7ecd6cd339bf859bcfa76c7301023e7972f6/src/utils/model-provider.ts
- https://github.com/janily/presentationBuddy/blob/e8df7ecd6cd339bf859bcfa76c7301023e7972f6/src/app/api/analyze/route.ts
- https://github.com/janily/presentationBuddy/blob/e8df7ecd6cd339bf859bcfa76c7301023e7972f6/src/mastra/index.ts

package声明Next16.1.1、React19.2.3、Mastra core ^0.24.9等；这些是声明而非本次安装验证结果。文件映射沿用固定源码核对；声明版本不作为新空仓库的已验证依赖。T00先初始化，再冻结实际兼容组合。

### [R02] Lemo-Opuscar方法与43风格

- https://github.com/lemomo-ai/lemo-opuscar/tree/c4bc370eb15d36c88e074fdba1b0248b62a8e419
- https://github.com/lemomo-ai/lemo-opuscar/blob/c4bc370eb15d36c88e074fdba1b0248b62a8e419/styles/README.md
- https://github.com/lemomo-ai/lemo-opuscar/blob/c4bc370eb15d36c88e074fdba1b0248b62a8e419/AGENTS.md
- https://github.com/lemomo-ai/lemo-opuscar/blob/c4bc370eb15d36c88e074fdba1b0248b62a8e419/DIRECTOR.md
- https://github.com/lemomo-ai/lemo-opuscar/blob/c4bc370eb15d36c88e074fdba1b0248b62a8e419/TECHNIQUE.md
- https://github.com/lemomo-ai/lemo-opuscar/blob/c4bc370eb15d36c88e074fdba1b0248b62a8e419/core/README.md
- https://github.com/lemomo-ai/lemo-opuscar/blob/c4bc370eb15d36c88e074fdba1b0248b62a8e419/LICENSE

风格身份按索引，不代表已适配。上游代码/文档许可依固定版本与单项CREDITS核验；第三方素材不会因仓库根许可自动变成统一许可。本包不重新分发上游影片/音库/字体/模型权重。

### [V01] Vercel Workflows

https://vercel.com/docs/workflows

采用持久步骤与可回放编排；平台托管其底层队列/存储，不要求本应用另建数据库。单step仍在Function运行，不能由“workflow很长”推导一个step无限长。未要求依赖实验性动态workflow或最新多区域Beta。

### [V02] Functions限制与取消

- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/functions-api-reference

SSE仍有执行时限；本文300/240秒是兼容保守设计，不是全平台永恒上限。大文件不穿普通JSON代理，媒体依赖不装进Web Function。

### [V03] 官方Workflow流式文档

- https://github.com/vercel/workflow/blob/main/docs/content/docs/v4/foundations/streaming.mdx
- https://workflow-sdk.dev/docs/foundations/streaming

本次读取官方仓库正文（blob SHA `48a51d3a64d330164670770e22dcf0457a6eb9e4`）：getWritable用于step，getReadable可按startIndex续接；读流路由断开不应取消run，平台流仍有保存期限。网站入口与对应仓库文档版本要和实际安装SDK对齐。

### [V04] Blob SDK条件写

https://vercel.com/docs/vercel-blob/using-blob-sdk

查询核对ifMatch、ETag、allowOverwrite、受限client upload；本次完整网页打开有超时，使用检索返回的官方API段落及下述较新官方变更说明交叉核对。以T00实际SDK竞争测试为准，不把文档查询当CAS性能或一致性实测。

### [V05] Private Blob一致读、签名与身份

- https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage （2026-07-14）
- https://vercel.com/changelog/vercel-private-blob-is-now-generally-available （2026-06-30）
- https://vercel.com/changelog/vercel-blob-now-supports-oidc-authentication （2026-06-01）
- https://vercel.com/docs/vercel-blob/private-storage

较新说明提供useCache:false、private signed URL及OIDC；旧缓存页面仍可能展示Beta和只能Function代理的历史描述。按已锁定SDK做实际验证，不向浏览器下发RW token。

### [V06] Sandbox SDK与资源

- https://vercel.com/docs/sandbox/sdk-reference
- https://vercel.com/docs/sandbox/pricing

detached命令、查询、停止是媒体任务执行基础；资源规格不构成GPU存在的证据。T00需验证实际命令完成判定，不能把新Command对象exitCode=null直接当失败或成功。

### [V07] Workflow保存期与运行额度

https://vercel.com/docs/workflows/pricing

平台run/stream保存期与套餐相关，业务消息和文件单独归档。没有在本包写具体金额或将平台保存期当项目30天保留承诺。

### [V08] Workflow start与防重

https://github.com/vercel/workflow/blob/main/docs/content/docs/v4/api-reference/workflow-api/start.mdx

start每次调用创建run；查询hook再start不是原子操作。本文用command记录、canonicalRun claim和stage effect记录保护副作用，不承诺外部模型计费恰好一次。

### [V09] Sandbox网络隔离

- https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox
- https://vercel.com/docs/sandbox

显式网络策略、凭据隔离、输出验证属于部署实现，不能只因为使用Sandbox就默认无网络或安全无误。

### [M01] Mastra Agents与结构化输出

- https://mastra.ai/docs/agents/overview
- https://mastra.ai/docs/agents/structured-output

schema仅约束输出结构，还需事实、权限、时间轴和实际媒体校验。采用Agents/tool适配，不让Mastra再管理与Vercel重复的长期生产DAG。

### [A01] W3C无障碍参考

- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

按已确认设计的正文4.5:1、必要边界3:1目标检查；44px点击区为本产品设计标准，不能误说WCAG AA统一要求44px。整体可用性需真页面/键盘/屏幕阅读器测试，不由token数值单独证明。

## 附录：全部43种风格与交付批次

完整身份来自固定commit索引[R02]。每项横竖版验证状态初始not_run，详见 `acceptance/style-matrix.json`。

| 类别 | 中文名 | English | slug | 批次 |
|---|---|---|---|---|
| 手绘与绘画 | 蜡笔儿童绘本 | Crayon Picture Book | `crayon-book` | T15 |
| 手绘与绘画 | 水彩笔刷 | Watercolor Brush | `watercolor` | T15 |
| 手绘与绘画 | 中国水墨 | Chinese Ink Wash | `ink-wash` | T15 |
| 手绘与绘画 | 油画厚涂 | Impasto Oil Painting | `impasto` | T15 |
| 手绘与绘画 | 一笔画 | One-line Drawing | `one-line` | T15 |
| 手绘与绘画 | 白板讲解 | Whiteboard Explainer | `whiteboard` | T15 |
| 手绘与绘画 | 钢笔淡彩 | Urban Sketch · Pen & Wash | `urban-sketch` | T15 |
| 东方传统 | 皮影戏 | Shadow Puppetry | `shadow-puppet` | T15 |
| 东方传统 | 浮世绘 | Ukiyo-e | `ukiyoe` | T15 |
| 东方传统 | 红色窗花剪纸 | Red Paper-cut | `papercut-red` | T15 |
| 东方传统 | 纸雕灯影 | Paper-cut Lightbox | `paper-lantern` | T15 |
| 印刷与版画 | Risograph 丝网印刷 | Risograph Print | `risograph` | T15 |
| 印刷与版画 | 复古半调案卷 | Halftone Dossier | `halftone-dossier` | T15 |
| 印刷与版画 | 木刻版画 | Woodcut Print | `woodcut` | T15 |
| 印刷与版画 | 铜版画 | Copperplate Engraving | `engraving` | T15 |
| 印刷与版画 | 丝印旅行海报 | Silkscreen Travel Poster | `silkscreen-poster` | T15 |
| 图形与排版 | 瑞士动态排版 | Swiss Motion Graphics | `swiss-motion` | T16 |
| 图形与排版 | 60s 间谍片头 | 60s Spy Title Sequence | `spy-titles` | T16 |
| 图形与排版 | 装饰艺术 | Art Deco | `art-deco` | T16 |
| 图形与排版 | 蓝图 / 工程制图 | Blueprint | `blueprint` | T16 |
| 图形与排版 | 彩色玻璃窗 | Stained Glass | `stained-glass` | T16 |
| 图形与排版 | 象形运动图形 | Pictogram Motion | `pictogram-motion` | T16 |
| 图形与排版 | ASCII / CRT 终端 | ASCII / CRT Terminal | `ascii-crt` | T16 |
| 信息与发布 | 数据叙事 | Data Storytelling | `dataviz` | T16 |
| 信息与发布 | 等距信息图 | Isometric Infographic | `iso-infographic` | T16 |
| 信息与发布 | 暗色科技发布 | Dark Tech Keynote | `dark-keynote` | T16 |
| 信息与发布 | 活体实机录屏 | Living Screencast | `living-screencast` | T16 |
| 信息与发布 | 科幻全息界面 | Sci-fi Hologram HUD | `hologram-hud` | T16 |
| 卡通与动画 | 1930s 橡皮管卡通 | 1930s Rubber Hose Cartoon | `rubber-hose` | T17 |
| 卡通与动画 | 80 年代赛璐璐动画 | 80s Cel Anime | `cel-anime-80s` | T17 |
| 卡通与动画 | 科幻情景喜剧卡通 | Sci-Fi Sitcom Toon | `scifi-toon` | T17 |
| 卡通与动画 | 50s 扁平卡通 | Mid-century Cartoon | `midcentury-toon` | T17 |
| 游戏 | 16-bit 像素 RPG | 16-bit Pixel RPG | `pixel-rpg` | T17 |
| 游戏 | HD-2D | HD-2D | `hd-2d` | T17 |
| 游戏 | 微游戏快闪（瓦里奥制造式） | Microgame Frenzy | `microgame` | T17 |
| 游戏 | 综艺节奏扁平 | Game Show Flat | `game-show` | T17 |
| 电影与时代 | 1920s 默片 | 1920s Silent Film | `silent-film` | T17 |
| 电影与时代 | 后室 / 新怪谈 | Liminal Found Footage | `backrooms` | T17 |
| 材质与 3D | 积木玩具 | Brick Toy | `brick-toy` | T18 |
| 材质与 3D | 纸片立体书 | Paper Pop-up Book | `paper-popup` | T18 |
| 材质与 3D | 移轴微缩 | Tilt-Shift Miniature | `tilt-shift` | T18 |
| 材质与 3D | 低多边形等距 | Low-poly Isometric Island | `lowpoly-island` | T18 |
| 材质与 3D | 玻璃质感产品 | Glass Product Render | `glass-product` | T18 |
