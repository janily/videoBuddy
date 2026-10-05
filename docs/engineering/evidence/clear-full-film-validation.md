# T10/T11 清晰字幕 1080p 技术全片

2026-10-05。implemented/tested，未部署。技术探针不创建正式制作批准、不发布最终结果，不代表全片质量通过或项目完整交付。

## 实片与证据

[真实执行记录](clear-full-film-technical-probe.json) 固定原已发布预览的 FilmSpec、素材、声音与字幕包，在原素材根目录的独占 composition/clear-full-TMnPO7 中实际重新渲染四个 1920×1080 镜头、组合、混音和编码。实际 MP4 10608051 bytes，SHA `cb5ac8454a867abb361fbe13fafd9fd07e09335c76685a672e94cc931bc6d0fd`；20秒、480帧、24fps、1920×1080、立体声AAC，完整解码、metadata/faststart、−13.49 LUFS、−2.23 dBTP 通过。精确 mustExist 冷读 composition/postmix 一致，原项目 control、budget、成功预览及旧失败 operation 未改。正式 approval=false，resultPublished=false，deliveryEligible=false。

四句最终混音提取采用 stereo_average，结果 pass/trusted_policy/pass/pass；四段实际 WAV SHA 与先前已核验的清晰字幕720p混音完全相同。ASR复用这些准确SHA对应的已有原始缓存，不声称重新运行ASR，也不再次询问同源读音试听。本次9条 owned native invocation 全部 completed，另有四个实际 detached 镜头句柄与31批抽帧记录，不能混算成八条新ASR回执。未调用模型、未新生成TTS或配乐。

两轮全片抽帧为112/132帧，共244张真实PNG、31批；覆盖镜头内0.2秒采样及字幕边缘/稳定阅读起点。独立 [文件与清理审计](clear-full-film-media-audit.json) 核对每张文件 SHA/bytes/PNG签名/1920×1080尺寸、轮次帧序、实际影片和runtime绑定，并独立复核MP4 SHA、四段波形、九条completed。四个本次 owned exited 容器逐一核对精确ID、image、stageKey、exited/exitCode=0 后无force删除，最终docker列表确认不存在；输出保留。未清理其他任务容器，不代表T14全局资源协调完成。

## 失败测试与复核

固定初版探针快照 `1991aa5ac7e835322bffd5adda3ed080c9f436fb` 双轴复核发现 P2：submit成功后的报告写盘位于取消保护之外；报告失败可能遗留运行任务。新 observeProbePicture 将写盘、观察和完成后的源身份检查放入同一 owned handle 保护：任何异常只取消准确句柄，停止无法确认则保留 MEDIA_STOP_UNKNOWN。三个协议测试实际RED→GREEN：报告失败不inspect且取消自身；取消throw/cancelling保留unknown；完成后来源变化拒绝并取消。最终行为快照 `ecf1db6cb6a7c1e601a8634e0502dfde12ca1968` / tree `ee8bfbbb44a91cdbb9dc63547ce9067c71c89625` 双轴clean。随后仅将不可变deadline从let改const以修复lint，行为不变。

真实渲染进程在上述修复前已经加载初版代码，本次所有报告写盘都成功；实片成功证据与新异常分支的测试证据分开记录，不声称实片运行过新异常保护。未为重复证明而重新执行渲染或付费调用。

最终120文件616项测试通过，52.96s；生产build通过。首次lint因deadline的prefer-const失败，修复后lint及构建后typecheck退出0。

## 仍待完成

244张帧尚未送独立全片Critic；事实流程语义与精确文字核验需独立建模，旧literal guard保留，不把not_checked改成pass。连续运动、完整听感、字幕停留、字体/许可与完整QA尚缺；公共正式确认/修改闭环、全模态长资料、43风格86横竖及公开profile、22FR/92AT/16Agent/5用户验收、自托管恢复运维仍未完成。C0/C1/C2未达。无push或生产部署。
