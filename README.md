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

## 开发

`main.cjs`、`desktop.*` 和 `widget-voice-bank.js` 是桌宠界面与播放逻辑；`agent-service.cjs` 处理文字对话；`tts/` 保留运行时语音接口和固定语音库构建所需代码。运行 `npm test` 检查基础交互；GitHub Actions 会在推送时运行源码检查。

桌宠集成基于上游 `panxuc/live2d-widget-mygo` v0.2.4，代码许可见 [上游 MIT 许可](third_party/UPSTREAM_LICENSE)。上游说明 Live2D 角色资源来自游戏数据，不能把代码许可视为角色素材的再分发授权。本项目是非官方粉丝作品；本机语音素材和模型不公开分发。
