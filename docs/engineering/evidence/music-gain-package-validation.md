# T13 音乐增益归档与真实基线读取

固定代码基线：`0b8566499dd13d0800b3712749c09b78a86bb086`。本增量 implemented/tested；deployed=false。C0/C1/C2 均未达到，不是项目完整交付。

旧 schemaVersion=2 保持原任务文档、哈希和默认额外增益 0。显式增益使用 schemaVersion=3，master.musicGainDb 为必填，读取时重算实际混音任务、stageKey、生产回执并验证四条 WAV。只改增益或重签包/回执不能代替实际执行。新基线读取器只证明来源，不提供 owner 授权或修改操作准入。

相对模式基于核验后的实际增益计算：0 加 −3 得 −3，再加 −3 得 −6；绝对模式和缺省旧模式保留设置值语义。超出 −6…0 返回 CHANGE_PREVIEW_REQUIRED，不静默截断。没有实际音乐时 MUSIC_NOT_PRESENT。

失败→通过：新增显式增益归档先报 AUDIO_EXECUTION_CHANGED，加入 v3 任务重建后通过；新 resolver 首轮为模块缺失失败，新增模块后通过，不能把该导入失败当成语义断言失败。随后补充重签任务/回执攻击拒绝测试。

实际命令与结果（Node 22.23.1）：

- `npm test`：94 文件、469 项通过，50.34 秒；云/模型测试开关关闭。
- `npm run lint`：退出 0，无警告。
- `npm run build`：退出 0。
- 构建后 `npm run typecheck`：退出 0。
- `git diff --check`：退出 0。
- `node --import tsx scripts/video/probe-music-gain-package.ts --gain-package`：退出 0，真实断网 Docker 探针通过；完整原始结果见 [music-gain-package-probe.json](music-gain-package-probe.json)。

实际探针从已有模型生成的 20 秒音乐/拟音与归档零旁白读取，只在独立目录重建工作路径。固定镜像重生成音乐、拟音及默认混音 SHA 均与原件一致；−3 dB 混音归档 v3，删除 audio/sound/audio-master 工作目录后冷读取一致，重签增益拒绝。原项目 control/budget 未改变，网络调用 0，新增模型调用 0，resultPublished=false。第二次下降只验证计算值 −6，没有宣称制作第二个成片。

Standards 轴独立审查 clean，3 文件 16 项通过。Spec 轴独立审查 clean，4 文件 21 项通过，并独立核对真实四条 WAV SHA 和 −3 dB 混音 PCM 最大误差 6.26e−9。审查均无提供方调用。

限制：尚未接入用户修改操作、新 revision 来源闭包、撤销、完整 QA 和新 result 发布。该实测没有旁白，不能证明旁白/字幕/ASR；也不是最终视频、听感或响度验收。最终合成仍做响度归一化，需验证它是否抵消用户的音乐下降意图，不能把原始 PCM 降幅当最终可听降幅。旧全片模型超时 unknown 门闩保留；无限费用授权有效，但不自动重试未知消费。43 风格 86 条真实基线等完整交付要求仍未完成。
