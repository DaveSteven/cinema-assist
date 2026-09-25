# 阶段 F 验收报告

验收日期：2026-09-25

结论：**通过。经过五轮修复和复验，assist 已能在真实场次中完成严格页面核验、只读座位推荐和完整高亮，并安全交给用户接管。**

## 验收范围

- `mode: assist` 在目标场次开售后启动可见浏览器。
- 复用持久化会员登录状态。
- 打开正确场次并只读解析座位。
- 按 WatchRule 推荐座位并仅做视觉高亮。
- 通知用户接管浏览器。
- 不点击座位、不提交下一步、不锁座、不选择票种、不付款。

## 已通过项目

- `npm run typecheck`：通过。
- 初次验收 `npm test`：通过，19 个测试文件、234 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- `WatchService` 能在排片 open 后调用 assist handler，并把成功状态映射为 `user_action_required`。
- `SeatAssistService` 会把规则中的票数、连座、排数、座号、座位类型、附加费及过道偏好传入评分器。
- 规则与排片对象不匹配时，不打开购票页面。
- 登录失效、交易过期、拥堵、重复交易和站点变化会停止 assist。
- 银幕方向未知、没有满足规则的座位组时不会高亮。
- 高亮实现仅注入 banner、outline 和 `data-cinema-assist` 属性；代码中没有座位 click、条款勾选、下一步或锁座动作。
- `assist_ready` 通知包含场次、座号、座位类型、价位区和附加费。
- `mode: hold` 仍被明确拒绝，没有越界实现 G 阶段。

## 真实浏览器只读验收

使用临时数据库创建真实 assist 规则：

```text
电影：ハート・オブ・ビースト
日期：2026-09-25
时间：17:00–17:30
票数：2
模式：assist
```

目标 performance ID 与官网当日排片一致。执行 `watch run` 两次，均未点击或锁定座位，但都没有到达高亮成功状态：

1. 第一次在 assist 导航时失败：`page.goto: Target page, context or browser has been closed`。
2. 第二次捕获到 API 可售数 281，但 DOM 解析为 0，报错：`座位状态计数不一致：接口 281，解析 0`。
3. 两次均输出 `Watch finished: error`，但进程退出码仍为 0。

E 阶段相同场次的独立 dry-run 可以稳定解析座位，说明场次、登录和站点本身可用；问题位于 assist CLI 的 page 生命周期或 DOM 就绪等待。

## 必须修复

### F-01：真实页面业务字段没有二次核验

严重度：关键

当前 `verifyScreeningMatchesRule()` 只验证来自排片 JSON 的 `Screening` 对象。进入 transaction 页面后，没有重新读取并核对页面实际显示的：

- 电影名；
- 日期；
- 开始时间；
- 影院/影厅；
- 放映规格。

实施计划要求任何字段不匹配都立即停止。只验证导航前对象无法防止 performance ID 拼接错误、站点错误跳转或页面状态串场。

修复要求：

1. 增加只读的购票页元数据解析器，保留官网原始文本。
2. 高亮前同时核对 performance ID/URL、电影、日期、时间、影院、影厅和规格。
3. 任一字段缺失或不匹配时返回 `site_changed` 或 `no_match`，不得高亮。
4. 添加完全匹配、每个字段分别不匹配、字段缺失及错误 performance ID 测试。

### F-02：没有等待座位 DOM 稳定，真实 assist 解析到 0 个座位

严重度：关键

assist 捕获 seat-state API 后立即调用 `readSeatMap()`。真实复验中 API 已报告 281 个可售座位，但 DOM 仍为 0，触发计数不一致。

修复要求：

1. 在读取座位图前等待座位页路由和座位选择器可见。
2. 等待条件应包括：DOM 至少存在一个可解析座位，且 API/DOM 合并计数一致；使用有限超时。
3. 允许页面渲染过程中的短暂计数不一致进行少量只读重读，但不得重新导航或创建第二个交易会话。
4. 超时后安全返回 `site_changed`/明确错误，不得误报售罄。
5. 增加“API 先到、DOM 后渲染”和 DOM 永不出现的 fake Page 测试。

### F-03：浏览器 page 生命周期不稳定

严重度：高

第一次真实复验在 `page.goto()` 时得到 `Target page, context or browser has been closed`。当前 CLI 在登录健康检查后从 `context.pages()[0]` 取页面，缺少 `isClosed()` 检查和稳定的专用 assist page 生命周期。

修复要求：

1. 登录检查完成后显式创建一个新的专用 assist page，或验证复用 page 未关闭。
2. 不得复用 `checkLogin()` 创建并关闭的临时 page。
3. 浏览器或页面被用户关闭时返回明确的 cancelled/error 状态，不得重开并自动重复交易。
4. 添加 page 已关闭、context 已关闭和正常 page 的行为测试。

### F-04：没有验证实际高亮命中数量

严重度：高

`highlightSeats()` 返回 `void`。即使 DOM 选择器失效或座位 label 不匹配，`SeatAssistService` 仍会返回 `user_action_required` 并发送“assist 已就绪”。

修复要求：

1. `highlightSeats()` 返回实际命中的唯一座位 label。
2. 命中集合必须与推荐座位集合完全一致。
3. 少一个、多一个或重复元素都应安全失败，不得发送 `assist_ready`。
4. 重复调用时先清理旧 banner/outline，避免错误地保留上一次推荐。
5. 增加零命中、部分命中、重复 DOM、完全命中测试。

### F-05：失败运行仍以退出码 0 结束

严重度：中

真实运行已经输出 `Watch finished: error`，shell 退出码却为 0，外部脚本无法判断 assist 失败。

修复要求：

1. `error`、`site_changed`、`login_required`、`session_expired`、`congested`、`duplicate_transaction` 等失败终态设置非 0 退出码。
2. `user_action_required` 正常结束或用户正常接管时保持成功语义。
3. 增加 CLI 退出码测试。

## 建议修复

### F-06：CLI 帮助仍称 assist 尚未实现

帮助文本目前写着：

```text
--mode <notify> notify (assist/hold arrive in a later phase)
```

应更新为当前实际支持的 `notify | assist`，并继续明确 `hold` 尚未开放。

### F-07：浏览器被手动关闭后的等待体验

成功进入 `user_action_required` 后，CLI 只等待 SIGINT/SIGTERM。如果用户直接关闭浏览器窗口，命令可能继续等待。建议同时监听 context/page close 并正常结束。

## Worker 执行步骤

1. 阅读 `IMPLEMENTATION_PLAN.md`、`PHASE_E_ACCEPTANCE.md` 和本报告。
2. 优先修复 F-01～F-05并增加回归测试。
3. 同时修复 F-06、F-07。
4. 严格保持 assist 只读：不得点击座位、条款或下一步，不得产生临时锁座。
5. 运行：

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
git diff --check
```

6. 使用临时数据库和一个仍可售的真实低风险场次执行 headed assist 冒烟。
7. 人工确认页面电影/日期/时间/影厅与规则一致，推荐座位实际被高亮；随后直接关闭浏览器。
8. 报告退出码、是否有任何座位被选中，以及是否产生临时座位授权。

## 正式通过条件

- F-01～F-05 全部修复并有回归测试。
- 真实场次可以稳定到达 `user_action_required`。
- 页面业务字段经过二次核验且与规则一致。
- 推荐座位全部且仅有这些座位被高亮。
- 用户关闭浏览器或按 Ctrl+C 后程序能正常结束。
- 失败终态具有非 0 退出码。
- 全部自动检查通过。
- 全程没有点击座位、锁座、选票种或付款。

## 第二轮复验（2026-09-25）

结论：**仍未通过。F-02 的真实浏览器问题仍可复现；F-01 的 performance ID 核验不完整。**

### 自动检查

- `npm run typecheck`：通过。
- `npm test`：通过，21 个测试文件、250 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。

### 已确认修复

- F-03：登录检查后显式创建专用 assist page，并检查 page 是否关闭。
- F-04：高亮返回实际命中的 labels；零命中、部分命中或重复命中不会进入 `user_action_required`；旧高亮会先清理。
- F-05：真实失败状态现在以退出码 1 结束。
- F-06：CLI 帮助已改为 `notify | assist`，并明确 hold 尚未开放。
- F-07：成功等待接管期间会监听 browser context close。
- 新增购票页元数据解析，已核对标题、日期、开始时间、影厅、影院和放映规格。

### 尚未关闭：F-01 performance ID 核验不完整

官网交易 URL 的 performance ID 位于路径：

```text
/projects/sskts-production/purchase/transaction/{performanceId}
```

当前 `readPurchaseMeta()` 只读取查询参数 `?performanceId=`。真实官网 URL 没有该查询参数时，`performanceIdFromUrl` 为 `undefined`；`verifyPurchaseMeta()` 又只在字段存在时比较，因此真实页面没有核对 ID。

修复要求：

1. 从官方 transaction URL path 提取 ID，并要求它必须存在且与目标完全一致。
2. 仅允许官方 transaction host 和已确认的路径格式。
3. ID 缺失、host 错误、路径错误或 ID 不匹配均安全停止。
4. 添加官网真实路径、query 干扰、非官方 host、缺失 ID和错误 ID 测试。

### 尚未关闭：F-02 真实 assist 仍无法到达高亮

使用明日仍可售的真实场次重新建立临时 assist 规则。程序正确找到 performance ID 并开始 assist，但约 27 秒后返回：

```text
监听出错：site_changed
Watch finished: site_changed
```

退出码为 1。该耗时与座位 DOM 的 20 秒等待加布局等待接近，且没有出现 `assist_ready`，因此真实 headed 流程仍未稳定取得座位 DOM/高亮。

worker 下一步应：

1. 为 `waitForSeatMap()` 增加不含敏感信息的诊断结果：最后一次 DOM 座位数、API 可售数、当前 URL、是否找到 seat selector；不得只返回泛化的 `site_changed`。
2. 在专用 page 导航前调用 `bringToFront()`，并等待明确的座位路由及 seat selector attach/visible 后再轮询合并结果。
3. 查明真实页面为何在 assist 中与独立 dry-run 行为不同；不得仅延长超时掩盖问题。
4. 修复后再次用真实场次验证，必须看到 `assist_ready` 和实际高亮，随后关闭浏览器结束。

### 第二轮安全结论

- 没有点击或选择座位。
- 没有勾选条款、点击下一步或产生临时锁座。
- 没有进入票种或付款流程。

## 第三轮复验（2026-09-25）

结论：**仍未通过，但真实失败原因已明确定位为可售座位计数口径错误。**

### 自动检查

- `npm run typecheck`：通过。
- `npm test`：通过，21 个测试文件、258 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。

### performance ID 修复复核

- 已能从官方 transaction path 捕获 23/24 位 performance ID。
- ID 缺失或与排片不一致时，`verifyPurchaseMeta()` 会拒绝继续。
- 非官方 host、错误路径、缺失 ID 和错误 ID 已有测试。

仍建议移除“官方 host 任意 path + `?performanceId=`”的宽松兼容，只认可已确认的 transaction path；但在当前程序由自身构造官方入口的前提下，这不再单独作为 F 阶段阻断项。

### 真实场次结果

真实 headed assist 已做到：

- 进入 `#/purchase/seat`；
- 找到 352 个 seat DOM 元素；
- 解析 348 个带标准座号的座位；
- API 报告可售 264；
- 程序映射到 DOM 的可售座位为 263；
- 最终安全返回 `site_changed`，退出码 1，没有高亮或点击。

诊断输出：

```text
seat map timeout
url=https://transaction.ticket-cinemasunshine.com/#/purchase/seat
domSeats=352 parsedDom=348 available=263 apiFree=264 expected=264
```

### F-02 剩余根因：把不可映射可售座位计入 DOM 可映射总数

`parseSeatState()` 已记录 `unmappableFree`，例如 `車椅子1` 不能由当前 `A1` 形式的解析器生成 key。当前 `expectedAvailableCount()` 却仍直接返回 `cntReserveFree`，并有一个测试明确要求忽略 `unmappableFree`：

```ts
expected DOM available = cntReserveFree
```

当不可映射座位处于可售状态时，DOM 标准座号可售数必然少于 API 总数，真实 assist 因此永久等待到超时。本次差值正好为 1，与该模型一致。

修复要求：

1. 分开验证两个不变量：
   - API 内部：`availableKeys.size + unmappableFree === cntReserveFree`；
   - DOM 合并：映射后的可售数应等于 `availableKeys.size`。
2. 不可映射座位必须继续标为未知且绝不参与推荐，但不能阻止其他标准座位的 assist。
3. 检测重复 API seat key，避免 Set 去重掩盖响应异常。
4. 修改当前“uses cntReserveFree directly”测试，并新增真实场景：总可售 264、可映射 263、不可映射 1，应成功进入 ready。
5. 诊断输出增加 `mappedApiFree` 和 `unmappableFree`，方便后续站点变化排查。
6. 修复后再次运行同一真实场次，必须进入 `user_action_required` 并实际高亮完整推荐组。

### 第三轮安全结论

- 没有点击或选择座位。
- 没有创建临时座位授权。
- 没有进入票种或付款流程。

## 第四轮复验（2026-09-25）

结论：**仍未通过。座位计数问题已越过，真实流程在页面标题的日文宽度/格式别名差异处安全停止。**

### 自动检查

- `npm run typecheck`：通过。
- `npm test`：通过，21 个测试文件、260 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。

### F-02 真实计数复核

修复后的真实 assist 不再因 264/263/1 的可售座位计数而超时，已经继续到购票页元数据核验。这证明主流程已按 `availableKeys.size` 对可映射 DOM 座位进行核对。

但 API 内部一致性仍需补齐：

1. 必须验证 `availableKeys.size + unmappableFree + duplicateFreeKeys === cntReserveFree`，或者在确认重复 key 不计入总数的真实协议后采用对应公式；不能接受明显自相矛盾的 fixture。
2. `duplicateFreeKeys > 0` 默认应视为无效响应并安全停止，除非真实脱敏 fixture 证明重复具有合法语义。
3. 当 `availableKeys.size === 0` 且只有不可映射座位可售时，DOM 期望值应为 0，而不是回退到 `cntReserveFree`。
4. 当前测试中 `countFree: 1`、`unmappableFree: 2`、`availableKeys.size: 1` 仍被视为 ready，这个测试数据内部不一致，应改为合法计数并新增不一致拒绝测试。

### 新阻断项 F-08：官网标题存在半角片假名和格式别名差异

真实页面二次核验结果：

```text
购票页：ﾊｰﾄ・ｵﾌﾞ・ﾋﾞｰｽﾄ【字幕】Atmos
排片 JSON：ハート・オブ・ビースト【字幕】Dolby Atmos
```

程序正确地没有高亮，但当前标题比较无法识别二者为同一场次。

修复要求：

1. 比较前使用 Unicode `NFKC` 统一半角/全角片假名、拉丁字符及数字。
2. 把作品核心标题与已确认的格式标签分开比较；不得使用无约束的包含关系或编辑距离模糊放行。
3. 建立小型、显式的格式别名表，例如经真实页面确认的 `Atmos` ↔ `Dolby Atmos`；字幕/吹替、IMAX、4DX 等仍必须精确核对。
4. 页面和排片中的核心作品标题必须在规范化后完全一致。
5. 增加本次真实标题对、半角/全角、Atmos 别名、字幕/吹替冲突、相似但不同电影名的测试。
6. 修复后再次运行同一真实场次，必须到达 `assist_ready` 并完整高亮推荐座位。

### 第四轮真实结果

```text
未找到匹配场次：
title "ﾊｰﾄ・ｵﾌﾞ・ﾋﾞｰｽﾄ【字幕】Atmos"
!= "ハート・オブ・ビースト【字幕】Dolby Atmos"
Watch finished: no_match
```

命令退出码为 1。没有点击、高亮错误座位、锁座、选票种或付款。

## 第五轮最终复验（2026-09-25）

结论：**通过。**

### 自动检查

- `npm run typecheck`：通过。
- `npm test`：通过，22 个测试文件、266 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。

### 已关闭问题

- 标题比较使用 Unicode NFKC，真实半角片假名能与排片全角片假名匹配。
- 核心作品名与格式标签分离比较，不使用宽泛包含或编辑距离放行。
- 经真实页面确认的 `Atmos` 与 `Dolby Atmos` 使用显式别名匹配。
- 字幕/吹替、IMAX 等格式冲突仍会拒绝。
- DOM 可售数按可映射 API key 核对；不可映射座位继续排除推荐。
- 重复 API seat key 会被视为不一致。
- 当没有任何可映射座位时，DOM 期望值为 0。
- 页面业务字段、官方 transaction URL 和 performance ID 均在高亮前核验。

### 真实 headed assist 结果

使用同一明日真实 BESTIA 场次执行 `watch run`，实际输出：

```text
assist 已就绪：ハート・オブ・ビースト【字幕】Dolby Atmos
2026-09-26T17:15:00+09:00 (JST)
シアター５ BESTIA | 字幕/BESTIA
推荐座位 [N15, N16] 类型 standard (+¥0)
Watch finished: user_action_required
```

人工观察确认程序停在座位页并进入等待接管状态。验收者随后发送 Ctrl+C：

```text
Cancelling...
```

程序以信号退出码 130 结束并关闭浏览器，符合主动中断语义。

### 最终安全结论

- 推荐的 N15/N16 均为普通席，附加费 ¥0。
- 程序只注入视觉高亮和提示 banner。
- 没有点击或选择座位。
- 没有勾选条款或点击下一步。
- 没有产生临时座位授权。
- 没有进入票种、个人信息或付款流程。

### 非阻断建议

`isSeatStateConsistent()` 目前允许 `mapped <= countFree <= mapped + unmappable`。这是兼容官网特殊座位计数口径的保守范围；后续若收集到更多脱敏真实 fixture，应进一步确认 `cntReserveFree` 是否始终严格等于两者之和，并在证据充分后收紧。

## Premium 锚点推荐调整复验（2026-09-25）

根据用户偏好，推荐策略调整为：存在 Premium Class 且规则只允许普通席时，优先其朝向银幕一侧的前 1～2 排；该区域没有合格连座时才回退到全厅几何评分。显式 `preferredRows` 仍具有更高优先级。

自动检查：

- `npm run typecheck`：通过。
- `npm test`：通过，22 个测试文件、269 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- 覆盖银幕在上/下、三人连座和锚点区域无候选时回退。

同一真实 BESTIA 场次复验：

```text
调整前：N15, N16
调整后：H21, H22
类型：standard
附加费：¥0
状态：user_action_required
```

H21/H22 成功完整高亮。随后使用 Ctrl+C 关闭浏览器，退出码 130；没有点击、选择或锁定座位。

## 银幕中心排序调整复验（2026-09-25）

Premium 前方第 1～2 排现作为同一优先区域，不再硬性按排距排序。算法读取银幕 SVG 在页面中的实际渲染中心和宽度，水平居中成为区域内的主要排序依据；紧邻 Premium 的第一排只保留 4 分小幅加分。

自动检查：

- `npm run typecheck`：通过。
- `npm test`：通过，22 个测试文件、270 个测试全部成功。
- `npm run lint`、`npm run format:check`、`git diff --check`：通过。
- CLI 集成测试改用 `node --import tsx`，消除了并行运行时的 tsx IPC 竞态。
- 新增“第一锚点排边缘座位 vs 第二锚点排居中座位”测试，居中座位胜出。

同一真实场次结果：

```text
固定排距优先：H21, H22
银幕中心优先：G16, G17
类型：standard
附加费：¥0
状态：user_action_required
```

G16/G17 成功完整高亮。随后使用 Ctrl+C 关闭浏览器，退出码 130；没有点击、选择或锁定座位。
