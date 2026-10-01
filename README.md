# MyGO DesktopPet

Windows 桌面上的 MyGO!!!!! 五人 Live2D 桌宠。可切换角色、点击查看固定台词，并用 DeepSeek 聊天。接入本机私人语音库后，固定台词可即时播放；自由对话会等日语语音准备好，再同步显示中文回复。

## 下载与启动

需要 Windows、Git、Node.js（含 npm）和 Python 3。在仓库目录运行：

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-upstream.ps1
.\start-source-only.cmd
```

首次启动后，在桌宠设置中填写自己的 DeepSeek API Key，即可使用文字聊天。点击模型切换固定台词；声音、聊天面板和桌面感知可在界面中开启或关闭。关闭窗口会把桌宠收进托盘。

安装脚本会在本机获取并构建固定版本的 [live2d-widget-mygo](https://github.com/panxuc/live2d-widget-mygo)；仓库本身不包含 Live2D 模型或预构建资源。再次运行安装脚本会检查上游版本并补齐缺失资源，不覆盖已有的本机文件。

## 本机语音

本仓库不提供角色原声、训练后的权重或生成的语音文件。单独下载仓库可以使用 Live2D 和文字聊天，不能直接听到角色声音。已经自行在本机配置好 CosyVoice 服务、五人私有模型和完整固定语音库的用户，可运行 `start-desktop.cmd` 启动语音版；启动器会检查模型版本和固定语音库是否匹配。语音开关只在本机语音已就绪时开启。

API Key、聊天记录、音频、模型和运行缓存都保存在本机，不随仓库提供。自由对话只向配置的 DeepSeek 接口发送文字；原声和模型不发送给该接口。

## 在无 NVIDIA 显卡的 Windows 笔记本离线运行语音

已拥有私人语音资产的用户，可以把固定语音库和已训练模型从自己的原电脑迁移到自己的笔记本。两台电脑在使用时无需联网或保持连接；首次安装需要网络下载 Python、Node.js 和依赖。笔记本推荐至少 24 GB 内存及约 12 GB 空余磁盘。固定台词读取预生成 WAV，点击时不运行模型；自由对话在笔记本 CPU 上合成，首次生成可能等待较久，实际速度取决于机器，应自行试听验证。

在原电脑的项目目录运行以下命令，把 `<U盘路径>` 改成 U 盘上的一个新目录：

```powershell
py -3.10 .\scripts\private_voice_transfer.py export "<U盘路径>\MyGO-private-voices"
```

在笔记本上把本仓库克隆到较短的路径（例如 `C:\MyGO\Mygo-DesktopPet`，避免 Windows 默认路径长度限制），安装 Python 3.10（64 位）、Node.js 和 Git，然后在仓库目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-cpu-voice.ps1 -PrivatePack "<U盘路径>\MyGO-private-voices"
.\start-cpu-voice.cmd
```

安装会真实生成并识别一条测试语音；未通过时会停止并给出本地诊断报告。这个检查验证启动与测试句的可理解性，不代表所有自由对话的音色、韵律和长文本质量均已合格。

桌宠运行时可在另一 PowerShell 窗口执行以下命令，对照固定语音与新生成语音。生成的 WAV 和报告仅保存在本机 `experiments/voice-diagnostics/`，不会上传到 GitHub：

```powershell
.\runtime\cosy-venv310\Scripts\python.exe .\scripts\diagnose-voice-quality.py --character anon
```

如果测试 WAV 本身听不清，查看 `experiments/voice-diagnostics/latest.json` 的 `asr.transcript`、`kana_error` 和 `x-content-check`，并检查 `experiments/cosy-service.stderr.log`。如果 WAV 清楚但桌宠内听不清，应检查 Windows 音频增强、播放设备和桌宠播放链路。同一模型权重可用于 CPU 和 NVIDIA GPU；CPU 采用 FP32 推理，主要差别是生成速度。

迁移目录约 6 GiB，供推理使用，包含私人模型权重、选用的少量参考录音、完整固定语音库及本地语音内容校验模型，不附带完整训练集。参考录音的数量不是模型训练样本数；缺少训练集不妨碍加载已训练权重，但迁移包本身也不能用于重新核验完整训练过程。请只在自己的设备间私下转移，不上传 GitHub 或网盘公开分享。虚拟环境不复制；安装脚本会在笔记本重新建立官方 PyTorch CPU 环境，并校验每个转移文件。若启动失败，可查看 `experiments/cosy-service.stderr.log`。自由聊天仍需自行配置 DeepSeek API Key 和访问其文本接口；离线运行的是语音推理。

## 开发

`main.cjs`、`desktop.*` 和 `widget-voice-bank.js` 是桌宠界面与播放逻辑；`agent-service.cjs` 处理文字对话；`tts/` 保留运行时语音接口和固定语音库构建所需代码。运行 `npm test` 检查基础交互；GitHub Actions 会在推送时运行源码检查。

桌宠集成基于上游 `panxuc/live2d-widget-mygo` v0.2.4，代码许可见 [上游 MIT 许可](third_party/UPSTREAM_LICENSE)。上游说明 Live2D 角色资源来自游戏数据，不能把代码许可视为角色素材的再分发授权。本项目是非官方粉丝作品；本机语音素材和模型不公开分发。
