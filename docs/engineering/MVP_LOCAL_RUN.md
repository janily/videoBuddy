# 本机 MVP 启动与验收

首份真实正式影片已通过正常页面批准并发布，可从本机项目页面播放；浏览器下载和修改后新版本尚未验收完成，见 [实际验收记录](MVP_DELIVERY.md)。范围按 [MVP_FIRST](MVP_FIRST.md)，完整43风格留在后续任务中。

## 当前机器

本机已准备私有 `.env.mvp.local`、锁定的媒体/配音/ASR镜像与持久存储。无需Blob/Sandbox账号。密钥仅在服务端读取，不要把环境文件加入Git。Node版本为 `.nvmrc` 中的22.23.1。

在两个终端启动：

```sh
nvm use
npm run dev:mvp
```

```sh
nvm use
npm run worker:mvp
```

打开 http://localhost:3000/video。关闭旧的web/worker进程再启动，单个存储目录只能有一个Worker。不要清空数据目录来恢复任务。

Web脚本在进程内读取 `.env.mvp.local`，避免将 `--env-file` 传进Next子进程的 `NODE_OPTIONS`。普通 `npm run dev` 使用Next自己的 `.env.local` 配置，Worker不会自动读取该文件。

当前私有数据根是 `.video-local/clear-full-critic-UGy32l`，保留原有未知费用与所有本次实际操作。仅供本机研发；长期使用应将 `VIDEO_DATA_DIR` 放在源码之外的持久磁盘，并保持匿名签名密钥稳定。更换密钥/环境会影响现有匿名项目访问。备份时同时保留私有环境与数据，密钥不进入工程导出。

## 配置新机器

复制 `.env.local.example` 为 `.env.mvp.local`，填写绝对数据路径、至少32字符的随机 `VIDEO_SESSION_SIGNING_KEY`，保持 `VIDEO_APP_ORIGIN=http://localhost:3000`；配置真实模型、四个Agent角色与锁定镜像：

- `VIDEO_DELIVERY_PROFILE=mvp`、`VIDEO_GENERATION_ENABLED=true`。
- `MODEL_PROVIDER=openai-compatible`、`MODEL_BASE_URL=https://grsaiapi.com/v1`；`MODEL_API_KEY` 为自己的私有Key。
- Director/Visual/Audio/Critic使用已验证的 `gemini-3.8-flash`。
- 媒体、配音、ASR各自的不可变镜像ID与64位runtime digest必须一致，不能使用latest标签。构建方式见runtime对应README。
- 本机费用策略使用用户已授权的无限验证模式；新的部署应明确设置费用预算。不要靠重建空账本绕过unknown，恢复方法与历史证据保留。

Markdown为已有文字资料路径；PDF需另启 `worker:sources` 并明确加载同一配置。MVP首片不依赖扫描PDF、图片OCR、音频理解或其他全模态能力。

## 实际闭环

输入20–30秒、16:9、中文配音字幕的crayon-book主题，点击“先看效果”。实际片段准备好后点击“就按这个做”，等待正式结果；播放并下载MP4。通过聊天修改内容后重新预览及确认，旧片从已有视频或“我的视频”继续访问。

刷新和网络重连不会撤销制作；批准重连复用同一commandId。Worker停止后完成当前操作才退出；重启从持久任务恢复。媒体或模型状态未知会保留原记录并显示具体阻断，不假装完成。
