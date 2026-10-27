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

### 经典放大主页面（未发版调整）

- 采用已确认的“经典放大”布局：64 px 录音按钮与 46 px 等宽时间码并排，下载及打开链接改为高 34 px 的小圆角按钮。
- 顶部保留窗口切换与云端设置；波形下方放置自动下载和比特率。时间校正、时间码复制、命名规则、链接输入、预览及云端链接复制均保留。
- 窄屏会适当缩小时间码；窗口切换尺寸同步适配新布局，避免放大后的主要控件被裁切。
- 页面样式集中在 `recorder.css`；两个 HTML 入口保持一致。此项仅调整界面，沿用 1.23，不递增版本号、不生成 ZIP。

### 网站入口与部署

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

当前发布网页已配置保持连接服务，点击右上角设置 → 连接 Google Drive → 完成首次 Google 授权即可，不需要再导入 JSON。选择 MP3 / WebM、文件夹名称，并开启自动上传。也可点击“上传当前录音”。自行部署且未配置后端时，仍可导入 Google 配置 JSON（或填写客户端 ID）使用临时授权；首次加载 Google 授权组件后需按提示再次点击连接。

设置面板优先显示“导入配置 → 连接云盘 → 自动上传”。配置完成后，首次导入步骤会自动隐藏；格式、文件夹、手动客户端 ID、更换配置和断开连接放在默认折叠的“更多设置”中。

上传成功后，设置和录音主页面都会显示最近上传的文件名与链接。点击链接卡片即可复制，并显示“链接已复制”；需要查看文件时，可在设置中点击单独的“打开文件”。复制受限时会显示可选中的文本供手动复制。复制不会改变 Google Drive 文件的访问权限，也不会公开文件。最近上传链接保留在当前页面中，刷新后需再次上传或到 Drive 中查找。

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

待传音频和上传会话仅保存在页面内存中，刷新/关闭页面会丢失队列，关闭前请完成上传或下载备份。浏览器只在内存中使用短期访问凭据。未配置后端时，网页版仍为临时授权；配置下述保持连接服务后，可自动恢复并续期。设置按浏览器来源分别保存在本机，不跨设备同步。

录音主页面标题“音频录制器 1.23”同一行右侧显示 Google Drive 图标：连接后为彩色，断开时为灰色并划斜杠；点击图标打开云端设置。主页不显示头像和用户名。设置中保留头像、用户名和邮箱；头像不可用时显示姓名首字。Chrome 插件在已授权、已配置客户端的情况下，下次打开通过 Chrome 缓存静默恢复，不会自动申请新权限。

断开连接会清除本页授权、关闭自动上传，并删除保持连接服务中此浏览器的会话，不删除云端录音。网络中断导致服务端退出未完成时，下次打开会先重试退出，不会自动恢复授权。若需撤销所有浏览器的 Google 应用授权，请在 Google 账号第三方应用权限中操作。

### Cloudflare Worker 保持连接（未发版调整）

源码在 `backend/worker.mjs`，配置在 `backend/wrangler.toml`。只处理 OAuth，音频仍直接上传 Google。采用 SQLite Durable Objects 保存每个浏览器的会话；访问/刷新凭据另用 AES-GCM 加密，密钥作为 Worker Secret。会话有效期为 30 天，Google 撤销授权、测试模式刷新令牌约 7 天到期、浏览器清理 Cookie 等情况仍需重连，不能保证永久登录。

部署步骤：

1. 在 Cloudflare 账户中使用 Wrangler 官方工具登录并部署。当前 Wrangler 部署接口使用 `workers_scripts:write` 权限；可运行 `npx wrangler login --device --scopes account:read user:read workers_scripts:write`，按官方页面完成设备授权。保持 `APP_ORIGIN = "https://alangrove.github.io"`，不要使用通配来源。
2. 在 `backend` 目录运行 `npx wrangler deploy`，记下得到的 HTTPS Worker 根地址。SQLite Durable Objects 绑定和迁移已写入配置，无需手动建立数据库。
3. Google Cloud 的 **Web 应用** OAuth 客户端添加“已获授权的重定向 URI”：`https://实际服务.workers.dev/oauth/callback`。这与已有的 JavaScript 来源不同，不能遗漏。
4. 把公开的客户端 ID 写入 Worker 的 `GOOGLE_CLIENT_ID` 变量；通过 Cloudflare 控制台的 **Secret** 或 `npx wrangler secret put GOOGLE_CLIENT_SECRET` 输入对应 Client Secret。不要上传完整 OAuth JSON 或把 Secret 写进仓库。
5. 生成随机 32 字节 base64url 值（例如 `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"`），用 Secret `TOKEN_ENCRYPTION_KEY` 保存。不要在生产环境随意更换此密钥；更换会导致已有会话需要重新授权。
6. 将 Worker 根地址填入 `drive-backend-config.js` 中的公开配置并部署 GitHub Pages；也可在设置 → 更多设置 → 保持连接服务地址中填写，测试自己的服务。
7. 打开网页，连接 Google 一次并允许所需范围，开启自动上传。刷新、关闭再打开、等待短期凭据到期后再次录音，都应自动恢复/续期。配置文件不需要再次导入。Google 授权时需要允许离线访问，因此第一次接入此后端需重新连接一次。

浏览器需支持 `Secure; HttpOnly; SameSite=None; Partitioned` Cookie（建议新版 Chrome）；浏览器完全禁止此 Cookie 时会明确提示，不能用前端存储刷新凭据来绕过。Google 账号应在项目允许的测试用户中，或正确配置 OAuth 发布状态。后端允许的来源必须与实际站点来源一致，根路径不属于 Origin。后端不可用、授权撤销或空间不足时会保留本页待传录音并提示重试；刷新会丢失音频队列。

验证命令：`node --test scripts/test-google-drive.cjs scripts/test-drive-backend.mjs`。覆盖连接恢复、头像用户名、静默授权、上传队列、断开失败重试、OAuth state/PKCE、凭据加密、自动续期、撤销、并发刷新及会话到期。真实 Google OAuth 和 Cloudflare Cookie 恢复仍需在已配置的部署环境完成一次端到端验证。本次没有递增 1.23 版本号，没有打包 ZIP。

部署配置（2026-10-26，未发版）：授权服务已部署到 `https://audio-recorder-drive.audio-recorder-drive-backend.workers.dev`，Durable Objects、Client Secret 和加密密钥已通过 Cloudflare 绑定/Secret 配置。使用可管理项目 `audiorecorder-20260728` 中专用的 Web OAuth 客户端，已配置网页来源、后端回调，确认 Drive API 已启用。`drive-backend-config.js` 已设置公开服务地址，网页默认使用保持连接服务。首次使用须点击“连接 Google Drive”并完成 Google 授权；之后在 Cookie 会话有效且 Google 未撤销权限时自动恢复和续期，不再导入 JSON。

`node scripts/check-drive-deployment.mjs https://audio-recorder-drive.audio-recorder-drive-backend.workers.dev` 已验证线上 HTTPS、来源限制、分区 Cookie 设置、回调地址和空会话创建/清除，不会授权 Google 或上传音频。自动化测试与运行时检查通过不等于真实账号授权验证；更换部署或 OAuth 配置后，还应实际连接、刷新/重开页面，并短录音检查上传与复制链接。

首次授权等待窗口为 9 分钟，并提示在 Google 窗口完成授权。后端在交换凭据和读取资料期间保持“处理中”，完成后才报告成功或失败，避免网页提前关闭授权窗口；交错回调不会用旧账号覆盖新连接。

部署检查还通过受来源限制的 `/auth/health` 验证服务端加密/解密往返，只返回健康状态。授权失败时显示失败步骤，便于排查凭据交换、资料读取或会话保存；不会显示或记录授权码、访问/刷新凭据或 Client Secret。

Cloudflare 出站请求使用 `redirect: "manual"` 并拒绝意外 3xx，不使用该运行时不支持的 `redirect: "error"`。`backend` 安装开发依赖后可运行 `npm run test:runtime`，在实际 workerd 运行时中验证 OAuth 交换、加密保存、刷新续期及不跟随跳转；Google 响应由测试替身提供。

真实账号验证（2026-10-26）：已完成 Google 授权，网页设置与主页面均显示账号头像和用户名；刷新页面及重新打开根地址均自动恢复连接，自动上传开关保持开启。头像图片已实际加载。另有 38 项自动化测试、workerd 授权交换/续期运行时测试和线上服务加密/会话检查通过。未在验证过程中采集真实麦克风音频；实际录音上传、播放及云端链接复制可由用户短录音复核。

验证方法：运行 `node scripts/test-google-drive.cjs`（模拟测试，不访问真实云盘）及 `scripts/validate-release.ps1 -ExpectedVersion 1.23`。配置真实 OAuth 后，测试手动上传、自动上传开关、错误重试、本地下载，并核对云盘文件名、大小和播放。

