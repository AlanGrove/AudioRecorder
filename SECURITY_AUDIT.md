# AudioRecorder 安全审核报告

审核日期：2026-10-27。范围是当前工作区的 `work` 项目、外层 Git 忽略规则及 `outputs` 中与项目有关的构建/工具产物。第 1–7 节记录初次本地审核时的结论与测试，当时未部署。维护者随后授权继续上线，最新部署与线上验收状态见第 8 节；未发版或生成 ZIP。

## 1. 项目概况与审核边界

- 前端：原生 JavaScript、HTML、CSS，Web Audio / AudioWorklet、MediaRecorder、IndexedDB；同时支持 GitHub Pages 网站和 Chrome Manifest V3 扩展。没有 React、Vue、Electron、数据库服务器或桌面 IPC。
- 后端：Cloudflare Worker ES Module + SQLite Durable Object，仅代理 OAuth 授权与续期；音频直接上传 Google Drive。
- 包管理：npm。原来只有 `backend/package.json`，没有项目锁文件；本次补充 lockfileVersion 3。两项直接开发依赖是 Wrangler 与本来在外部测试目录使用的 fake-indexeddb；浏览器另有两个内置编码器文件。Google Identity Services 是官方动态服务，不属于已锁定的 npm 依赖。
- 最终锁文件有 **92 个 npm 包记录**，包括 **60 个可选平台记录**，不等于所有平台二进制都在本机安装。Worker 的生产代码没有 npm 运行时依赖。
- 审核项目自有程序、配置、CI、脚本、测试、文档、历史入口、SVG 及资源引用；第三方压缩编码器采用上游字节比对、哈希和危险调用检查，没有宣称逐行证明整个编码算法安全。安装的 node_modules、npm 下载缓存不是项目自有源代码，依赖用锁文件、公告和扫描审查。
- 已检查本地跟踪状态：外层 Git 尚无提交、`git ls-files` 为零。**远端 GitHub 历史、已发布旧 ZIP、Google/Cloudflare 控制台完整权限及生产日志未纳入此次本地审核，历史是否曾泄露凭据为「待确认」**。没有对线上进行负载、破坏或真实账号攻击测试，也没有接触正在进行的线上录音。

本次未发现已确认影响当前版本的 Critical / High 依赖漏洞或可直接利用的未鉴权读录音漏洞。发现并在本地修复 8 项问题/加固缺口；2 项部署决策按维护者明确选择留待后续，另有编码库维护状态需要关注。未命中已知漏洞数据库不代表软件不存在未知漏洞。

## 2. 问题汇总

行号均为修复后源码的定位点；下表“已修复”记录本地审核验证，线上生效状态另见第 8 节。

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
|---|---|---|---|---|
| A01 | 代码 | Medium | `backend/worker.mjs:132`, `:215`, `:260` | 已修复：退出与加密写回竞态 |
| A02 | 代码 | Medium | `.github/workflows/release.yml:27` | 已修复：发布标签插入 PowerShell |
| A03 | 代码 | Medium | `scripts/preview-recording-library.cjs:45` | 已修复：预览暴露任意项目文件、DNS 重绑定入口、异常编码导致拒绝服务 |
| A04 | 密钥 | Medium | 工作区根 `.gitignore:2`，外层 `outputs/cloudflare-local/.wrangler/config/default.toml` | 已修复：部署登录缓存未被外层 Git 忽略；未确认已泄露 |
| A05 | 依赖 | Medium | `backend/package-lock.json:1`, `backend/package.json:10` | 已修复：无锁文件、测试依赖未声明 |
| A06 | 代码 | Low | `.github/workflows/release.yml:19`, `:97`, `:102` | 已修复：Action 可变标签、checkout 持久化凭据 |
| A07 | 代码 | Low | `index.html:5`, `AudioRecorder.html:5`, `google-drive.js:267` | 已修复：页面缺少 CSP 等纵深防护；未证实存在可利用 XSS |
| A08 | 密钥 | Low | `scripts/validate-release.ps1:93`, `:107`, `:144`, `:188` | 已修复：检查遗漏 Worker/测试/TOML、敏感配置文件名 |
| A09 | 代码 | Medium | `backend/wrangler.toml:7`, `backend/worker.mjs:58`, `recording-library.js:138` | 待开发者决定：已选择后续独立域名隔离 |
| A10 | 代码 | Medium | `backend/worker.mjs:109`, `:112`, `:155` | 待开发者决定：已选择后续配置边缘限流 |
| A11 | 依赖 | Low | `lamejs.iife.js`, `lame.min.js`, `THIRD_PARTY_NOTICES.md` | 建议关注：编码库长期无 npm 更新，当前未命中已知漏洞 |

严重级别是结合本项目利用前提的定性判断，并非编造的 CVSS 分数。A05–A08 包含安全工程加固项，不能等同于已证明可被远程利用的漏洞。

## 3. 已修复问题、条件与验证

### A01 — 退出后可能被迟到的授权请求重新保存

旧代码在读取并核对会话后，异步执行 AES-GCM 加密，再直接写回存储。若退出发生于加密等待期间，迟到的 OAuth 回调或刷新请求可能重建已经删除的会话，破坏退出语义。利用需要同一会话存在在途授权/续期请求并与退出交错；不是无需凭据读取其他用户会话。

修复：新增 `updateSession()`，在存储事务内重新检查会话存在、有效期和版本；回调还检查仍属同一流程且没有新流程覆盖，再提交加密结果。失败状态写入和 invalid_grant 处理也使用该事务检查。Google token/profile 出站请求另加 15 秒超时，保留固定目的地址和拒绝跳转行为；没有变更加密密钥、Cookie 格式或正常连接时长。

验证：新增回调加密、刷新加密两项可控竞态测试，**修复前两项均失败，修复后均通过**；退出后存储仍为空且后续会话读取返回 401。原有交错账号切换、刷新去重、撤销和到期测试通过；真实 workerd + SQLite Durable Object 运行时测试通过，Google 响应使用测试替身。

### A02 — 标签文本被解释为 PowerShell 源码

原工作流在 `run` 中直接嵌入 `github.ref_name`，仅要求以 v 开头。能创建匹配标签的攻击者可以提供带 PowerShell 元字符的标签，使运行器执行额外命令；此工作流有发布和 OIDC/attestation 权限，因此不能把标签当可信脚本。

修复：标签经 `RELEASE_TAG` 环境变量传入，验证为 Chrome 的 1–4 段数字版本，每段 0–65535、禁止全零与前导零。后续步骤也通过环境变量传递校验后的版本，避免 GitHub 表达式直接插入脚本。未来 ZIP 输出到 `outputs`，不再递归删除整个输出目录，已有 staging 时直接拒绝覆盖。本次没有执行标签发布。

验证：实际调用 PowerShell，合法 v1.23 输出正确；`v1$(whoami)`、引号/分号、越界、全零、过多段和前导零均被拒绝。没有运行不可信标签内容。

### A03 — 本地预览不应提供整个工作目录

旧预览虽然有目录前缀检查，但允许读取项目内任意文件，未来的 `.env`、`.dev.vars` 或配置可能被返回；没有 Host/Origin 检查，存在在本地服务开启时被 DNS 重绑定利用的条件。畸形百分号编码也可能在异常捕获外抛出并终止服务。当前并未发现该目录里真实 OAuth 密钥文件被预览服务读取的证据。

修复：只允许明确的 HTML/JS/CSS/图标资源，拒绝其他文件；限定本地 Host/Origin、GET/HEAD，异常编码返回 400。测试夹具仅为其自身的合成音频脚本生成随机 CSP nonce，生产 HTML 不加入内联脚本许可。服务仍只监听 127.0.0.1。

验证：通过真实 HTTP 请求验证配置路径与反斜线穿越返回 404、外部 Host/Origin 返回 403、POST 返回 405、坏编码返回 400，之后正常静态资源仍返回 200。

### A04 — 外层工作区存在可误提交的登录缓存

发现外层 `outputs` 中的正常 Wrangler 登录配置包含部署 access/refresh 凭据字段。没有读取或输出具体凭据值。原 `work/.gitignore` 不能保护上级 `outputs`，外层 Git 将其列为未跟踪内容；误执行“添加全部文件”可能把凭据带入仓库。**这不是已经公开泄露的结论**。

经维护者明确同意，唯一在 `work` 外的修改为根 `.gitignore`，忽略输出、Wrangler 缓存、依赖和常见密钥文件。`git check-ignore` 已确认实际缓存被忽略。项目 `.gitignore` 允许提交只有变量名的 `backend/.env.example`，其中没有真实值。没有删除登录缓存、撤销授权、变更云权限或轮换任何密钥。

如果今后确认凭据已经提交、分享或泄露，必须在对应平台撤销并重新生成，仅删文件或补忽略规则不够。更换 `TOKEN_ENCRYPTION_KEY` 会令现有加密会话无法解密，应先制定迁移或重新登录方案。

### A05 — 安装不能复现、测试依赖隐含在外部目录

原先只有精确 Wrangler 版本，间接依赖解析和完整性没有项目锁文件约束；IndexedDB 测试还依赖工作区外部的 fake-indexeddb。没有发现其安装了已知恶意依赖，问题是供应链可复现性不足。

修复：保留 Wrangler 4.153.0，不做大版本升级；声明原测试使用的 fake-indexeddb 6.2.4，生成包含全部平台依赖及 integrity 的 lockfile。新增 `scripts/run-tests.cjs`，统一为既有测试提供声明的依赖搜索路径，`npm test` 覆盖全部测试。所有 92 个包记录都含完整性摘要，无 deprecated 标记。

验证：已用 `--ignore-scripts` 安装；npm audit 和 OSV 对锁定版本交叉检查；原有录音/输入/恢复/上传及后端测试继续通过。忽略生命周期脚本不会消除测试/构建工具本身的执行权限，锁文件也不能防止未来上游账号或注册表遭入侵。

### A06 — 第三方 Action 引用可变

上游主版本标签可能移动或被接管；此类供应链变更会影响有写权限的发布任务。修复为官方仓库当前 v4/v2 对应的完整提交 SHA，保持原主版本，并关闭 checkout 凭据持久化。`contents:write`、`id-token:write`、`attestations:write` 由原有 release/证明功能使用，没有删除功能或另增权限。

固定值：checkout `11d5960a326750d5838078e36cf38b85af677262`；attest-build-provenance `e8998f949152b193b063cb0ec769d69d929409be`；action-gh-release `3bb12739c298aeb8a4eeaf626c5b8d85266b0e65`。已通过 GitHub 官方仓库 ref API 核实；没有触发真实 Release 来测试。

### A07 — 页面纵深防护

未发现文件名、账号名或恢复元数据直接进入可执行 HTML 的路径：动态显示主要使用 textContent，innerHTML 仅用于清空元素。原页面没有 CSP，未来出现注入时缺少第二层防护。

修复：两个入口同步增加早期 CSP，拒绝未许可内联脚本、动态求值、对象、base 和表单提交；允许本地 Worklet、Blob 音频，以及 Google 官方 GIS script/style/授权 iframe。增加 strict-origin-when-cross-origin 引用策略，保留头像已有的 no-referrer；插件分支明确禁止加载网页 SDK。按 [Google 官方 CSP 指南](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)保留授权兼容项。

边界：为兼容用户配置的任意 HTTPS 授权后端，connect-src 仍允许 https:；style-src 为现有样式保留 unsafe-inline。CSP 不解决同来源其他项目和受信任第三方脚本自身的问题；meta CSP 不能提供 frame-ancestors/X-Frame-Options 响应头，不能声称已经完成点击劫持防护。独立站点部署时建议用响应头设置 frame-ancestors 'none'。

验证：Chrome 本地测试明确显示“CSP 已拦截无许可的内联脚本”；32.22 秒合成音频正常录制、自动保存，MP3 实际播放且媒体错误为空，列表和模拟云端连接正常。未使用真实麦克风、未打开真实 Google 授权窗口、未上传真实音频；**本次没有重新验证真实 GIS 弹窗与生产 Cookie 流程**。

### A08 — 发布检查的盲区

原检查未扫描 `.mjs/.cjs/.toml` 内容，也没有完整拦截 OAuth JSON、`.dev.vars` 等文件名。修复扩展文本检查和包条目检查，在目录遍历之前剪枝 node_modules/输出/缓存及目录链接，避免扫描安装过程中的依赖树；允许只有变量名的 `.env.example`。现有两个已知无效测试常量仅作精确例外，不按整个测试目录豁免。

验证：发布源码校验通过。仍为启发式静态检查，不能替代历史扫描或保证识别全部混淆/编码密钥。没有为了测试生成 ZIP。

## 4. 依赖核查

全部直接依赖：

| 依赖 | 实际版本/来源 | 使用范围 | 本次结论 |
|---|---|---|---|
| wrangler | 4.153.0 | 开发、构建、部署 | 保留原版本，npm/OSV 未命中 |
| fake-indexeddb | 6.2.4 | IndexedDB 测试 | 原外部测试版本纳入声明，npm/OSV 未命中 |
| @breezystack/lamejs | 1.2.7 文档来源；内置文件与多个早期版本字节相同 | 当前页面 MP3 编码 | 上游字节一致，OSV 未命中；长期未更新 |
| lamejs | 1.2.1，按发布文件字节核对 | 保留的 1.21 历史入口 | 上游字节一致，OSV 未命中；当前页面不加载 |
| Google Identity Services | 官方动态 `accounts.google.com/gsi/client`，无固定 npm 版本 | 无后端时网页主动连接 | 按官方支持方式动态加载；无法作为固定版本做 npm audit |

关键间接依赖与公开公告交叉核对如下。公告用于判断**不受影响的版本边界**，不是本项目当前的未修复告警。

| 包 | 锁定版本 | 公告/修复边界与实际使用判断 |
|---|---|---|
| miniflare | 5.20261023.0-beta | 开发模拟器。核对[官方 SSRF 公告](https://github.com/cloudflare/workers-sdk/security/advisories/GHSA-fwvg-2739-22v7)，OSV 对当前版本未命中；不打包进入生产 Worker |
| workerd | 1.20261023.1 | 本地测试运行时，OSV 未命中；[官方公告页](https://github.com/cloudflare/workerd/security/advisories)已核对；生产运行时由 Cloudflare 管理 |
| undici | 7.30.1 | 已高于[缓存隔离/崩溃公告修复的 7.29.0](https://github.com/nodejs/undici/security/advisories/GHSA-4cwx-7wf7-3272)；自有业务不使用其共享缓存拦截器 |
| ws | 8.21.0 | 已高于[内存披露修复的 8.20.1](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx)，自有业务没有 WebSocket 服务 |
| esbuild | 0.28.2 | 已高于 [Windows serve 路径问题修复的 0.28.1](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr)；业务不使用 esbuild serve，也不使用 Deno 安装模块 |
| sharp | 0.35.5 | 当前为模拟器开发依赖，业务不解码上传图片。已达到 [librsvg 公告的 0.35.5](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)，高于 [libheif 公告的 0.35.4](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)和 [libvips 公告的 0.35.0](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj)；实际 Windows 二进制清单为 vips 8.18.7、rsvg 2.63.2、heif 1.23.5 |
| path-to-regexp | 6.3.0 | 达到 [ReDoS 公告的 6.x 修复版本](https://github.com/advisories/GHSA-9wv6-86v2-598j)；自有 Worker 路由为固定字符串，不拼接不可信正则 |
| cookie | 1.1.1 | OSV 未命中；已与 jshttp/cookie 官方发布信息核对，不是同名近似的 js-cookie 包 |
| semver | 7.8.5 | OSV 未命中；与 [node-semver 官方发布信息](https://github.com/npm/node-semver/releases)及已知 ReDoS 公告交叉核对 |

Wrangler 的 [pages deploy 命令注入公告](https://github.com/cloudflare/workers-sdk/security/advisories/GHSA-36p8-mvp6-cv38)修复版本是 4.59.1；当前 4.153.0 已高于该版本，项目部署使用 Worker deploy 而非 pages deploy，没有使用该公告的受影响参数。没有为了清告警使用 audit fix --force、降级或大版本覆盖。

扫描证据位于工作区 `outputs`：`security-npm-audit.json`（含开发/可选记录，0 命中）、`security-npm-production-audit.json`（0 命中）、`security-osv.json`（92 个 npm 记录 + 两个内置编码器版本，共 94 次精确版本查询，0 命中、无未取完分页），以及 `security-dependencies.csv/json`（全量名称/实际版本/完整性/范围）。外部旧 Wrangler 工具缓存另行 npm audit 也为 0 命中。报告没有把未列入 lock 的 Google 动态 SDK 算成已被 npm 审核。

维护状态：npm 注册表显示 @breezystack/lamejs 最后发布于 2023-10-17，lamejs 最后发布于 2021-12-02；其 GitHub 仓库均未标记 archived，不能直接断言已停止维护。未发现锁定树中含已知近似恶意包名（如 wrangler-deploy），未发现 deprecated 标记。beta/rc 间接版本来自官方 Wrangler 声明，没有为此擅自跨主版本替换。

## 5. 其余代码与密钥检查

| 审核对象 | 检查结论 |
|---|---|
| `AudioRecorder.js`, `AudioRecorderWorklet.js`, `input-devices.js` | 录音只在主动操作后 getUserMedia；没有后台静默采集。Worklet 消息经专用 MessagePort，不是接受任意网页 window 消息。未发现命令执行、模板注入或可执行动态输入 |
| `recording-library.js`, `recording-recovery.js` | IndexedDB 键操作和事务，不拼 SQL/NoSQL；展示用纯文本。保护跨标签活动草稿，清空不删除云端；本地录音未另行加密，依赖浏览器来源/用户配置文件隔离，这是现有产品设计 |
| `google-drive.js`, `drive-backend-config.js` | 上传仅接受 Google API 来源和固定路径前缀，禁止跟随跳转和携带 Cookie；文件 ID/大小/账号校验。文件名和目录查询分别使用 JSON 编码、查询转义；分享链接构造固定 Google 地址。公开 Client ID/Worker 地址不是 Client Secret |
| `backend/worker.mjs`, `backend/wrangler.toml` | CORS 精确比对 Origin，自定义请求头与方法限制阻止浏览器简单 CSRF；回调 state 单次消费 + PKCE。Session Cookie 为 Secure/HttpOnly/Partitioned/__Host；tokens 用 AES-256-GCM、随机 IV、会话 ID AAD 加密。没有固定 IV、自造加密、关闭 TLS、任意 SSRF 或开放重定向路径。响应错误不返回 Google 原始凭据 |
| `manifest.json`, `background.js` | MV3，只声明 downloads/identity，可选 Google API host，无 tabs、全站 host、content script、externally_connectable。图标点击打开固定本地录音页，没有任意来源消息监听或远程后台执行 |
| 两个 HTML、四个 CSS、`shared/*`、SVG/图标及旧入口 | 动态执行入口和外链已核对；shared JS 是本地兼容占位。静态 CSS/SVG 未发现远程资源加载或脚本；PNG 不是可执行源码。旧入口保留，未因审核删除功能 |
| `scripts/test-*`, `check-drive-*`, `run-tests.cjs`, `preview-recording-library.cjs`, `validate-release.ps1` | 测试使用合成/固定无效凭据。Node vm 只运行本地受信任的程序测试，不将上传 JSON 当代码；子进程使用参数数组且不启用 shell。对外部署检查脚本只适用于维护者给定的可信 HTTPS 地址，不作为公网 API |
| `.github/workflows/release.yml` | 只由 v 标签触发，无 pull_request_target、无不可信 PR checkout；已修标签插入并固定所有第三方 Action。CI 完整上线行为未实际触发 |
| README/PRIVACY/CHANGELOG/许可证、`.gitignore`、`.nojekyll`、`links.txt`、配置/测试/示例及生成的 Worker bundle | 未发现真实硬编码 API Key、OAuth Secret、Webhook 凭据、私钥或数据库密码。唯一实际凭据存储是已忽略的正常 Wrangler 登录缓存；OAuth 导入只保存公共 Client ID。图像/压缩/混淆内容和远端历史不能通过文本扫描完整证明无秘密 |

本项目没有服务端音频文件上传解析、压缩包解压、通用反序列化执行、数据库连接或 Electron/WebView，因此没有相应 SQL、zip slip、nodeIntegration 或通用 IPC 攻击面。JSON 导入有大小限制、类型检查，不持久化 Client Secret；输出通过 textContent 等安全接口展示。没有把“搜索不到危险关键字”当成不存在漏洞的证明。

## 6. 需要开发者决定的事项与建议

**A09，来源隔离：** 当前同账号 GitHub Pages 其他项目若执行恶意或遭注入的脚本，能够访问相同来源的录音 IndexedDB，也可能调用同来源允许的授权服务。路径、CSP 或修改 Cookie Path 都不能形成独立的浏览器安全边界。建议单独域名/子域名托管录音器，更新 Google OAuth JavaScript origin、Worker APP_ORIGIN、CSP/响应头，并设计旧来源录音导出迁移。可选保留现址且只在此来源托管可信项目。维护者本次选择：**先修代码，后续处理独立域名**。未修改 DNS、网址、OAuth 设置或丢弃旧录音。

**A10，资源滥用：** Origin 检查防的是浏览器跨站请求，不阻止非浏览器脚本伪造头批量调用 `/auth/start`，每次创建新 DO 和到期 Alarm，可能消耗请求/存储配额。建议在边缘对 auth/start 按 IP/时段限流，并结合总量告警；额度需考虑多人共用出口与重试。可选增加挑战或账号准入，但会改变首次连接流程。维护者本次选择：**记录风险，后续配置限流**。没有擅自配置可能锁住正常用户的阈值或付费服务，也未发起压测。

**A11，依赖维护：** 保留已验证的编码库并按期检查公告；若以后替换编码器，需要比较音质、速度、内存、断电恢复兼容性和许可证，不能仅因长时间无发布就强行换包。当前没有已确认必须更换而又无修复版本的 Critical/High 依赖。

后续上线顺序建议：先部署并验证 Worker 的事务修复，再同步网页与 CI；保持现有 Secret 不动，并验证真实授权/退出/重开。独立域名和限流另行确认方案。已有短期 access token 在其有效期内通常仍可用，退出本浏览器会话不是撤销整个 Google 账号授权；若怀疑泄露，请从 Google 第三方访问设置撤销授予。

## 7. 验证记录与使用方法

从 `work` 源码目录执行：

```powershell
cd backend
npm ci --ignore-scripts
npm test
npm run test:runtime
npm audit --package-lock-only
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir ../../outputs/security-worker-build
cd ..
pwsh -NoProfile -File scripts/validate-release.ps1 -ExpectedVersion 1.23
```

最终自动测试为 **74 项通过**（包括原有全部测试、两项加密竞态回归和三项安全测试），另有真实 workerd 运行时检查、Worker 编译预检和发布源码校验通过。源码无需前端打包；没有触发会创建 Release 的工作流，也没有为验证而生成 ZIP。

Chrome 合成音频验证证据：`outputs/AudioRecorder-Security-Check.png`；CSP 拦截、录音保存和 32.22 秒 MP3 播放通过。新页面默认仍不自动上传，旧中断备份保留。线上页面和真实云端授权不在本次浏览器回归范围。

版本号仍为 **1.23**，manifest 与内部显示未变。所有源码修改均在 `work`；根 `.gitignore` 是维护者明确批准的工作区元数据例外。审核 JSON/CSV、测试日志、截图和 Worker 编译预检产物位于 `outputs` 并被忽略。没有轮换密钥、清空真实录音或改变 Google Drive 分享权限。

## 8. 后续上线验收记录（2026-10-27）

维护者确认“下一步继续”后，已部署本次安全修复：

- Worker：`audio-recorder-drive`，部署版本 ID 为 `2e5551f1-4d21-48a2-8c2c-184b2cb7bb9b`。保留原有 Durable Objects、Secret、Cookie 配置与授权范围。
- 网页及源码：提交 `cfbce4414aa867ed2dc2f3b1ac96f1c93c856802`，发布到原有 [录音器网址](https://alangrove.github.io/AudioRecorder/)；[GitHub Pages 部署 40529696568](https://github.com/AlanGrove/AudioRecorder/actions/runs/40529696568)成功。授权脚本增加缓存标记，确保新 HTML 请求加固后的脚本。
- 线上接口检查：实际 HTTPS 服务通过 CORS/CSRF 非法请求拒绝、分区 Cookie、取消回调的事务写入、会话读取；退出空测试会话后，原 Cookie 再请求 token 返回 401。只创建并清理本次空测试会话，未授权 Google 或上传音频。
- 真实浏览器：网页自动恢复既有 Google 账号、头像/姓名正常、没有脚本错误；手动断开成功，刷新后没有恢复已退出的会话。本机两份中断备份保留，自动下载/上传开关维持原来的关闭状态，未点击录音。
- 维护者随后手动完成重新连接；已只读确认其另一录音器页面显示 Google 云端已连接，自动下载和自动上传均已由维护者开启。旧测试页面已超时并保持原样；在这次只读确认中没有刷新或关闭页面。
- 最终实测：维护者按其选择自行进行录音上传验收，并于 2026-10-27 明确反馈“已上传且可播放”。据此将真实上传及云端播放记为通过，证据来源为维护者的实际操作反馈；审核代理没有代为采集、上传、下载或收听真实录音，也未将模拟测试冒充真实云端验收。

### 最终验收结论

**本轮已实施的安全修复上线，以及授权、录音上传和云端播放的核心流程验收通过。**

| 验收项 | 结果 | 依据 |
|---|---|---|
| 代码回归与安全回归 | 通过 | 74 项自动测试、workerd 运行时检查、编译预检和源码校验 |
| Worker 与网页部署 | 通过 | 上述 Worker 版本与 GitHub Pages 成功部署记录，线上资源检查 |
| 来源/CSRF 防护、退出后的会话拒绝 | 通过 | 线上空测试会话及接口检查 |
| 真实账号恢复、退出和重新连接 | 通过 | 浏览器观察及维护者完成重新连接的确认 |
| 真实录音上传及云端播放 | 通过 | 维护者明确反馈“已上传且可播放” |

此结论限定于上述修复及已执行的验收项目，不等同于无条件安全认证或没有未知漏洞。没有把未实际等待的跨天/30 天到期行为记为本轮真实时长实测；相应续期/过期逻辑的自动化测试结果仍按第 3、7 节记录。

此次是修复部署，版本仍为 1.23，未创建正式 Release 或生成 ZIP。独立域名、授权入口限流与远端历史密钥排查仍是前述待办，未因上线而自动解决。
