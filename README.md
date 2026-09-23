# 数据脱敏插件 (DSH Data Mask)

粘贴到 DeepSeek Harness 对话框时**自动剔除敏感信息**的插件：手机号、身份证号、银行卡号、邮箱、API 密钥、数据库连接串、内网 IP 等在进入输入框之前就被替换掉，原文不会被发送给模型，也不会写进会话记录。

这是本仓库实现的完整插件（`@local/dsh-plugin-data-mask`），已经安装到 `web` profile 并启用。

```
你复制的文本 ──► 剪贴板 ──► 粘贴拦截器（本插件，在输入框之前）──► 脱敏文本 ──► 输入框 ──► 模型
                                   │
                                   └─► 输入框下方提示：「已脱敏 3 处」+ 按住查看原文 + 撤销脱敏
```

## 功能

- **粘贴即脱敏（默认开启）**：在窗口捕获阶段拦截 `paste`，先替换敏感信息，再把脱敏后的文本重新交给输入框，因此正常粘贴行为（撤销边界、引用芯片处理）保持不变。
- **提示条**：输入框卡片**上方**出现「已脱敏 N 处：手机号/固话×1、邮箱×1」，并提供两个按钮：
  - **按住查看原文**：像密码框的“小眼睛”一样，**按住时输入框临时切回原文**，松开立即恢复脱敏文本，可以直接核对模型实际会收到什么；按住期间如果你改了草稿，松开时不会覆盖你的修改（状态栏会同步显示「输入框已切到原文」）。
  - **撤销脱敏**：把原文放回输入框。仅在草稿未被改动、且距粘贴不超过 10 分钟时可用；草稿变了会拒绝执行并提示，绝不会覆盖你后续的编辑。
  - 提示条属于**产生它的那次会话**：切换到别的会话就不再显示，切回来会重新出现。
- **设置页**：在左下角 **设置** 里，与其他内置分页并列的一项「数据脱敏」。页面按外壳的设置行规范实现（14/20 标题、12/18 说明、16px 行距、半像素分隔线），控件直接复用外壳 primitives（`Switch` / `SegmentedControl`），跟随主题与语言：
  - 启用粘贴脱敏（总开关）
  - 替换方式（整体替换 / 部分掩码 / 星号覆盖）
  - 识别规则：13 条规则逐条开关
  - 自定义规则：每行一条 `/正则/标志 => 替换文本`，例如 `/EMP-\d{6}/ => [工号]`；`#` 开头为注释，非法正则在行下直接报错
  - 试一下：输入或粘贴样例，实时显示替换结果与命中统计
- **三种替换方式**：
  | 方式 | 手机号示例 | 说明 |
  | --- | --- | --- |
  | 整体替换（默认） | `[手机号/固话]` | 最安全，只保留类型 |
  | 部分掩码 | `138****5678` | 保留可读上下文，隐藏部分定长补星号，不泄露原长度 |
  | 星号覆盖 | `***********` | 定长星号，隐藏长度 |

## 默认规则

| 规则 | 说明 | 校验 |
| --- | --- | --- |
| 证书/私钥 | PEM 私钥、证书块 | — |
| JWT 令牌 | 三段式 JWT | 头部必须是合法 base64url JSON |
| API 密钥 | `sk-`、`ghp_`、`AKIA`、`AIza`、`xoxb-` 等前缀 | — |
| Authorization 头 | `Bearer` / `Basic` 凭据 | — |
| 数据库连接串 | `scheme://user:pass@host`、`password=`/`api_key=` 赋值 | — |
| 银行卡号 | 13–19 位数字 | Luhn 校验 |
| 身份证号 | 18 位（含校验位）、15 位 | GB 11643 校验位 + 出生日期 |
| 邮箱地址 | 常见邮箱写法 | — |
| 手机号/固话 | 11 位手机号、带区号固话 | 号段格式 |
| MAC 地址 | `00:1A:2B:3C:4D:5E` | — |
| 内网 IP 地址 | RFC 1918、回环、链路本地 | 私有网段判断 |
| IPv6 地址 | 含 `::` 压缩写法 | 结构化校验（8 组或压缩） |
| QQ 号 | `QQ: 12345678` | 默认关闭 |

优先级按“越具体越先匹配”排列，命中区间不会被后面的规则二次替换：16 位银行卡不会被当成手机号，MAC 地址不会被当成 IPv6。

## 隐私边界

- 脱敏发生在**浏览器内**，原文不经过任何网络请求，也不写入 `localStorage`。
- 为了支持“按住查看原文 / 撤销脱敏”，**原文只保留在内存里**，并在 10 分钟后自动清除；点提示条右上角 ✕ 可立即丢弃。
- 设置项（开关、替换方式、规则开关、自定义正则）保存在浏览器 `localStorage` 的 `dsh.data-mask.settings.v1` 下。
- 已知局限：正则脱敏不是万无一失的 DLP。规则会随使用继续补充，重要的密钥请不要依赖任何客户端工具。

## 发布与收录

仓库需要打上 **`dsh-plugin`** topic 才会被 DSH 的插件列表收录（GitHub 仓库页右上角 ⚙ → Topics，或用命令行）：

```powershell
gh api --method PUT repos/<owner>/<repo>/topics -f "names[]=dsh-plugin"
# 当前仓库已打：dsh-plugin, deepseek-harness, dsh, cordis, data-masking, privacy
gh api repos/<owner>/<repo>/topics     # 核对
```

## 安装与开发

```powershell
# 安装（插件管理器会把它登记到 profile 的 dsh.profile.bundles）
# 在 Harness 里：plugin_manager install_bundle  target = 本目录绝对路径

# 依赖：无。运行测试（含产物同步、清单一致性与“不阻塞启动”约束）：
npm test

# 修改 engine.js 后把引擎重新内联进 client.js（tests 会检查两者是否同步）
npm run build

# 在真实浏览器里验证（需要一个运行中的实例 URL，含 token）
node scripts/check-web-boot.mjs     "http://127.0.0.1:3080/?token=..."
node scripts/check-web-e2e.mjs      "http://127.0.0.1:3080/?token=..."
node scripts/check-web-settings.mjs "http://127.0.0.1:3080/?token=..."

# 截图（视觉走查用，默认写到 ./screenshots）
node scripts/shoot-settings.mjs "http://127.0.0.1:3080/?token=..."
```

目录结构：

```
engine.js              规则、校验器、脱敏引擎（唯一事实来源，纯 ESM，可独立复用）
client.js              浏览器半边：内联引擎 + 粘贴拦截 + 提示条 + 设置页
index.js               Host 半边（本插件功能全在浏览器端，仅保留 bundle 入口）
cordis.patch.yml       bundle 补丁：插入 data-mask 行
scripts/build-client.mjs         把 engine.js 内联进 client.js 的生成脚本
scripts/repro-client.mjs         在 Node 里模拟浏览器模块表，复现客户端的加载错误
scripts/check-web-boot.mjs       无头 Chrome：抓真实控制台输出，确认启动门通过
scripts/check-web-e2e.mjs        无头 Chrome：验证粘贴脱敏、按住查看、撤销
scripts/check-web-settings.mjs   无头 Chrome：验证设置页渲染/切换持久化/开关生效
scripts/check-notice.mjs         无头 Chrome：验证提示条位置/按住查看/会话归属
scripts/check-page.mjs           无头 Chrome：页面现状排查（选择器找不到时用）
scripts/check-composer-dom.mjs   无头 Chrome：打印输入框区域的 DOM 与 data-* 标记
scripts/shoot-settings.mjs       无头 Chrome：截图到 screenshots/
test/                  node:test 用例（引擎行为 + 产物同步 + 清单一致性 + 启动安全约束）
```

## 四条必须记住的工程约束

都是踩过坑后固化的，测试会强制守护：

1. **`client.js` 不能 `require` 本包的子路径。** 浏览器模块表只解析包自身的 id 和
   `/client` 子路径；`@local/dsh-plugin-data-mask/engine` 这类子路径解析失败会让
   bundle 的 import 直接 reject，而客户端插件的 import 失败会触发 **Web 启动门**，
   整个 GUI 停在 “Failed to load plugins” —— 用户连界面都进不去。所以引擎是
   `npm run build` 内联进 `client.js` 的，`test/package.test.mjs` 会断言
   `require()` 只允许模块表种子词（`react`、`@deepseek-ai/dsh-client-ui-primitives`）。
2. **`inject` 只声明 `slots`，`locale` 用 `ctx.get('locale')` 读取。** 声明了却缺失的
   服务会让 fiber 停在 pending，同样触发启动门。`apply()` 内每一步都包了 try/catch，
   UI 渲染包了 error boundary：任何一步失败只降级功能，不会阻塞页面。
3. **`ctx.effect(cb)` 把 cb 的返回值当清理函数。** 因此要交回清理函数，而不是在
   `ctx.effect` 里执行副作用——写成 `ctx.effect(installStyles())` 会“装好立刻拆掉”（样式
   曾因此在浏览器里整个丢失）。
4. **定位输入框卡片要用外壳自己的标记 `[data-composer-card]`，不要用几何推导。** 该卡片在
   开始页只比视口窄约 27%、在会话页窄约 68%，且输入框自带一个内部滚动容器，任何宽高阈值
   都无法同时命中两种布局（提示条曾因此压在输入框上）。同理，**函数不能重复声明**：后声明的
   会静默覆盖前一个，`noticeOffset` 就这样被旧实现盖掉过一次，测试因此加了重名断言。

开发提示：插件以 junction 链接方式安装在 `C:\Users\virs9\.dsh\profiles\web\node_modules\@local\dsh-plugin-data-mask`，直接指向本目录，改动即时生效（客户端代码刷新页面后加载）。

## 界面语言

页面文案跟随 Harness 的语言设置（内置 `zh` / `en` 词典，通过 Client locale 服务注册；该服务不可用时自动回退到内置词典，语言以外壳写入的 `document.documentElement.lang` 为准）。

