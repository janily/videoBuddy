# T00 锁定依赖

Node 22.23.1；npm 11.18.0。npm ci 实际安装成功，0 vulnerabilities（同 major 覆盖 nanoid 5.1.16、devalue 5.9.3 修复传递依赖）。没有 legacy-peer-deps/as never。

- @mastra/core: 1.74.0
- @opentelemetry/api: 1.9.1
- @tailwindcss/postcss: 4.3.3
- @vercel/blob: 2.8.0
- @vercel/sandbox: 3.5.1
- next: 16.3.8
- react: 19.3.0
- react-dom: 19.3.0
- tailwindcss: 4.3.3
- workflow: 5.0.1
- zod: 4.6.5
- @playwright/test: 1.63.0
- @types/node: 26.6.4
- @types/react: 19.3.0
- @types/react-dom: 19.3.0
- ajv: 8.20.0
- ajv-formats: 3.0.1
- eslint: 9.39.5
- eslint-config-next: 16.3.8
- tsx: 4.23.15
- typescript: 6.0.3
- vitest: 5.0.3

核对官方 [Blob 条件写与签名](https://vercel.com/docs/vercel-blob/using-blob-sdk)、[一致读变更](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage)、[Mastra Agent](https://mastra.ai/reference/agents/agent)、[Workflow Next 接入](https://github.com/vercel/workflow)。实际 SDK 类型具备 useCache:false、ifMatch、allowOverwrite:false、getReadable/startIndex。云行为尚未验证。Next 自动生成 AGENTS.md/CLAUDE.md，已读取其规则与当前安装包 Route Handlers/Client Components 文档。
