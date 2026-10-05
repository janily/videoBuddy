# T11 独立内容评审合同与真实冻结输入

2026-10-05。implemented/tested；未部署。仅新增内容QA基础和真实输入准备，未生产接线或模型质量通过，不是全片验收或完整项目交付。

## 合同与独立 Critic

ContentReviewContext绑定影片/FilmSpec SHA、完整原FactsManifest SHA及全部FactSchema字段、帧号/PNG SHA/bytes、48kHz最终混音时窗、实际原ASR文字/波形SHA/既有验证状态。完整事实不可静默删除，时窗越界、帧重复/乱序、重复fact/line、无法被review引用的超长id拒绝。原始ASR空白保留，不把预定台词或同源授权改写成识别原文。

可信调用方的requirements包含每个fact的literal/semantic表达方式及exactText原文锚点，完整绑定context SHA。模型不能更换/删除要求；每fact必须精确输出全部literalChecks，无重复/外来sourceExcerpt，fail/not_checked也保留逐字项。所有pass引用逐字对应实际观察或转写，纯标点锚点拒绝，不能用一个正确引用遮盖同项其它错字引用。没有可信分类的旧事实默认整段来源原文literal，不自动降为semantic。

独立Content Critic通过native Mastra接真实PNG，拷贝并SHA校验图片，核上下文digest/数量/大小/token配置后才进入已预约模型账本；发送前两次fence，usage保存后再验fence。仅输出provided_frames_and_verified_transcripts：以实际观察描述和原始转写评意义，逐字身份/名称/日期/数字由固定要求核对。全部facts必须完整判定，partial/none或conflicting不能pass，矛盾与pass不能共存；未提供的连续运动/声音/全片禁止项不可冒充通过。合同校验引用与覆盖声明，不声称程序能从任意description判断真实图义；实际语义仍需独立模型及生产阶段验证。

旧VisualReview v1、历史事实/字形失败、正式delivery gate、公开UI均不改。新评审尚未替代或解除任何正式交付阻断。

## RED→GREEN与程序验证

四初始行为测试实际RED：context丢事实/篡改转写、缺观察或fact、计划台词当转写、错名/partial/conflict/伪听感；实现后GREEN。loopback native Mastra传输先CONTENT_CRITIC_NOT_IMPLEMENTED失败，再核actualPNG base64/完整facts/原ASR文字/1请求及本地123 input/67 output准确settled；这是假provider协议测试，不是云语义QA。第二fence故障测试：初始throwing transport故障回放超时；改有效本地响应，去掉发送前第二fence后真实观察2次本地fetch、违反0请求，恢复后0请求且started保持unknown。没有外部模型请求。

额外纯标点/混引字形测试先RED，修标点后仍混引RED，再完整修复GREEN。raw ASR空白首RED，去掉trim后保留；121字符fact fixture去掉无关requirements，临时删真实cap时expect throw RED，恢复后GREEN。

Spec复核发现P2：模型可删除literalChecks，把青禾观察为清和仍pass。真实纯合同反例与新增测试RED；固定可信requirements、完整覆盖及保守默认后GREEN。缺required fact、非来源锚点、篡改criteria SHA均拒。固定生产快照ee33face3f3c8bfda550f88a1a196081cd8ca092（base26b7695）双轴clean；最终仅加强id边界测试的cf3d5ab3f3ea9dfacfa7713ecc8e43fc09c267d3生产代码同字节，合同8项及transport2项通过。124文件630项54.14s全通过，lint/build/构建后typecheck退出0；最终隔离id测试fixture后再跑124文件630项，52.02s全部通过。

## 真实输入与失败保留

[首个真实输入](clear-content-context-probe.json) 在固定literal requirements修正前生成，原不可变诊断保留，不伪造后来已带新条件或生产可用。新 [v2真实输入](clear-content-context-v2-probe.json) 绑定前证据SHA，在原1080p技术片SHA cb5ac845…上读取9/129/249/369四实际稳定阅读起点PNG。readPublishedPreview/loadVerifiedFilmPackage实读原frozen包，完整事实清单SHA60f3ad985…569bytes，无删减，当前1条流程事实。

原voice plan/verified及同源policy冷核，再以mustExist/stereo_average/原精确postmix journal对该实际最终混音重核；原四句pass/trusted_policy/pass/pass，四WAV SHA相同。转写保持原文：第2句仍为“撒下…”、第4句保留传统字形，不将来源文本覆盖ASR。新context ref SHA dd509ab56a25884614384ee81c3e3d3e88ab0f658426c57837bf7fdf4141f3b8 / 2500bytes，独立FileStore+完整ref冷读一致。当前旧facts缺可信语义分类，因此requirements明确默认全来源literal；这是输入准备，不是对跨镜头流程已有语义通过。

0网络/0model/0新增native，原9条native记录及control/budget/两operation不变，approval/result/delivery=false。[独立v2审计](clear-content-context-v2-audit.json) 另核不可变context SHA/bytes、无contextSha字段的精确hash、原facts manifest全文及SHA、4个实际PNG文件SHA/bytes/signature/帧号、四原ASR文字/status/waveSHA完全相同，并核上次timeout的project/daily/gate完整未改。首次审计误加不存在output子目录导致FileNotFound，修诊断路径后核真实文件通过；没有重新提取或调用模型。

本轮未运行新云Content Critic，前31批视觉首180秒超时、无raw/usage的unknown继续保留，没有退款、重试或新账本绕过。

## 下一步与完整范围

需要生产端从可信来源分析生成并冻结完整requirements、接持久content stage与正式QA，同时保留旧字形/事实失败及source/owner/epoch/approval/fence。不能仅凭调用方任意semantic选择解除硬项。现有流程段落的生产语义证明尚未完成，公开正式确认与全片QA仍阻断。连续运动/听感/字体许可/字幕停留、修改/取消资源协调、全模态长资料、43风格86横竖及所有公开profile、22FR/92AT/16Agent/5用户验收和自托管恢复运维仍待完成。C0/C1/C2未达，无push或生产部署。
