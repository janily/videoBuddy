# T05/T09/T11/T12 私有图片运行时增量（2026-10-05）

基线 `1485ddeaa3a39d29e4f5e4954303837206bc41eb`；实现 `fbbd115`、诊断类型修正 `d12477c`、审查修正 `34cea0b`、解码错误明确化 `9e08312`、最终独立浏览器生命周期 `16858d2`。仅本地提交，无 push/部署，无新模型调用。保留已批准视觉、43 风格范围、持久消息/SSE、全部原项目与未知预算；本项不是整个项目交付，C0/C1/C2 未达到。

## 实现与实际范围

- `runtime-assets.ts` 从该项目冻结 asset manifest 中选择 VisualSource 明确声明的 PNG/JPEG/WebP；UUID、MIME、SHA、字节数与原私有卷文件一致才可使用。限定项目路径/阶段路径，拒绝软链接、未知硬链接、变更文件。先核验所有源，再原子复制到阶段；每次恢复冷核原图及复制字节。没有视觉素材引用的 Markdown 来源不再被 blanket 拒绝。
- preview picture 与 approved picture 共用选择和复制逻辑。非空素材目录以 readonly mount 进入无网络/无凭据容器；素材清单参与 stage hash，空清单保留原 hash/mount。Visual 获得受信服务派生的 `/assets/<uuid>.bin` 清单；未 ready/rightsConfirmed/未被 Understanding 使用的图片不能提供给模型。
- 固定运行时 HTTP 服务只暴露 scene 与声明的图片；精确 MIME/no-store/nosniff，GET/HEAD，禁止 job.json、外来文件与路径逃逸，逐次实读哈希。所有声明图片在场景代码执行前，由独立浏览器实际解码；随后关闭解码浏览器，另启动场景浏览器。场景覆盖 Image/HTMLImageElement.decode 不影响可信解码检查。
- 含图片任务启动前独立读取安装镜像内 render.mjs/helper 的 SHA，与当前仓库受信源码一致；旧/缺 helper 镜像提前拒绝。工程 ZIP 包含受信图片服务文件，不包含访问密钥。
- 诊断正/负任务保存、查询、fence/超时故障统一停止同一 handle；无法确认停止保留 MEDIA_STOP_UNKNOWN。诊断报告独占准入，不覆盖旧失败或未知。

## RED→GREEN 与代码测试

- runtime-assets、HTTP 服务、安装镜像合同分别首次因缺模块失败；只读 mount 实际旧参数不满足；完成后目标通过。
- approved-render 中真实 Markdown 与声明 PNG fixture 首次都因 VISUAL_ASSET_RUNTIME_UNAVAILABLE 失败，修正后正确派生任务；篡改原图片拒绝。
- 声音/包装配联合 fixture 用实际本地 PNG：预览 picture、冻结包、节选引用与恢复能贯通；复制图片篡改拒绝且未重渲染。此套件注入媒体/QA/声音，不是实际整片 QA。
- Visual 未声明目录先于任何模型配置/发送被拒绝，协议请求包含真实私有 URL。
- 审查 P2：负例直接 submit 后报告保存失败未停止容器。统一 helper 后，expected failed 必须终态失败且无输出；报告/inspect/fence 故障停止精确 handle；cancelling/stop throw 保留 unknown。新增实际 RED 为 CLEAR_FULL_FILM_PICTURE_FAILED，修正后 5 项通过。
- 真实旧运行时解码绕过见下；修正后的最终实际原症状被拒绝。
- 初版完整 `npm test`：135 文件679项，65.21s，退出0。停止保护修正后全套135文件681项，65.57s，退出0。最终代码相关五文件23项7.07s退出0。最终全套结果补记在文末。
- 生产构建一次因新增测试 vi.fn 返回 status 宽化为 string 失败，明确 literal as const 后 build 退出0；构建后 typecheck 退出0，lint 退出0。测试最早缺 readFile import/fixture 路径错误也保留为实际失败，未改阈值掩盖。

## 真实媒体证据与失败保留

仅合成两色16×16 PNG 验证私有图片运输/真实解码/渲染；不代表用户素材语义、风格或整片质量。全部生产诊断 deliveryEligible=false、无正式批准/结果发布，0 模型调用。

| 证据 | 实际结论 |
|---|---|
| `runtime-assets-probe.json` | 首次 native 参数准入错误 MEDIA_JOURNAL_INVALID，native journal 0，未执行媒体。 |
| `runtime-assets-v2-probe.json` | 有效图片真实渲染/全解码通过，旧 image 会接受外来图片，新 image 拒绝。运行载入的脚本晚于 actual status metadata 修正前，正例 status 字段缺失；不能以修正后代码倒写历史。独立 handle audit 核退出与实际 worker state。 |
| `runtime-assets-handle-audit.json` | 两个旧已知 handle 身份/退出0核验后无 force 删除。初审错误地期待失败 scene 控制器 exit1，实际 worker 用 failed state、控制器 exit0；第一次已删除正例的证据明确标为历史核验。 |
| `runtime-image-decode-before-fix.json` | 24字节 signature-valid 损坏 PNG，场景覆盖 Image 和 prototype.decode，旧3cbf…仍实际产生1593字节MP4，绕过真实复现。 |
| `runtime-image-decode-after-fix.json` | direct --rm 运行非零退出时停止 journal 为 unknown，MEDIA_STOP_UNKNOWN。该历史脚本错误写 blocked；**不能作为通过**。未知账本原样保留；`runtime-assets-v3-handle-audit.json` 单独纠错并只核目前所属容器不存在，未 reset/退款/自动重试。后续诊断使用不同的持久 runner 协议，均非模型调用。 |
| `runtime-assets-v3-probe.json` | 正例通过；损坏图片 failed，但日志为 Playwright Assertion error，未证明特定解码原因。第三容器审计遇到错误预期 EncodingError；两条先行删除均已durable归档。v3 audit保留该失败，最终核验/清理第三条，只记录通用失败。 |
| `runtime-assets-v4-probe.json` | 同浏览器多 context 生命周期触发 Playwright Assertion error，有效图片 failed；本轮失败，未算通过。 |
| `runtime-assets-v5-probe.json` | 最终独立 browser 生命周期：有效图片真实渲染/编码/全解码通过，外来图片 failed，损坏图片＋覆盖解码器 failed。 |
| `runtime-assets-final-handle-audit.json` | 精确ID/image/name/stage/exited0/worker state校验；v4与v5共4个已知所属容器无force删除。v5损坏负例实际日志明确 Error: IMAGE_DECODE_FAILED。原真实项目/未知 model 与 direct native journal 的全部JSON审计前后相同。 |

最终有效视频：320×180、24fps、1s/24frames、无音轨、2340 bytes，SHA `c6b6c426ec5894a58c7e2ac6454a20a58cda854c5d338798998e5f5634d76c09`。实际 FFmpeg 解码抽取左右像素 `[255,23,0]`、`[0,215,0]`，证明上传图片出现在实际视频；不证明全面图像/字体/用户内容 QA。

各 probe 执行前后重读原 clear 项目 root 与 unknown model root 全部 JSON 哈希，均 unchanged=true。原 clear-full 成片 SHA `cb5ac845…`、冻结包、运行时 c91…、控制态与费用 unknown 不改。31批244PNG原全片 Critic 无新增调用，无 unknown 重试/新账本绕过。

## 安装与尚未完成

最终本地诊断镜像：`sha256:4c3bd5cce5df16440ad69efe217b901a1558443effe1e7226800f8f20e468ba2`，仅从本地固定 c91…基镜像复制受信文件，`docker build --network none --pull=false`，无安装/下载。build manifest 与最终 render/helper SHA/bytes 归档在 v5 report。镜像尚未推送/部署。

新的含图片项目可使用此本地镜像，将 VIDEO_MEDIA_IMAGE_REF 设置为完整 image ID、VIDEO_MEDIA_RUNTIME_DIGEST 为不含 `sha256:` 的64字符值；其他音频、字体、许可与生产配置仍须完整提供。不要修改旧冻结项目的运行时摘要或包以强行迁移。完整 Dockerfile 的可复现干净构建、镜像分发/新环境部署尚未验收。旧素材为空路径保持，但当前私有图片版本要求运行时受信源码一致。

PNG 已真实验证；JPEG/WebP 目前只有 schema/运输接线，未实测实际解码。图片语义/来源分类模型、用户素材要求覆盖与全片独立 QA 仍待真实验证；扫描 PDF、长文检索、音乐/长录音可靠理解尚未完整完成。此增量未完成 T05 全部能力或正式制作/修改/导出公共闭环。全片连续运动/音乐听验/字幕/许可检查、全部43风格86基线及公开 profiles、22功能/92验收/16Agent评估/5用户观察/运维与安全恢复仍未完整达到，不改 C0/C1/C2 状态，不添加审批或模型预算重试。

最终验证（固定 `16858d27796af76980057d1dde917623765cfe1f`）：完整 `npm test` 135文件681项，65.85s，退出0。最近生产 build 与构建后 typecheck 退出0；最终改变只在受信离线 renderer 与诊断报告路径，实际最终镜像 v5 正/负/损坏反例已验证。相关五文件23项通过。固定两轴独立审查 `1485dde…9e08312` 与最终增量 `9e08312…16858d2` 均 clean；只代表本项代码范围。最终 lint、diff检查结果见下。
最终 `npm run lint` 退出0；`git diff --check` 退出0。implemented/tested 为本地范围，deployed=false。
