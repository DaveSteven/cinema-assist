# 阶段 D 验收报告

验收日期：2026-09-25
结论：**通过。登录持久化、购票入口和异常状态识别均已完成代码检查、自动测试及真实浏览器复验。**

## 验收范围

- Playwright 持久化浏览器 profile。
- 用户手工登录流程和登录健康检查。
- 由 performance ID 打开官方购票页。
- 登录失效、会话过期、拥堵、重复交易、通用错误和站点变化检测。
- 敏感信息保护。
- 阶段边界：不得选座、锁座或付款。

## 已通过项目

- `npm run typecheck`：通过。
- `npm test`：通过，14 个测试文件、164 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `npm run login` 使用 headed 持久化 context，由用户手工输入账号、密码及验证码。
- 程序没有读取或保存明文密码，也没有直接调用登录 API。
- 浏览器 profile 路径来自配置，`.auth/` 已被 Git 忽略。
- `npm run login -- --check` 实现独立的登录健康检查。
- 使用临时未登录 profile 完成真实浏览器冒烟：浏览器成功启动，健康检查正确报告登录失效。
- 使用临时未登录 profile 打开真实购票入口，正确跳转并识别为 `login_required`。
- performance ID 可以组装为官方 transaction URL。
- 状态识别逻辑和影院相关选择器集中在适配器目录。
- 没有选座、锁座、票种选择或付款代码。

## 必须修复

### D-00：自行拼接的 `redirect_uri` 导致真实登录页报错

严重度：关键
状态：已修复并复验通过

用户执行 `npm run login` 后，弹出的浏览器在登录页显示：

```text
現在アクセス集中により混雑しております。
ご迷惑をおかけし誠に申し訳ございせん。
お手数ですが時間をあけて再度お試しください。
イベント情報取得エラー [E-ID: 8c1606a6][didMountAuthPage]
```

用户在同一个弹出浏览器中删除 URL 的 `redirect_uri` 查询参数后即可正常登录。当前代码则在 `scripts/login.ts`、`buildLoginRedirectUrl()` 和 `checkLogin()` 中主动拼接：

```text
https://login.member.cinemasunshine.co.jp/auth?redirect_uri=https%3A%2F%2Fwww.cinemasunshine.co.jp%2F
```

因此，现有直接证据指向：我们猜测并构造的 `redirect_uri` 值或调用方式不符合认证站约定，触发了 `didMountAuthPage` 错误；并非真实的全站拥堵。

此前发现的自定义 User-Agent 和 Playwright Chromium 仍是不必要的兼容性风险。当前实现已改为系统 Chrome 且不再覆盖 UA，但它们不再视为此次错误的首要根因。

#### 修复要求

1. `npm run login` 直接打开已由用户验证可用的 `/auth` 地址，不得自行附加未经确认的 `redirect_uri`。
2. `checkLogin()` 也不得继续依赖当前错误的 URL。应通过已验证的认证入口或受保护页面判断登录状态，并防止“错误页离开 auth host”被误判为登录成功。
3. 删除或收紧 `buildLoginRedirectUrl()`，避免其他调用点重新生成错误地址。
4. 保留系统 Chrome、原生 User-Agent 和项目专属持久化 profile；不得操作用户日常 Chrome profile，也不得加入 stealth 逻辑。
5. 更新现有 redirect URL 单元测试，并增加回归测试：默认人工登录 URL 不含 `redirect_uri`；错误页/拥堵页不能判定为登录成功。
6. 修复后由用户重新执行 `npm run login` 和 `npm run login -- --check`。认证页正常加载、登录状态成功持久化后，D-00 才算关闭。

注意：不要通过高频重试绕过该错误，也不要猜测另一个 redirect 参数值。若业务流程确实需要 redirect，应先从官网实际登录链接或网络跳转中确认协议。仍报错时，仅保留错误页 URL、页面标题及 E-ID，不得记录 Cookie/token。

### D-01：未识别官网已确认存在的异常路由（已修复）

严重度：关键
状态：已修复

此前对官网公开前端代码的观察已经确认以下路由：

```text
#/purchase/overlap   已存在临时交易/重复交易
#/expired            交易会话过期
#/congestion         拥堵/限流页
#/error              通用错误页
```

当前 `detectPurchasePageState()` 主要依靠正文日文关键字识别前三种状态，只对 `#/error` 做了 URL 检测。与此同时，任何包含 `#/purchase/` 的 URL 都会被判定为 `ready`。

因此：

- `#/purchase/overlap` 在正文尚未渲染或文案变化时会被错误判为 `ready`。
- `#/expired` 在正文尚未渲染时会被判为 `site_changed`。
- `#/congestion` 在正文尚未渲染时会被判为 `site_changed`。

这会让后续阶段在已有临时占座或会话失效时继续操作，属于安全和正确性问题。

#### 修复要求

1. URL 路由检测必须优先于宽泛的 purchase-ready 判断。
2. 至少增加以下确定映射：

```text
/#/purchase/overlap -> duplicate_transaction
/#/expired          -> session_expired
/#/congestion       -> congested
/#/error            -> error
```

3. 同时兼容带或不带 hash 的等价路径，但只能在 transaction 官方 host 上应用。
4. `ready` 只能用于明确的正常购票路由，例如 transaction/seat/ticket/input/confirm；不得让 overlap 自动落入 ready。
5. 添加正文为空时的路由回归测试。
6. 添加“异常路由正文同时含普通 purchase 文案”测试，异常状态必须优先。

### D-02：正常 ready 判断没有限制官方 transaction host（已修复）

严重度：高
状态：已修复

当前逻辑只要任意 URL 字符串包含 `/purchase/` 就可能返回 `ready`。例如未知或恶意域名上的 `/purchase/seat` 也会被当成正式购票页。

修复要求：

1. 返回 `ready` 前必须验证 `isTransactionHost(url)`。
2. 异常 transaction 路由同样应先验证官方 host。
3. 增加测试：`https://example.com/#/purchase/seat` 必须返回 `site_changed`。

### D-03：performance ID 未校验（已修复）

严重度：中
状态：已修复

`buildPurchaseUrl()` 当前直接拼接传入字符串。虽然 performance ID 正常来自官网排片，但错误输入、空值、斜杠、查询参数或完整 URL 都不应被接受。

修复要求：

1. 按当前已确认格式校验 performance ID。真实数据同时存在 23 位和 24 位数字 ID。
2. 非法输入抛出明确错误，且不得导航。
3. 增加空字符串、非数字、过短、过长、带 `/`、`?`、`#` 的测试。

## 建议修复

### D-04：正文关键字过宽，可能产生误判（已修复）

严重度：中
状态：已修复

当前模式包含单独的 `有効期限`、`セッション`、`しばらくお待ち`、`事前に確保` 等较宽文本。正常页面也可能出现票券有效期、加载提示或座位说明。

建议：

- URL 路由作为第一证据。
- 文本 fallback 使用更完整、具有唯一性的短语组合。
- 给正常购票正文包含“有効期限”等词但路由正常的场景增加防误判测试。

### D-05：补充 BrowserContext/Page 行为测试（已修复）

严重度：低
状态：已修复

当前单元测试覆盖 host、redirect、轮询和纯状态分类，但没有通过 fake Page 验证：

- `checkLogin()` 始终关闭临时 page。
- `openPurchase()` 使用登录 redirect，并在导航后返回 inspection。
- 导航失败时错误能向上传递，不会被误报为 site change。

建议使用最小 fake 对象或 Playwright 本地测试页补充，不需要访问官网。

## 用户参与的最终人工复验

用户已在弹出的 Chrome 中确认：删除旧实现附加的 `redirect_uri` 后可以正常登录。修复后的默认入口即为同一个无查询参数的 `/auth` 地址。

```bash
npm run login
npm run login -- --check
```

复验结果：

1. 无 `redirect_uri` 的认证页可以正常登录，不再出现 `didMountAuthPage` 错误。
2. 关闭人工登录浏览器后运行 `npm run login -- --check`，实际输出 `登录有效`，退出码为 0。
3. 使用全新临时 profile 运行同一检查，实际输出登录失效，退出码为 2，证明未登录状态没有被误判。
4. `.auth/` 被 `.gitignore` 命中，Git 状态中没有 Cookie、token、profile 或截图文件。

## 最终自动验收结果

2026-09-25 修复后重新执行：

- `npm run typecheck`：通过。
- `npm test`：通过，14 个测试文件、164 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- 系统 Chrome + 临时未登录 profile 冒烟：通过，正确返回登录失效。
- 系统 Chrome + 用户持久化 profile 健康检查：通过，正确返回登录有效。
- 敏感文件忽略检查：通过，`.auth/` 未进入 Git。

## Worker 执行步骤

1. 阅读 `IMPLEMENTATION_PLAN.md`、本报告及阶段 D 当前实现。
2. 优先修复 D-00、D-01、D-02、D-03，并增加要求的回归测试。
3. 建议同时修复 D-04、D-05。
4. 不实现选座、临时锁座或付款。
5. 运行：

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

6. 使用临时未登录 profile 执行安全冒烟：

```bash
BROWSER_PROFILE_DIR=/tmp/cinema-assist-d-check npm run login -- --check
```

预期输出登录失效，并且不创建仓库内认证文件。

7. 报告修改文件、测试结果、冒烟结果以及人工登录是否已由用户完成。

## 正式通过条件

- D-00、D-01、D-02、D-03 均修复并有回归测试。
- 默认登录入口不再携带未经确认的 `redirect_uri`；弹出的系统 Chrome 能正常加载认证页，不再出现 `didMountAuthPage` 事件信息获取错误。
- 异常 URL 路由在正文为空时仍能正确分类。
- 非官方 host 不能被分类为 ready。
- 非法 performance ID 被拒绝且不会导航。
- typecheck、test、lint、format check 全部通过。
- 临时未登录 profile 冒烟正确返回 login_required。
- 没有敏感信息进入 Git。
- 没有混入阶段 E 或更后的功能。
- 用户手工登录持久化复验完成，或明确记录为待用户确认。
