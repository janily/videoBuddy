# T13 混音授权撤销与停止不确定性

固定代码基线 `24061e2`。implemented/tested，deployed=false；C0/C1/C2 均未达到。

混音生产者使用唯一名称、invocation 标签、固定镜像的 owned Docker 执行器，传递配置超时与授权回调。输入读取前、容器启动前、运行中及输出读取前后核验授权。撤销后不返回已算出的混音；任务文档、工具 SHA 和输出算法保持不变。

修复共享执行器中停止失败被原 RENDER_FENCED 覆盖的问题。身份不符禁止 stop；inspect 失败不能直接视为容器不存在，必须通过正常 Docker daemon 的精确名称清单核验，并要求 attached run 正常退出。无法证明停止时返回 MEDIA_STOP_UNKNOWN。此错误不代表已停止或允许重做未知任务。

两轴复审实际复现顺序和并发 P2：第一次 stop 成功后第二次 daemon 检查失败，或第一次 stop 尚未完成时 attached timeout 又触发清理，会把已知停止覆盖为 unknown。精确断言均 RED→GREEN。最终同一次 invocation 共享停止 Promise，首次成功或失败都保留，不重复清理或自动重试 unknown；stop 子进程 timeout 原先暴露 STOP_TIMEOUT 的断言也 RED→GREEN。两轴独立复跑各自 /tmp 复现均 clean，仓库 12 项相关测试通过，无提供方或真实 Docker 审查调用。

测试过程：owned Docker 两条业务断言先失败（预期 MEDIA_STOP_UNKNOWN，实际 RENDER_FENCED），随后通过；初次 fake-timer 断言出现延迟处理 Promise 警告，改为立即捕获结果再断言后无警告。master 首轮 fixture 缺 section，不计业务 RED；修正 fixture 后四项真实断言失败于裸 UNOWNED_EXECUTION，接入 owned 执行器及授权核验后通过。unit 子进程均为协议模拟，不是实际媒体验收。

实际命令与结果（Node 22.23.1）：

- 初轮相关 4 文件 21 项通过；最终 owned/master 2 文件 12 项通过。
- 完整 `npm test` 初轮：96 文件 478 项通过，44.34 秒；首次 P2 修复 checkpoint 为 479 项，43.29 秒。云/模型开关关闭，最终并发修复后的全量结果另记下文。
- `npm run lint`、`npm run build`、构建后 `npm run typecheck`、`git diff --check`：退出 0。
- `node --import tsx scripts/video/probe-music-master-cancellation.ts --master-cancellation`：退出 0，见 [最终 20 秒原件实测](music-master-cancellation-probe.json)。新 owned 执行路径默认混音 SHA 与原归档一致；撤销在完成后返回前发生，不返回 mix。最终 afterRevocationMs=41，containerId=null，**没有运行中停止证据**。保留 [初轮记录](music-master-cancellation-initial.json)（43ms）和 [顺序修复 checkpoint](music-master-cancellation-confirmed-state.json)（42ms）。
- 同命令追加 `--load-120`：退出 0，见 [120 秒负载实测](music-master-cancellation-load.json)。每条真实归档 bus 重复六次，仅用于生产者负载测试，不是模型创作的 120 秒影片或有效 FilmPackage；仍在返回前撤销，afterRevocationMs=96，containerId=null，**没有运行中停止证据**。未抹掉首轮或冒充更强通过。

四次实测均使用固定断网镜像，无额外提供方/网络调用，原项目 control/budget 未变，resultPublished=false。20秒混音很快，长负载也未观察到运行中实例，因此该切片只证明默认输出兼容与完成后拒绝返回；运行中停止的新增证明是协议测试，不能当作真实 master 停止验收。

限制：这是修改执行的生产者前置能力，尚未准入用户修改 operation、新 revision、完整 QA 或发布。调用方仍须提供真实授权检查，并处理 MEDIA_STOP_UNKNOWN；公共取消生命周期和物理清理不能因此算通过。最终 loudnorm 音量意图冲突、旧模型 unknown 用量、全部风格和最终交付验收继续未完成。

最终共享 Promise 修复后：完整 96 文件 481 项单测通过（44.58 秒），lint、build、构建后 typecheck 与 diff-check 均退出 0。两轴复审均 clean。现有 prepareAudioExecutionStage 还未向 master 传入该回调，sound 生产者也仍使用旧执行路径；公共停止 unknown 的生命周期需继续接入，不能将内部回调支持报告为用户取消已全部有效。
