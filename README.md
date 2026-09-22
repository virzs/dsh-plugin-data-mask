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
- **提示条**：输入框下方出现「已脱敏 N 处：手机号/固话×1、邮箱×1」，并提供两个按钮：
  - **按住查看原文**：像密码框的“小眼睛”一样，**按住不放**才显示原文，松开立刻恢复脱敏文本；键盘聚焦后按住任意键同样有效。
  - **撤销脱敏**：把原文放回输入框。仅在草稿未被改动、且距粘贴不超过 10 分钟时可用；草稿变了会拒绝执行并提示，绝不会覆盖你后续的编辑。
- **状态小胶囊**：`脱敏中 / 脱敏 3 处 / 脱敏已关`，点击打开设置面板。
- **设置面板**：总开关、替换方式、逐条规则开关、自定义规则、实时试算预览。
- **自定义规则**：面板里每行一条，支持 `/正则/标志 => 替换文本`，例如 `/EMP-\d{6}/ => [工号]`；以 `#` 开头的行是注释。正则非法时会在面板里直接报错，不影响其它规则。
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

## 安装与开发

```powershell
# 安装（插件管理器会把它登记到 profile 的 dsh.profile.bundles）
# 在 Harness 里：plugin_manager install_bundle  target = 本目录绝对路径

# 依赖：无。运行测试（含产物同步、清单一致性与“不阻塞启动”约束）：
npm test

# 修改 engine.js 后把引擎重新内联进 client.js（tests 会检查两者是否同步）
npm run build

# 在真实浏览器里验证（需要一个运行中的实例 URL，含 token）
node scripts/check-web-boot.mjs "http://127.0.0.1:3080/?token=..."
node scripts/check-web-e2e.mjs  "http://127.0.0.1:3080/?token=..."
```

目录结构：

```
engine.js              规则、校验器、脱敏引擎（唯一事实来源，纯 ESM，可独立复用）
client.js              浏览器半边：内联引擎 + 粘贴拦截 + 提示条 + 设置面板
index.js               Host 半边（本插件功能全在浏览器端，仅保留 bundle 入口）
cordis.patch.yml       bundle 补丁：插入 data-mask 行
scripts/build-client.mjs      把 engine.js 内联进 client.js 的生成脚本
scripts/repro-client.mjs      在 Node 里模拟浏览器模块表，复现客户端的加载错误
scripts/check-web-boot.mjs    无头 Chrome：抓取真实控制台输出，确认启动门通过
scripts/check-web-e2e.mjs     无头 Chrome：验证粘贴脱敏、按住查看、撤销、设置面板
test/                  node:test 用例（引擎行为 + 产物同步 + 清单一致性 + 启动安全约束）
```

## 两个必须记住的工程约束

这两条都是踩过坑后固化的，测试会强制守护：

1. **`client.js` 不能 `require` 本包的子路径。** 浏览器模块表只解析包自身的 id 和
   `/client` 子路径；`@local/dsh-plugin-data-mask/engine` 这类子路径解析失败会让
   bundle 的 import 直接 reject，而客户端插件的 import 失败会触发 **Web 启动门**，
   整个 GUI 停在 “Failed to load plugins” —— 用户连界面都进不去。所以引擎是
   `npm run build` 内联进 `client.js` 的，`test/package.test.mjs` 会断言
   `require()` 只允许 `react`。
2. **`inject` 只声明 `slots`，`locale` 用 `ctx.get('locale')` 读取。** 声明了却缺失的
   服务会让 fiber 停在 pending，同样触发启动门。`apply()` 内每一步都包了 try/catch，
   UI 渲染包了 error boundary：任何一步失败只降级功能，不会阻塞页面。

开发提示：插件以 junction 链接方式安装在 `C:\Users\virs9\.dsh\profiles\web\node_modules\@local\dsh-plugin-data-mask`，直接指向本目录，改动即时生效（客户端代码刷新页面后加载）。

## 界面语言

面板文案跟随 Harness 的语言设置（内置 `zh` / `en` 词典，通过 Client locale 服务注册；该服务不可用时自动回退到内置词典）。

