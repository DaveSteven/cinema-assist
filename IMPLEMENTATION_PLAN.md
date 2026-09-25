# Cinema Sunshine 抢票助手实施计划

## 1. 项目目标

构建一个仅供账号本人在本机使用的购票助手，首期只支持 Grand Cinema Sunshine 池袋（影院代码 `020`）。程序负责：

1. 监听指定电影、日期和放映规格何时出现在官网排片中。
2. 在开售时找到目标场次并进入购票流程。
3. 读取实时座位图，按照用户配置给可用座位或连座评分。
4. 自动选择得分最高的座位，勾选条款并点击“下一步”，取得临时座位授权。
5. 停在票种或用户信息页面，通知用户在可见浏览器中检查并手动完成付款。

首期明确不做：自动提交付款、绕过验证码或 3D Secure、并发囤座、多账号、转售、隐藏浏览器自动抢票。

## 2. 已确认的网站行为（2026-09-25 实测）

### 2.1 排片数据

官网首页是 Nuxt 页面，但排片数据来自公开 JSON：

- 总排片索引：`https://www.cinemasunshine.co.jp/schedule/data/schedule.json`
- 影院索引：`https://www.cinemasunshine.co.jp/schedule/data/theaters.json`
- 维护状态：`https://www.cinemasunshine.co.jp/schedule/data/maintenance.json`
- 单片单影院单日：`/schedule/data/{movieCode}/020/{YYYYMMDD}.json`

请求中可附加当前时间作为 `?v=` 防缓存参数，但不得用毫秒级高频轮询。

每个已开放场次会生成独立的 performance/transaction ID。例如观察到：

```text
02028847220260925311525
```

对应入口：

```text
https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/{performanceId}
```

不要硬编码示例 ID；它仅用于说明格式。

### 2.2 会员登录

人工登录入口为：

```text
https://login.member.cinemasunshine.co.jp/auth
```

2026-09-25 人工复验确认：自行给该地址附加完整官网 URL 形式的 `redirect_uri` 会触发 `didMountAuthPage` 事件信息获取错误；删除该参数后可以正常登录。除非以后从官网实际跳转中重新确认协议，否则不得自行拼接 `redirect_uri`。

应使用 Playwright 持久化浏览器目录，由用户首次手工登录；程序不得保存明文密码，也不得直接调用登录 API。

### 2.3 交易与锁座机制

购票前端是单页应用，主要流程路由为：

```text
/purchase/transaction
/purchase/seat
/purchase/ticket
/purchase/input
/purchase/confirm
/purchase/complete
```

已从实际网络行为和公开前端代码确认：

1. 打开 performance ID 后，前端调用 `POST /api/authorize/getCredentials`。
2. `transactionStartProcess` 创建交易会话。
3. 交易对象包含 `startDate` 和 `expires`，页面每秒计算倒计时；因此不可过早创建会话。
4. 用户在座位页点选座位只是前端选择。
5. 当用户已选座、勾选利用条款并点击“下一步”时，前端调用 `seatRegistrationProcess({ reservations })`。
6. 成功后进入 `/purchase/ticket`，并保存服务器返回的临时座位授权。
7. 数据中同时存在 `tmpSeatReservationAuthorization` 和最终的 `seatReservationAuthorization`；进入新流程时如果已有临时授权，会跳到 overlap 页面。
8. `purchaseRegistrationProcess` 出现在最终确认阶段，和临时锁座不是同一个动作。

结论：MVP 的“锁座成功”定义必须是 **`seatRegistrationProcess` 成功且页面进入 `/purchase/ticket`**，不能把“座位已点击”误报为锁座成功。

实际临时锁座时长由每次交易的 `expires` 决定，不应硬编码为固定分钟数。UI 必须展示页面上的剩余倒计时。

## 3. 技术选择

- Node.js 22+
- TypeScript（strict 模式）
- Playwright：登录、实时座位图、选座和锁座
- 原生 `fetch`：低频读取公开排片 JSON
- SQLite：监控规则、场次快照和运行日志
- Vitest：单元测试
- Zod：外部 JSON 与用户配置运行时校验
- Pino：结构化日志，默认脱敏
- 首版 UI：本地 CLI；第二阶段可增加只监听 `127.0.0.1` 的本地 Web UI

使用 Playwright DOM 自动化完成锁座，不复制或伪造内部写接口请求。内部接口容易变化，并且直接重放授权请求有更高的重复占座风险。

## 4. 建议目录结构

```text
src/
  cli.ts
  config.ts
  domain/
    screening.ts
    seat.ts
    watch-rule.ts
  adapters/
    cinemasunshine/
      schedule-client.ts
      schedule-schema.ts
      schedule-normalizer.ts
      browser-session.ts
      purchase-page.ts
      selectors.ts
  services/
    watch-service.ts
    sale-time-service.ts
    seat-ranking-service.ts
    hold-service.ts
    notification-service.ts
  persistence/
    db.ts
    migrations.ts
  notifications/
    console.ts
    telegram.ts
tests/
  fixtures/
  unit/
  integration/
scripts/
  inspect-schedule.ts
  login.ts
  dry-run.ts
data/
  .gitkeep
```

把 `data/`, `.auth/`, screenshots、trace、Cookie、token 和日志加入 `.gitignore`。

上表是目标结构，不是阶段 A 的一次性交付物。空目录由对应阶段首次添加实际文件时创建；只有运行时必须存在的 `data/` 保留 `.gitkeep`，其余目录不预先提交 `.gitkeep` 占位。

## 5. 核心数据模型

### WatchRule

```ts
type WatchRule = {
  id: string;
  enabled: boolean;
  theaterCode: "020";
  movieTitlePattern: string;
  targetDate: string;              // YYYY-MM-DD, Asia/Tokyo
  formatIncludes: string[];        // IMAX, 字幕, 4DX 等
  formatExcludes: string[];
  startTimeFrom?: string;          // HH:mm
  startTimeTo?: string;
  ticketCount: number;             // 1..6
  requireAdjacent: boolean;
  preferredRows?: string[];
  excludedRows?: string[];
  preferredSeatNumbers?: number[];
  aislePreference: "none" | "prefer" | "avoid";
  mode: "notify" | "assist" | "hold";
};
```

### Screening

```ts
type Screening = {
  performanceId: string;
  movieCode: string;
  movieTitle: string;
  theaterCode: string;
  screenName: string;
  formatLabels: string[];
  startsAt: string;
  endsAt?: string;
  salesStatus: "not_open" | "open" | "few" | "sold_out" | "ended";
  purchaseUrl?: string;
};
```

### Seat

```ts
type Seat = {
  section: string;
  row: string;
  number: number;
  label: string;
  available: boolean;
  selectable: boolean;
  wheelchair: boolean;
  specialType?: string;
  x?: number;
  y?: number;
};
```

## 6. 座位评分规则

先生成满足票数的候选组，再评分。连座必须属于同一 row/section，座号连续，并且每个座位均可选择。

默认分数：

```text
100
- 水平中心偏离比例 × 45
- 与目标排位置偏离比例 × 35
- 组内不连续：直接淘汰（requireAdjacent=true 时）
- 包含轮椅位：直接淘汰，除非未来明确支持
- 用户排除行：直接淘汰
+ 命中 preferredRows：15
+ 全部命中 preferredSeatNumbers：10
+/− 过道偏好：5
```

目标排默认设为从银幕向后 65% 的位置，但必须允许用户按影厅覆盖配置。不要假设所有厅的 DOM 顺序都是从前到后；首次解析影厅时同时读取屏幕标记和座标确认方向。

评分函数必须纯函数化，并用 fixture 覆盖：单座、双连座、三连座、断号、过道、不可用座、轮椅位、奇偶布局。

## 7. 状态机

```text
CREATED
  -> WAITING_FOR_SCHEDULE
  -> WAITING_FOR_SALE
  -> PREPARING_BROWSER
  -> OPENING_TRANSACTION
  -> READING_SEATS
  -> SELECTING_SEATS
  -> SUBMITTING_HOLD
  -> HELD
  -> USER_ACTION_REQUIRED
  -> COMPLETED
```

异常终态：

```text
NO_MATCH
SOLD_OUT
LOGIN_REQUIRED
SESSION_EXPIRED
RATE_LIMITED
HOLD_CONFLICT
SITE_CHANGED
CANCELLED
```

每个状态转换记录时间、performance ID、选中座号和脱敏错误；不得记录认证头、Cookie、密码、信用卡信息或完整个人资料。

## 8. 轮询和开售调度

所有时间统一使用 `Asia/Tokyo`，禁止依赖机器本地时区。

建议策略：

- 距预计开售超过 6 小时：每 10 分钟读取一次排片索引。
- 6 小时至 10 分钟：每 2 分钟。
- 10 分钟至 1 分钟：每 30 秒。
- 最后 1 分钟：每 10 秒。
- 到点后尚未开放：每 3 秒，最多持续 2 分钟。
- HTTP 429、403 或连续错误：指数退避并加入随机抖动，禁止并发重试。

预计开售时间可作为提示，不能作为唯一真相。以目标场次出现可用 performance ID 且网站允许进入交易为准。

会员等级配置：

- PLATINUM：观影日 3 天前 20:30 JST
- BRONZE/GOLD：观影日 3 天前 21:00 JST
- 非会员：观影日 2 天前 00:00 JST

部分特殊场次时间不同，因此规则中允许 `saleOpensAtOverride`。

## 9. Playwright 自动化要求

### 登录脚本

`npm run login` 启动 headed Chrome 和持久化 profile：

1. 打开官方会员登录页。
2. 用户手工输入账号、密码以及可能的验证码。
3. 检测登录完成后保存 browser profile。
4. 输出“登录有效”，不打印 Cookie。

启动监控前执行登录健康检查；失效时通知用户并退出 hold 模式，不得自动反复提交密码。

### 选择器原则

优先级：

1. role/name 或稳定的表单标签；
2. `data-*` 属性；
3. 可访问文本；
4. 最后才使用 CSS class。

所有影院相关选择器集中在 `selectors.ts`，禁止散落在业务代码中。选择器失效时保存脱敏 screenshot 和 Playwright trace，然后进入 `SITE_CHANGED`。

### 锁座动作

1. 确认页面显示的电影、日期、时间和影厅全部匹配规则。
2. 读取座位图并标准化。
3. 对候选组排序。
4. 逐一尝试，最多 3 组；每组失败前重新读取座位状态。
5. 点击座位后校验 UI 中已选数量和座号。
6. 勾选利用条款。
7. 设置响应/页面导航监听后点击“下一步”。
8. 只有进入 `/purchase/ticket` 且页面列出的座号完全一致，才标记 `HELD`。
9. 读取并展示交易倒计时，立即发送通知。
10. 保持 headed 浏览器窗口打开，交给用户完成后续步骤。

任何不确定状态都不得自动重复点击“下一步”。先重新读取当前路由和已选座；避免重复临时占座。

## 10. 通知内容

首版实现 console，之后实现 Telegram。成功通知必须包含：

- 电影名、日期、时间、影厅/规格
- 座位号
- “已临时锁座，不是购买完成”
- 页面剩余倒计时
- 要求用户立即切换到浏览器完成票种、个人信息和付款

失败通知包含失败状态与可操作建议，不包含敏感请求数据。

## 11. 分阶段任务清单（小模型按顺序执行）

### 阶段 A：工程骨架

1. 初始化 npm + TypeScript strict 项目。
2. 安装 Playwright、Zod、Pino、SQLite 驱动、Vitest。
3. 添加 lint、format、typecheck、test 脚本；只声明当前已存在入口的命令，不提前暴露后续阶段脚本。
4. 创建 `.gitignore` 和明确需要的运行目录（`data/` 保留 `.gitkeep`）。其余目录在对应阶段首次添加实际文件时按需创建，不预先提交空目录或占位 `.gitkeep`。
5. 实现配置读取和示例 `.env.example`，但不要包含真实凭据。

验收：`npm run typecheck && npm test` 通过，Git 状态中不存在认证文件，且 `package.json` 中的每个脚本都指向已存在的入口。

### 阶段 B：排片客户端

1. 实现 JSON fetch、超时、重试和 User-Agent。
2. 用 Zod 校验并保留未知字段，以便网站调整时诊断。
3. 将原始数据标准化为 `Screening`。
4. 实现按标题、日期、格式和时间过滤。
5. 将测试 fixture 固定在仓库中，测试不得依赖在线网站。

验收：给定 fixture 能稳定选出目标场次和 performance ID；404 表示“未发布”，不会被当成程序崩溃。

### 阶段 C：监听器与 CLI

1. 实现 SQLite migration 和 WatchRule CRUD。
2. 实现 `watch add/list/run/disable` CLI。
3. 实现分级轮询、JST 调度、指数退避和单实例锁。
4. 实现状态变化通知，避免相同通知重复发送。

验收：使用 fake clock 可测试开售前后轮询频率；同一规则不能启动两个抢票任务。

### 阶段 D：浏览器会话

1. 实现 `npm run login` 的持久化 headed browser。
2. 实现登录有效性检查。
3. 实现由 performance ID 打开官方交易页。
4. 检测拥堵、过期、重复交易和登录失效页面。

验收：人工登录一次后，关闭并重启程序仍能识别会员登录；日志中无 Cookie/token。

### 阶段 E：座位读取与评分（先 dry-run）

1. 实现座位 DOM 适配器，只读，不点击。
2. 输出座位列表和布局摘要。
3. 实现候选组生成与评分。
4. `dry-run` 模式在座位图上打印最佳 5 组，但不选座。
5. 对不同屏幕 fixture 做单元测试。

验收：dry-run 截图中的可用座位与程序解析结果一致；评分测试全通过。

### 阶段 F：assist 模式

1. 自动打开正确场次和座位页。
2. 用高亮/日志指出推荐座位，但不点击“下一步”。
3. 通知用户接管浏览器。

验收：任何电影、日期、场次字段不匹配时立即停止；不会产生临时锁座。

### 阶段 G：hold 模式

1. 增加显式配置 `mode: hold` 和启动时二次确认。
2. 按第 9 节执行选座和 `seatRegistrationProcess`。
3. 进入票种页后验证座号、记录 `HELD`、通知用户。
4. 展示服务端交易倒计时。
5. 用户取消时优先使用页面的返回/取消流程；不伪造取消接口。

验收：只用一个低需求测试场次做一次人工监督测试；确认座位在退出或超时后释放。测试完成后不得留下正在占用的座位。

### 阶段 H：稳定性

1. 增加站点改版检测和 trace。
2. 增加 429/拥堵测试。
3. 增加进程崩溃恢复，但恢复后不得自动再次锁座。
4. 增加 Telegram 通知。
5. 写运行手册和故障排查文档。

验收：模拟每个异常终态，程序均有明确日志和通知；不会因重试产生第二个临时授权。

## 12. 测试矩阵

必须覆盖：

- 排片尚未发布、刚发布、已开售、售罄、停售。
- 标题相似但规格不同（字幕/吹替、IMAX/普通、4DX）。
- 单座和 2～6 连座。
- 首选座冲突后切换备选座。
- 登录过期、交易过期、拥堵、429、页面结构变化。
- 点击座位成功但“下一步”失败。
- 下一步成功但页面座号和预期不一致：必须停止并报警。
- 程序在 `HELD` 后崩溃重启：必须进入人工检查，不能再锁一次。

在线集成测试默认 `DRY_RUN=1`，CI 永远禁止 hold 和付款相关动作。

## 13. 安全与运行约束

- 仅允许一个账号、一个本地 profile、一个活跃 hold 任务。
- 不记录或上传 Cookie、token、密码、信用卡号、验证码。
- 不绕过 CAPTCHA、WAF、排队页、3D Secure 或访问限制。
- 不通过多个 IP、多个账号或并发请求提高成功率。
- 遇到 403/429 必须降频，不做对抗性规避。
- 不自动付款；最终购买由用户在可见浏览器中确认。
- 临时锁座后如果用户不准备购买，应尽快使用正常页面退出，不利用程序长期反复占座。

## 14. 完成定义

MVP 完成需同时满足：

1. 能配置并监听池袋影院的指定电影/日期/规格。
2. 能识别新场次及开售状态。
3. 能复用用户手工建立的会员登录状态。
4. 能解析座位、筛选连座并给出可解释评分。
5. dry-run、assist、hold 三种模式边界清楚。
6. hold 成功严格以进入票种页并核对座号为准。
7. 用户收到带倒计时的通知，付款必须人工完成。
8. 测试、类型检查通过，敏感信息没有进入仓库或日志。

## 15. 给执行模型的工作规则

每次只完成一个阶段。开始前先阅读本文件和现有代码；结束时必须：

1. 运行该阶段相关的 typecheck、unit tests 和安全的 dry-run。
2. 报告修改文件、测试结果、未解决问题。
3. 不猜测网站字段；无法确认时保存脱敏 fixture，并把解析逻辑做成可替换适配器。
4. 未经明确人工监督，不执行会产生真实临时占座的在线测试。
5. 绝不进入或提交最终购买确认页面。
