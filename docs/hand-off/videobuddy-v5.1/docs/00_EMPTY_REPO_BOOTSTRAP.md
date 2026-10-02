# 00｜在 videoBuddy 空仓库中初始化（v5.1）

**适用起点：** 用户已有独立的 videoBuddy Git 仓库，目前没有应用代码。仓库可能已有 `.git/`、README、LICENSE、AGENTS.md 或本交付文档；这些不算应用已经初始化。**presentationBuddy 是外部参考项目，不是当前工作目录。**

**本章是开发入口的更正，不改变已批准的产品范围、Easy Companion 2.1 视觉、SSE、43 风格、无登录和无应用数据库要求。** 本章与重写后的 T00 同步生效；其余任务从这个新工程继续开发。

## 1. 三个位置，不要混淆

| 位置 | 用途 | 不允许的操作 |
|---|---|---|
| 当前 videoBuddy 仓库根目录 | 唯一应用目录：在这里创建 package.json、src、tests、配置 | 不改 origin 指向 presentationBuddy；不覆盖 .git，不另建嵌套应用仓库 |
| `docs/hand-off/videobuddy-v5.1/` | 本交付包：规范、设计、示例、验收目标 | 不在这里安装应用依赖、启动第二个 Next 应用；不把示例直接发布 |
| 仓库外临时参考目录或只读源码浏览 | 查阅 presentationBuddy / Lemo 的固定版本 | 不把参考仓库的 .git、密钥、旧产物、node_modules 或整个旧业务搬进目标工程 |

所有任务中的 `src/...`、`tests/...`、`scripts/...` 都相对于 **videoBuddy 仓库根目录**，不是相对于交付包里的 `docs/`。资料包名称不是仓库名称。

## 2. 开始前核对，不把空仓库当异常

先执行只读检查：

```sh
pwd
git status --short
git remote -v
git branch --show-current
```

检查根目录是否存在 `package.json`、`src/app/` 和 lockfile；逐项记录。没有 lockfile 时不得先执行 `npm ci`；没有测试脚本时记录“工程未初始化”，不是“测试失败”。没有首个 commit 时 HEAD 不存在是正常情况，不能因此重新初始化或删除 `.git/`。

在 `docs/engineering/bootstrap-report.md` 记录实际根目录、已有文件、当前分支、原始 origin，以及启动方式。只记录 remote 身份，不保留 URL 中可能存在的凭据。保护 README、LICENSE、AGENTS.md 和未提交文件；若内容必须更新，以可审查的增量修改方式进行。

需要建立工作分支时沿用仓库既有规则；没有首个 commit 时使用正常的 unborn branch 流程。不得猜测仓库 URL 或执行 `git remote set-url`。**不需要用户先手工复制 presentationBuddy，Codex 自行读取参考并实施新工程。**

## 3. 默认初始化路线

**选择：新建干净的 Next.js App Router / React / TypeScript / Tailwind 工程，再选择性复用参考模块。不是完整 fork，也不是重新选架构。**

使用 `src/` 目录；生产包名固定 `videobuddy`；TypeScript 开启 strict；默认 npm，生成唯一 `package-lock.json`。已有明确选定的其它包管理器时才沿用，并同步修改文档命令，不能并存两套锁文件。

具体 SDK 版本先检查官方文档、包的 engines/peerDependencies，再以 T00 的安装、类型检查和运行结果冻结。不要直接把参考仓库的旧 `package.json` 与新 Workflow SDK 混装；本章没有声明任何新版本组合已经验证。

最低目录成果如下。按任务增加文件，不为凑目录创建空服务或重复模块：

```text
videoBuddy/                         # 用户当前仓库，名称及 origin 不变
  package.json                      # name: videobuddy
  package-lock.json
  tsconfig.json
  next.config.ts
  eslint.config.mjs
  postcss.config.mjs
  vitest.config.ts
  playwright.config.ts
  .gitignore
  .env.local.example
  src/
    app/
      layout.tsx
      page.tsx                      # 正常引导/重定向到 /video
      globals.css
      video/page.tsx
    styles/video-easy-tokens.css
    components/video-studio/         # 按已批准设计逐项实现
    contracts/video/                # T01 建立
    mastra/video/                   # Mastra Agents，不引入数据库存储
    workflows/video/                # Vercel 长流程
    services/video/
  tests/video/
  scripts/video/
  docs/engineering/
  docs/hand-off/videobuddy-v5.1/      # 交付参考，不是应用子目录
```

空仓库不要求 `src/components/presentation-studio/`、`/api/analyze`、旧 PPT 页面或原来的 LibSQLStore 存在。不要先创建旧模块再把它们迁移掉。正式路由只有新产品所需接口。

### 3.1 别名与构建规则

新工程固定 `@/*` → `./src/*`。新代码写 `@/services/...`，不写 `@/src/services/...`。从参考项目复用代码时，逐项改写 import 并跑类型检查；不要对整个资料包盲目替换文本。

`tsconfig.json` 的 include/exclude 与测试配置明确排除本交付资料目录和临时参考目录。Vitest 只运行应用测试，Playwright E2E 不被 Vitest 收集。源码示例、原型 JavaScript 和文档检查脚本不能被当成生产测试。

开发、测试与构建不应该因为缺少云密钥而在模块导入时崩溃；真实请求用类型化配置错误说明未接入。禁止返回假上传、假回复、假成片。mock 仅在测试与明确标注的独立组件演示使用。

### 3.2 初始化后必须提供的命令

| 命令 | 预期用途 |
|---|---|
| `npm run dev` | 启动新工程，可打开 `/video` |
| `npm run build` / `npm run start` | 构建和启动产品，不是打开静态原型 |
| `npm run lint` | 检查应用源码 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 运行应用单元/集成测试；无测试不能假装成功 |
| `npm run test:video:e2e` | 运行独立浏览器验收配置 |

首次选择依赖并生成 lockfile 后，再以 `npm ci` 验证干净安装。锁定所选 Node 版本；云探针显式授权后执行。图片/字体按既定授权方案配置；不从本机复制字体文件进交付包。

## 4. presentationBuddy 怎么用

参考版本和来源见 08 的 [R01]。Codex 可以用只读连接器或仓库外临时 checkout 阅读；参考不可获取时记录阻断，不阻塞按明确契约创建目录、组件和单元测试，也不得声称已复用未经读取的代码。

适合借鉴的部分：工程组织、provider/网关配置方式、安全 Markdown 消息呈现、附件体验、结构化输出校验和有限修复思路。每项复用先查许可与依赖，再去掉旧 PPT 类型，增加新项目的测试。**已有源代码不等于已兼容当前新工程。**

不迁入：旧完整生成工作流、双审核业务、srcDoc 执行方式、Map 权威状态、LibSQL/Memory 存储、公开生成 HTML 目录、原项目临时文件与任何密钥。若只是参考交互思想，则无需复制文件。

参考模块的归属记录在 `docs/engineering/reference-reuse-map.md`：源仓库/commit/文件 → 新文件 → 原样复用、改造或仅参考 → 许可处理 → 验证证据。目标新文件以功能职责命名，不把产品改回 presentationBuddy。

## 5. T00 的三段成果

**T00-A：新工程可启动。** 根目录初始化完成，已认可侧栏布局有真实 React 外壳，尚未接入的功能明确说明；不能把 design/preview.html 用 iframe 包装成产品。

**T00-B：兼容性与本地测试。** 安装锁定的 SDK，建立 Mastra 最小调用适配、配置校验、测试入口和引用映射。仅本地、无付费依赖的部分要能运行，真实模型验证另记。

**T00-C：六项真实云能力探针。** 保留原 T00 对 Blob CAS/初建、Workflow run claim/续流、Sandbox detached/停止、中文字体音频和 2D/3D 执行的探针要求。凭据或授权缺失时逐项 blocked；T00-A/B 可先交付，T00 整体不得因此标为 complete。依赖真实服务的后续集成保持阻断，但可继续独立的契约、UI 与单元测试开发。

本章没有缩小全43风格交付，也没有重新要求用户先手动 fork。初始化只是工程起点，不是新一轮产品设计。

## 6. 空仓库补充验收（BT-01–BT-08）

这些是增加在 T00 内的待执行检查；原 92 条产品验收与 T00–T21 编号保持不变。

| ID | 场景 | 应有结果 |
|---|---|---|
| BT-01 | 仅有 .git、README 和交付文档 | 在原仓库根目录初始化成功；原有文件不丢，origin 不变 |
| BT-02 | 没有 package.json / lockfile / 测试脚本 | 正确识别未初始化，不先执行 npm ci，也不伪报原有测试失败 |
| BT-03 | 已经运行一次初始化，再次执行入口 | 增量继续，不能覆盖现有配置、用户代码或重复创建应用 |
| BT-04 | 根目录到处都没有旧 PPT 路径 | 直接建立 video 模块，不要求用户补齐旧路由 |
| BT-05 | 迁入的参考代码使用 @/src 前缀 | 适配到 @/，typecheck 能发现未处理的引用 |
| BT-06 | 缺少云 API Key 或未授权测试消耗 | 本地外壳/纯测试可用；真实服务明确 blocked，无假结果和静默付费 |
| BT-07 | /video 已显示且 SDK 依赖已配置 | 真 React 页面，有侧栏与一个输入框；不是静态原型套壳 |
| BT-08 | 产品打包与测试收集 | 交付示例不进入生产业务或应用测试，设计60份参考文件hash不变 |

正式初始化完成需要应用代码和真实命令记录。本次 v5.1 交付仍然只是开发文档与已认可设计文件，尚未对用户空仓库进行写入、安装或部署。
