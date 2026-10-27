# Audio Recorder

Audio Recorder 是一个 Chrome Manifest V3 本地录音扩展。它在用户主动点击录音按钮后请求麦克风权限，在本地生成 WebM 录音和 MP3 文件，并通过浏览器下载到本机。

## 安全审核与加固（未发版）

完整报告见 [SECURITY_AUDIT.md](SECURITY_AUDIT.md)，包括依赖版本、问题位置、利用条件、修复与剩余风险。初次审核仅修改本地源码；经维护者确认继续，安全修复已同步网页与 Cloudflare Worker。2026-10-27 已完成本轮上线验收：授权恢复与退出检查通过，维护者自行完成录音上传并确认云端可播放。沿用 1.23，未生成 ZIP、未创建正式 Release，证据及验收边界见报告第 8 节；独立域名、限流与远端历史排查仍为后续事项。

- 授权后端在加密后通过事务复查会话版本，避免退出时被迟到的授权/刷新请求重新写回；Google 出站请求增加 15 秒超时。
- 发布流程把标签作为环境数据读取并严格校验数字版本；三个 Action 固定到完整提交 SHA，关闭 checkout 的凭据持久化。未来正式发布的 ZIP 统一放在 `outputs`，本次不触发发布。
- 两个页面增加 CSP，限制脚本、对象与表单，保留 Google 官方授权 SDK 和本地音频播放；HTTPS 授权后端仍可配置。
- 本地预览服务只开放明确的静态资源，校验 Host/Origin，拒绝配置文件及异常 URL，不再暴露整个项目目录。
- 增加依赖锁文件，声明原有 IndexedDB 测试所需的 `fake-indexeddb`；检查脚本覆盖 `.mjs/.cjs/.toml`、OAuth JSON 和 `.dev.vars`。`backend/.env.example` 只有两个密钥变量名，真实值仍通过 Worker Secret 配置。

从项目源码目录运行：

```powershell
cd backend
npm ci --ignore-scripts
npm test
npm run test:runtime
npm audit --package-lock-only
cd ..
pwsh -NoProfile -File scripts/validate-release.ps1 -ExpectedVersion 1.23
```

`npm ci --ignore-scripts` 避免安装时执行生命周期脚本；测试和构建会显式运行已锁定的官方开发工具。浏览器测试页为 `node scripts/preview-recording-library.cjs`，仅使用合成音频和模拟云盘，不应对外网开放。

录音库和授权边界以浏览器“来源”隔离，而不是网址路径。当前 GitHub Pages 同账号的其他项目共用来源，独立域名隔离按维护者选择留待后续；服务端 `/auth/start` 的边缘限流也需另行确定额度。当前本地缓存已被忽略不等于历史泄露凭据失效：如果确认密钥或部署令牌曾公开，应到对应平台撤销并重新生成，而不是只删除文件；不要随意更换 `TOKEN_ENCRYPTION_KEY`，否则旧会话无法解密。

## 功能说明

- 用户点击扩展图标后打开录音页面。
- 用户主动点击录音按钮后开始采集麦克风音频。
- 支持停止后预览 WebM 录音。
- 支持下载 WebM。
- 支持使用 `@breezystack/lamejs` 在本地编码并下载 MP3。
- 支持比特率选择、文件命名规则、时间码复制和自动下载 MP3 开关。
- “打开列表”查看本机浏览器保存的录音，可播放、下载、上传和清空；已上传文件显示可复制的分享链接。
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

每次录音完成后，MP3 和 WebM 会保存到当前浏览器的 IndexedDB 录音库。刷新或重开后，可在“打开列表”播放、下载或点击上传；不会自动批量上传旧录音。上传队列和可恢复会话 URL 仍只在内存中，文件 ID、所属账号标识和上传结果保存在本地，便于重开后核对，避免重复创建。浏览器只在内存中使用短期访问凭据。未配置后端时，网页版仍为临时授权；配置下述保持连接服务后，可自动恢复并续期。设置按浏览器来源分别保存在本机，不跨设备同步。

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

浏览器需支持 `Secure; HttpOnly; SameSite=None; Partitioned` Cookie（建议新版 Chrome）；浏览器完全禁止此 Cookie 时会明确提示，不能用前端存储刷新凭据来绕过。Google 账号应在项目允许的测试用户中，或正确配置 OAuth 发布状态。后端允许的来源必须与实际站点来源一致，根路径不属于 Origin。后端不可用、授权撤销或空间不足时会保留本页待传录音并提示重试；刷新后上传队列停止，已成功保存的录音可从列表再次点击上传。

验证命令：`node --test scripts/test-google-drive.cjs scripts/test-drive-backend.mjs`。覆盖连接恢复、头像用户名、静默授权、上传队列、断开失败重试、OAuth state/PKCE、凭据加密、自动续期、撤销、并发刷新及会话到期。真实 Google OAuth 和 Cloudflare Cookie 恢复仍需在已配置的部署环境完成一次端到端验证。本次没有递增 1.23 版本号，没有打包 ZIP。

部署配置（2026-10-26，未发版）：授权服务已部署到 `https://audio-recorder-drive.audio-recorder-drive-backend.workers.dev`，Durable Objects、Client Secret 和加密密钥已通过 Cloudflare 绑定/Secret 配置。使用可管理项目 `audiorecorder-20260728` 中专用的 Web OAuth 客户端，已配置网页来源、后端回调，确认 Drive API 已启用。`drive-backend-config.js` 已设置公开服务地址，网页默认使用保持连接服务。首次使用须点击“连接 Google Drive”并完成 Google 授权；之后在 Cookie 会话有效且 Google 未撤销权限时自动恢复和续期，不再导入 JSON。

`node scripts/check-drive-deployment.mjs https://audio-recorder-drive.audio-recorder-drive-backend.workers.dev` 已验证线上 HTTPS、来源限制、分区 Cookie 设置、回调地址和空会话创建/清除，不会授权 Google 或上传音频。自动化测试与运行时检查通过不等于真实账号授权验证；更换部署或 OAuth 配置后，还应实际连接、刷新/重开页面，并短录音检查上传与复制链接。

首次授权等待窗口为 9 分钟，并提示在 Google 窗口完成授权。后端在交换凭据和读取资料期间保持“处理中”，完成后才报告成功或失败，避免网页提前关闭授权窗口；交错回调不会用旧账号覆盖新连接。

部署检查还通过受来源限制的 `/auth/health` 验证服务端加密/解密往返，只返回健康状态。授权失败时显示失败步骤，便于排查凭据交换、资料读取或会话保存；不会显示或记录授权码、访问/刷新凭据或 Client Secret。

Cloudflare 出站请求使用 `redirect: "manual"` 并拒绝意外 3xx，不使用该运行时不支持的 `redirect: "error"`。`backend` 安装开发依赖后可运行 `npm run test:runtime`，在实际 workerd 运行时中验证 OAuth 交换、加密保存、刷新续期及不跟随跳转；Google 响应由测试替身提供。

真实账号验证（2026-10-26）：已完成 Google 授权，网页设置与主页面均显示账号头像和用户名；刷新页面及重新打开根地址均自动恢复连接，自动上传开关保持开启。头像图片已实际加载。另有 38 项自动化测试、workerd 授权交换/续期运行时测试和线上服务加密/会话检查通过。未在验证过程中采集真实麦克风音频；实际录音上传、播放及云端链接复制可由用户短录音复核。

验证方法：运行 `node scripts/test-google-drive.cjs`（模拟测试，不访问真实云盘）及 `scripts/validate-release.ps1 -ExpectedVersion 1.23`。配置真实 OAuth 后，测试手动上传、自动上传开关、错误重试、本地下载，并核对云盘文件名、大小和播放。


### 浏览器录音列表（未发版调整）

已移除切换窗口大小和打开链接入口，改为“打开列表”。停止录音后自动保存 MP3 / WebM 到浏览器，自动下载和自动上传仍按原开关执行。列表名称右侧：未上传显示“上传”，已上传显示“分享链接”（点击复制）；每项还可播放或重新下载。上传旧录音不会替换主页面的当前录音。

清空前需点击“确认清空”，只清除浏览器本地录音及链接记录，不删除 Google Drive 文件；保存或上传过程中需等待完成后再清空。保存失败会在主页提示，请立即下载备份。清除站点数据、无痕窗口关闭或浏览器回收存储可能删除录音；不同设备、浏览器和网页/插件来源不共享录音库。分享链接不会自动设为公开，可在 Google Drive 调整访问权限。

测试：原有 Drive / Worker 测试加列表上传、跨刷新去重测试使用 `node --test scripts/test-google-drive.cjs scripts/test-drive-backend.mjs`。录音库事务测试需先在本机测试依赖目录安装 `fake-indexeddb@6.2.4`，将该目录的 node_modules 加入 NODE_PATH，再运行 `node --test scripts/test-recording-library.cjs`。覆盖音频 Blob 重开、排序、事务失败、并发写回、清空后不复活和数据库不可用。手工验证：完成一段录音 → 打开列表 → 刷新后重新查看/播放 → 上传 → 点击分享链接复制 → 清空/取消清空。版本保持 1.23，不生成 ZIP。

本地界面测试：运行 `node scripts/preview-recording-library.cjs` 后打开 `http://127.0.0.1:4174/`。通过“生成测试录音”检查保存、刷新恢复、列表播放、上传后分享链接及清空流程；测试页只生成合成静音，Google 请求均为模拟，不访问真实云盘。

### 标题栏开关与输入设备（未发版调整）

标题“音频录制器 1.23”右侧放置自动下载、自动上传开关，以及缩小后的 Google 官方渐变 Drive 图标。自动上传开关与云端设置同步，未连接时引导连接，不会误开启。自动下载仍控制 MP3，自动上传格式遵循云端设置。

输入设备下拉位于选择比特率左侧，选择保存在当前浏览器，下次录音使用所选设备。加载页面只枚举设备，不请求麦克风；首次开始录音授权后可显示完整设备名称。录音期间不可切换设备，停止后可重新选择；所选设备移除时会提示并回退默认，录音请求失败不会偷偷改用另一个麦克风。

设备逻辑测试：`node --test scripts/test-input-devices.cjs`。手工检查：切换设备、刷新恢复、录音时设备锁定、停止解锁和 USB 麦克风拔插；标题自动上传与设置双向同步。未修改版本号，未打包 ZIP。图标来源：[Google Workspace 官方资源](https://knowledge.workspace.google.com/static/images/icons/product/drive.svg)，本地保存后随页面提供，不在每次打开时请求 Google 图标站点。

时间码字体调整（未发版）：改为 Arial Black 优先的粗体无衬线数字，取消斜线零，保留绿色和桌面 46px / 窄窗口 38px 字号。时间码点击复制及样式复制功能保持原逻辑。版本仍为 1.23，未打包。

### Chrome 音频处理兼容修正（未发版调整）

输入采集显式请求 `echoCancellation: false`、`noiseSuppression: false` 和 `autoGainControl: false`，默认输入和指定设备均适用，减少对 ChromeWideEchoCancellation / WebRtcAllowInputVolumeAdjustment 等实验开关的依赖。取得音轨后检查实际设置；如果浏览器仍报告处理开启，会提示短录音复核。此设置只控制浏览器可配置的音频处理，不保证关闭设备驱动或系统自身的音频增强，也不能修复没有输入信号的虚拟声卡路由。

验证：55 项测试通过，覆盖采集约束、实际设置不匹配提示、设备选择和已有录音/上传功能。真实麦克风或虚拟声卡的出声效果仍需用户短录音验证；若录电脑声音，应选择实际承载声音的 Voicemeeter / CABLE 等输入，并核对该输入的电平。未新增标签页/屏幕音频采集能力或插件权限。版本保持 1.23，未打包 ZIP。

### 授权到期时间兼容修正（2026-10-27，未发版）

修复“授权服务返回的凭据无效”：旧版前端把服务器绝对到期时间直接与本机时间比较，在两端时钟不一致时会把有效凭据误判为过期。Worker 改为同时返回剩余有效秒数 expiresIn，前端扣除请求耗时后使用 performance.now() 单调时钟计算到期和续期，不再依赖本机日期；保留 expiresAt 兼容旧前端，临近过期的后端凭据提前续期。凭据为空、时长无效或传输期间已过期仍会拒绝。

59 项测试与 workerd 运行时检查通过，覆盖本机时钟领先/落后一天、连接后前后调整日期、真实时长到期续期、无效凭据及旧后端兼容。用户的云端文件、本地录音库、现有服务端密钥与 Cookie 不因修正被清除。验证方法：重新打开网页，确认云端连接恢复，短录音或在列表中上传一份文件检查结果。版本仍为 1.23，未打包 ZIP。

### 录音自动保存、异常恢复及上传恢复（第一阶段，未发版）

录音中目标每约 2 秒将新增完整 MP3 音频帧与原始 WebM 分块保存到 IndexedDB，事务采用严格持久化请求；只追加分块，不重复写入整段录音。时间码下显示“已保护至”，只在数据库提交成功后前移。该时长依据真实音频帧计算，与手动校正时间码独立。保存失败会提示，并保留内存缓冲供重试；请及时正常停止并下载。

浏览器闪退或重开后，主页提示可恢复的中断录音。点击“查看恢复”，可恢复到列表、下载已保存的 MP3 部分、下载 WebM 原始备份，或确认后删除备份。恢复会检查完整 MP3 帧，去掉最后不完整的尾部；校验失败保留原备份。恢复文件标记“中断恢复”，不自动重新录音，也不自动上传。WebM 原始分块不保证能直接播放。

正常停止后，在同一个数据库事务内保存完整录音并清除对应草稿/分块；保存失败保留备份。已有列表录音在数据库结构升级时保留。使用 Web Locks 防止另一个标签页恢复或删除正在录制的备份；不支持 Web Locks 时，近期仍在更新的备份会暂时被保护，需要关闭其他录音页后稍候重试。清空列表只删除已保存的录音，不清除中断备份、正在录音的备份或云端文件。

上传队列在发送音频前记录格式、目标文件夹和排队状态，并继续保存固定云端文件 ID 与所属账号；不保存访问令牌或上传会话 URL。重连或打开列表时核对已完成的云端文件 ID、大小和账号，确认完成后恢复分享链接，不重复发送音频。尚未完成的显示“继续上传”，沿用原格式和文件夹，由用户点击继续；重开后的未完成文件可能需要重新传输，固定 ID 防止重复创建文件。本阶段没有云端分段备份。

边界：约 2 秒是保存目标，不是保证最多丢失 2 秒；调度、编码、数据库写入及断电都可能扩大未提交范围，以最后成功的保护进度为准。电脑重启期间的声音无法补录。清除站点数据、无痕窗口关闭或存储被回收仍可能删除本地数据。旧版录音过程中尚未停止的内存数据不能由新版本补回。

自动测试：为测试依赖目录配置 NODE_PATH（含 fake-indexeddb@6.2.4）后运行 `node --test scripts/test-recording-recovery.cjs scripts/test-recording-library.cjs scripts/test-input-devices.cjs scripts/test-google-drive.cjs scripts/test-drive-backend.mjs`。覆盖真实 LAME 编码帧、数据库重开、失败重试、最终缓冲、原子替换、序号竞态、旧数据库迁移、云端状态核对与原格式/文件夹恢复。界面测试可运行 `node scripts/preview-recording-library.cjs`，使用合成音频录音，并点击“模拟突然中断”或“模拟上传响应丢失”；不采集麦克风、不连接真实 Google 云盘。版本保持 1.23，不打包 ZIP。

本次实际浏览器验证：合成音频录音后模拟页面突然中断，成功恢复约 23 秒 MP3 并实际播放；正常停止录音保存完整 MP3/WebM；其他标签页不误恢复活动录音；模拟上传完成响应丢失后，重开显示继续上传，重连核对后自动恢复分享链接。自动测试共 69 项通过。未实际重启电脑或强制结束用户浏览器。
