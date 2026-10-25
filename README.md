# Audio Recorder

Audio Recorder 是一个 Chrome Manifest V3 本地录音扩展。它在用户主动点击录音按钮后请求麦克风权限，在本地生成 WebM 录音和 MP3 文件，并通过浏览器下载到本机。

## 功能说明

- 用户点击扩展图标后打开录音页面。
- 用户主动点击录音按钮后开始采集麦克风音频。
- 支持停止后预览 WebM 录音。
- 支持下载 WebM。
- 支持使用 `@breezystack/lamejs` 在本地编码并下载 MP3。
- 支持比特率选择、文件命名规则、时间码复制和自动下载 MP3 开关。
- 支持打开 `links.txt` 或文本框中保存的云端链接。
- 右上角设置可导入 Google OAuth JSON、连接 Drive、选择格式/文件夹，并开启录音停止后自动上传（默认关闭）。

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

当前 `manifest.json` 声明：

- `downloads`: 用于 `AudioRecorder.js` 中的 `chrome.downloads.showDefaultFolder()`，在下载完成后由用户确认是否打开默认下载文件夹。
- `identity`：插件中用于 Google Drive 授权。

未声明固定的 `host_permissions`。可选访问范围仅为 `https://www.googleapis.com/*`，在插件用户点击“连接 Google Drive”时申请。

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

- Google Drive 上传需用户主动连接并手动上传或开启自动上传。代码不包含 OAuth Client Secret。
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
- `index.html` 直接显示录音界面，访问网站时地址保持为 `/AudioRecorder/`，不再跳转到 `AudioRecorder.html`；`.nojekyll` 用于按原样发布静态文件。
- `AudioRecorder.html` 继续作为插件页面和旧网址入口。两个 HTML 文件共用 `AudioRecorder.js`、MP3 编码库及其他相对路径资源；今后修改页面结构或内嵌样式时，应同步更新两个 HTML 文件。
- 在仓库 Settings → Pages 中选择 Deploy from a branch，发布来源为 `main` 分支的 `/ (root)`。
- 使用网站时，点击录音按钮并允许麦克风访问。录音、预览和 WebM / MP3 导出均在浏览器本地完成。
- “打开录音文件夹”和扩展窗口控制等 Chrome 扩展专用操作在普通网页中不可用；这些操作已有能力检测，不影响网页录音入口。
- 此次公开与网站部署沿用源码版本 1.23，不递增插件版本号、不生成源码 ZIP。

## Google Drive 上传（未发版功能）

网页设置：启用 Google Cloud 项目的 Drive API，配置同意屏幕及 `drive.file` 范围；测试模式下添加测试用户。创建 **Web 应用** OAuth 客户端，在“已获授权的 JavaScript 来源”加入 `https://alangrove.github.io`（不带路径）。

点击右上角设置 → 导入 Google 配置 JSON（或填写客户端 ID）→ 连接 Google Drive。首次加载 Google 授权组件后，按提示再次点击连接。完成 Google 授权后选择 MP3 / WebM、文件夹名称，并开启自动上传。也可点击“上传当前录音”。

导入文件仅在本机解析，只保存公开的客户端 ID，不保存或上传完整 JSON 及其余字段。服务账号、桌面客户端 JSON 不适用于网页版。不要将 Google 配置文件提交到公开仓库。

Chrome 插件使用官方 `chrome.identity.getAuthToken`，不会加载远程授权脚本。必须在 Google Cloud 创建绑定实际插件 ID 的 **Chrome 扩展** OAuth 客户端，在 `manifest.json` 添加 `oauth2` 字段后重新加载插件：

```json
"oauth2": {
  "client_id": "YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive.file"]
}
```

真实 ID 未配置前，插件录音和本地下载仍可使用；连接 Drive 会提示完成配置。浏览器不能通过导入文件修改已加载插件的清单，插件导入入口仅校验已配置的 ID。不需要在本项目中填写 API Key、客户端密钥或服务账号私钥。

上传使用 `drive.file`，仅访问本应用创建/标记的文件夹，不申请整个云盘权限。自动创建的文件夹即使与其他文件夹同名，也不会读取或复用其他文件夹。

采用可恢复上传和 8 MiB 分块，以固定云端文件 ID 进行同一录音/格式的重试，避免完成响应丢失导致重复创建。网络、配额或授权错误会显示状态并保留待传音频，重新连接后可点击“重试待上传”。上传与本地自动下载相互独立。

待传音频、上传会话和 OAuth 授权仅保存在页面内存中，刷新/关闭页面会丢失队列，关闭前请完成上传或下载备份。网页授权过期后需主动重新连接，不支持长期无人值守的授权续期。设置按浏览器来源分别保存在本机，不跨设备同步。

断开连接会清除本页授权并关闭自动上传，不删除云端录音；若需撤销 Google 账号上的应用授权，请在 Google 账号第三方应用权限中操作。

验证方法：运行 `node scripts/test-google-drive.cjs`（模拟测试，不访问真实云盘）及 `scripts/validate-release.ps1 -ExpectedVersion 1.23`。配置真实 OAuth 后，测试手动上传、自动上传开关、错误重试、本地下载，并核对云盘文件名、大小和播放。

