# T11 立体声预览节选

修复真实立体声配乐/拟音源被节选渲染器强制转单声道的问题。源声道来自已核验 Composite，进入 v2 节选键、schema2 记录和新阶段命名空间；FFmpeg保留该声道，实际源片与输出均重新验声道。旧 v1 记录和单声道字节仍保留，没有冒充新结果。

失败→通过：请求双声道仍得到 `-ac 1`；制作结果声明 stereo 但 decoded metadata 为 mono 未在读取项目前被拒。修复后分别验证 `-ac 2` 和 `PREVIEW_ARTIFACT_INVALID`。

[实际探针](stereo-selected-excerpt-probe.json)：源片与节选均双声道；节选11秒、264帧、1280×720、3,562,048字节，SHA `693795d7d8919187ca8fb2ee6bb0d6c38dcb5481ca04d1fa02ead33fc4b0226e`，重放完全相同。独立实际解码验证旧mono影片按2ch要求被拒，`historicalMonoRejected=true`。没有新增模型调用。

两项独立复审无新实质发现。Node22完整回归65文件281项通过，lint/build/构建后typecheck与diff-check退出0。声道保持不等于听感质量已通过；用户预览指针、API/UI/Worker及正式制作/导出仍待接通。T11 partial，无push或生产部署。
