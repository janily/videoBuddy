# T13/T14 持久媒体调用与冷停止

2026-10-04（上海），基线 `943b909`。implemented/tested，deployed=false，C0/C1/C2 未达到。

sound/master 的正式预览阶段现将真实 store 和项目/操作 media-effects 前缀传入 owned Docker。启动前通过 FileStore create 持久固定 invocation、镜像、参数 SHA 与 started 状态；再次核验授权后才能 spawn。调用参数包括内容寻址输入/输出路径，journal 不保存密钥或完整 argv。相同调用只能有一个 producer；已完成调用返回固定 stdout，音频消费者仍独立检查实际 WAV、任务和输出回执。started/unknown 冷调用不能再启动；stopped 不能伪装为 completed。

冷停止只核记录对应的精确名称、镜像、invocation 标签、参数 SHA 标签、完整 container ID、运行状态及无自动重启策略。不以 Running=false 推断停止：created/restarting 保留 unknown；停止后必须确认 exited/no-restart 或正常 daemon 的精确名称清单确证移除。没有完成/停止回执的冷 absence 仍不充分，原客户端可能尚未 start。运行中取消使用同一个核验路径；仅真实附着 CLI 正常 exit0 与 daemon 确证 absence 可作为 warm 额外证明。首次停止 Promise 保持共享，不重复停止。

completed/stopped 回执固定，未知观察不能覆盖。完成或停止的 CAS 丢 ACK 时先 fresh 核验同 invocation/hash/image 回执：完成恢复原 stdout 并复核授权，不因 daemon 故障制造新的未知停止。

RED→GREEN：缺 journal 模块先退出1；post-fsync 撤销仍 spawn 的业务断言先失败，随后零 spawn/stopped。两轴独立实际 FileStore 复现 cold created 与 warm attached open/created 被误认为 stopped 的两个 P1；仓库 warm 用例实际 RED stopped→GREEN unknown。completed CAS 已 fsync、ACK 丢失、daemon 不可达的 P2 实际 RED MEDIA_STOP_UNKNOWN→GREEN 原 stdout/只有 run。探针 inspect 非0曾推断 null/removed 的证据 P2，改为正常 exact-name ps 空匹配才认 absence，独立 daemon/residual fixtures 均 UNKNOWN。两轴最终 clean。unit Docker 为协议模拟，FileStore 为实际 Python CAS，不计真实媒体 QA。

实际命令（Node 22.23.1）：

- `node --import tsx scripts/video/probe-docker-journal.ts --docker-journal-lifecycle`：最终退出0，见 [最终记录](docker-journal-probe.json)。固定断网镜像真正运行 FFmpeg 实时音频信号处理；宿主 SIGKILL 后再次观察原容器 running，cold FileStore 从 started 核验同资源并停止、确认移除、落盘 stopped，重放 MEDIA_EXECUTION_INTERRUPTED。此为生命周期诊断，不是模型创作音视频、公开取消或完整清理验收。保留 [status checkpoint](docker-journal-status-checkpoint.json)、[ACK checkpoint](docker-journal-ack-checkpoint.json)。
- 一次最终探针实际退出1/RESOURCE_UNKNOWN：inspect 尚无容器、紧接 ps 已出现同名创建资源，不能认 absence。没有重启该制作；核验实际原容器仍 running 后，按原 journal 冷停止成功，见 [失败及原资源恢复](docker-journal-observation-race.json)。启动观察阶段改为重观测同一持久 handle；最终缺席确认仍严格，不能吞 daemon 错误。最后一次新探针是前次原资源核实已停后的独立诊断。
- `node --import tsx scripts/video/probe-audio-production-cancellation.ts --audio-cancellation --journal`：退出0，见 [真实模型音乐/拟音兼容记录](audio-production-journal-probe.json)。固定断网 Docker 三轨 SHA 与旧归档相同；两个 completed 回执在 cold Store 实际 WAV 复核后保持字节一致。隔离 cancelProduction 后不返回 stems；本次曾观察 running 容器，259ms 后拒绝返回并确证其移除。记录严格不声称“在输出制作完成之前中断”，观察 running/随后 absent 本身不够；后续实际只读检查也发现该次 sound 的 output/state.json 已存在，journal 为 stopped。原项目 control/budget 未变，0网络/提供方调用，resultPublished=false；原普通取消探针文件未覆盖。

完整100文件520项单元测试通过，最终46.89秒；journal文件15项及相关26项通过，lint与构建后typecheck退出0。首次 build 因新测试采用 Promise.withResolvers 超出 ES2022 lib 退出1，改为标准 Promise 初始化，保留 tsconfig；随后 build 退出0。本轮无UI修改，未重跑浏览器套件。

限制：journal 只接 sound/master，目前没有覆盖图像、TTS、ASR、合成、导出全部生产链；资源全量协调、started 证明的自动恢复与公共未知标记解除仍待实现。没有依据局部 journal 成功清除 unresolvedMediaStops。正式新主题有旁白影片、完整视听/许可 QA、修改准入/new revision/发布、最终 loudnorm 意图测量、全部43风格86真实基线与最终验收继续未完成；历史模型 unknown 账目不重试、不退款。未 push/生产部署。
