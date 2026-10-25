# Audio Recorder

Audio Recorder 是一个 Chrome Manifest V3 本地录音扩展。它在用户主动点击录音按钮后请求麦克风权限，在本地生成 WebM 录音和 MP3 文件，并通过浏览器下载到本机。

## 功能说明

- 用户点击扩展图标后打开录音页面。
- 用户主动点击录音按钮后开始采集麦克风音频。
- 支持停止后预览 WebM 录音。
- 支持下载 WebM。
- 支持使用 `@breezystack/lamejs` 在本地编码并下载 MP3。
- 支持比特率选择、文件命名规则、时间码复制和自动下载 MP3 开关。
- 支持打开 `links.txt` 或文本框中保存的云端链接；当前代码不会上传录音。

## 项目结构

```text
.
├── .github/workflows/release.yml
├── icons/
├── scripts/validate-release.ps1
├── shared/
├── AudioRecorder.html
├── AudioRecorder.js
├── AudioRecorderWorklet.js
├── background.js
├── lamejs.iife.js
├── LICENSE-lamejs.iife.js.txt
├── manifest.json
├── PRIVACY.md
├── CHANGELOG.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

## 入口文件

- `manifest.json`: Chrome 扩展清单，Manifest V3。
- `background.js`: 扩展图标点击后打开 `AudioRecorder.html`。
- `AudioRecorder.html`: 录音页面 UI。
- `AudioRecorder.js`: 录音、计时、文件命名、下载和本地设置逻辑。
- `AudioRecorderWorklet.js`: AudioWorklet 音频采样处理。
- `lamejs.iife.js`: 第三方 MP3 编码库。

## 权限说明

当前 `manifest.json` 只声明：

- `downloads`: 用于 `AudioRecorder.js` 中的 `chrome.downloads.showDefaultFolder()`，在下载完成后由用户确认是否打开默认下载文件夹。

未声明 `host_permissions`。扩展不需要跨站读取页面内容，不需要任意网站访问权限。

麦克风访问由 `navigator.mediaDevices.getUserMedia({ audio: true })` 在用户点击录音按钮后触发，浏览器会显示权限提示。

## 构建方式

当前项目不需要 npm、Webpack、Vite 或其他构建步骤。源码即扩展运行文件。

本地检查：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/validate-release.ps1 -ExpectedVersion 1.23
```

加载到 Chrome：

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库根目录。

## Release

Release 由 GitHub Actions 在推送 `v*` 标签时自动生成。

```powershell
git tag v1.23
git push origin v1.23
```

工作流会检查 `manifest.json` 的 `version` 是否等于标签去掉 `v` 后的值，生成 ZIP，并创建 GitHub Release 与 build provenance attestation。

## 测试方法

- 运行 `scripts/validate-release.ps1`。
- 在 Chrome 中加载未打包扩展。
- 点击扩展图标，确认打开录音页面。
- 点击录音按钮，确认浏览器请求麦克风权限。
- 停止录音后确认可播放预览。
- 点击下载 WebM 和下载 MP3，确认文件能保存。
- 确认自动下载 MP3 开关行为符合预期。

## 注意事项

- 当前代码没有 Google Drive API 上传逻辑，也没有 OAuth Client Secret。
- `links.txt` 仅用于保存用户可手动打开的链接。
- 不要把真实录音、个人链接、令牌、私钥或 `.env` 文件提交到仓库。
- `lamejs.iife.js` 是第三方压缩 IIFE 文件，来源和许可证见 `THIRD_PARTY_NOTICES.md`。

## 仓库迁移记录（未发版）

- 个人维护仓库：`AlanGrove/AudioRecorder`，迁移完成时保持私有状态。
- 本次同步源码来自 `secure-artifacts/AudioRecorder` 的 `b157876359f7c14afecd93dd9ea3c178fd7db96b` 提交，即已回退界面改动的 1.23 源码。
- 以新增提交延续个人仓库原有的 1.21 提交历史；保留旧文件 `AudioRecorder 1.21` 和 `lame.min.js`，当前扩展入口仍为 `manifest.json` 和 `AudioRecorder.html`。
- 此次仅同步源码，沿用源仓库的 1.23 版本号，未递增版本号、未生成 ZIP，也未发布 GitHub Pages。

## GitHub Pages 网站

- 源码仓库：<https://github.com/AlanGrove/AudioRecorder>。
- 网站地址：<https://alangrove.github.io/AudioRecorder/>。
- `index.html` 将网站首页自动跳转到 `AudioRecorder.html`；`.nojekyll` 用于按原样发布静态文件。
- 在仓库 Settings → Pages 中选择 Deploy from a branch，发布来源为 `main` 分支的 `/ (root)`。
- 使用网站时，点击录音按钮并允许麦克风访问。录音、预览和 WebM / MP3 导出均在浏览器本地完成。
- “打开录音文件夹”和扩展窗口控制等 Chrome 扩展专用操作在普通网页中不可用；这些操作已有能力检测，不影响网页录音入口。
- 此次公开与网站部署沿用源码版本 1.23，不递增插件版本号、不生成源码 ZIP。

