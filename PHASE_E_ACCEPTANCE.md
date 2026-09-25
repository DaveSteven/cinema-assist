# 阶段 E 验收报告

验收日期：2026-09-25

结论：**通过。只读座位解析、特殊价位约束、银幕方向识别和评分已完成自动测试及真实场次复验。**

## 验收范围

- 座位 DOM/API 只读适配器，不点击座位。
- 可售、不可售、轮椅位及特殊座位类型解析。
- 座位价位、附加费和原始价目文本保留。
- 单座/连座候选生成和评分。
- 默认排除高价座及附加费未知座位。
- WatchRule、SQLite migration 和 CLI 价格约束。
- 真实场次 dry-run，不锁座、不进入票种或付款流程。

## 已通过项目

- `npm run typecheck`：通过。
- `npm test`：通过，18 个测试文件、224 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- 实现中没有座位点击、条款勾选、下一步提交或锁座代码。
- WatchRule 默认 `allowedSeatTypes=["standard"]`、`maxSurchargeYen=0`。
- 不可售座位、轮椅位、未允许的座位类型、未知附加费及超过上限的座位均不会进入候选组。
- 连座要求相同行、连续座号、相同座位类型、相同价位区和相同附加费。
- 已覆盖单座、双连座、三连座、断号、不可售、轮椅位、特殊席、附加费上限和未知附加费测试。
- migration v2 能保存座位类型白名单、黑名单和最高附加费。

## 真实浏览器只读验收

使用已登录的项目 Chrome profile，对 2026-09-25 池袋影院一个仍可售的 BESTIA 场次执行：

```bash
HEADLESS=true npm run dry-run -- --performance <真实场次 ID> --tickets 2
```

实际结果：

- DOM 座位总数：348。
- 首次验收时 API 可售及程序可选：280；修复后复验时为 281，均与 API 计数完全一致。
- 轮椅位：2。
- 识别 `grandClass`：Grand Class，附加费 ¥3,100。
- 识别 `premiumClass`：Premium Class，附加费 ¥1,600。
- 识别 `comfort`：Flat Seat，附加费未知。
- 识别 `standard`：普通席，附加费 ¥0。
- 默认推荐 5 组全部为普通席，未推荐高价或未知附加费座位。
- 修复后从真实影院 layout 数据识别银幕在上方（`screenY=90`、`seatStartY=383`），65% 目标位置为 K 排。
- 命令仅读取页面和网络响应，没有点击座位或产生临时座位授权。

另用一个已失效/不适用场次 ID 验证，程序正确停在官方 `#/error` 并退出，没有继续解析或操作。

## 已修复问题

### E-01：座位状态 API 超时被静默当成空座位数据（已修复）

严重度：关键

`scripts/dry-run.ts` 当前代码：

```ts
const seatState = (await capture.waitForSeatState(20_000)) ?? EMPTY_SEAT_STATE;
```

如果响应监听时机、接口路径或站点结构发生变化，程序会继续读取 DOM，把所有座位标成不可售，输出“无可推荐座位”，并以成功状态结束。这会把适配器故障误报成售罄。

修复要求：

1. 超时必须抛出明确的 `SeatStateUnavailableError` 或返回 `site_changed`，退出码非 0。
2. 不得用空集合继续评分。
3. 若 API 提供 `cntReserveFree`，必须与合并后的可售座位数核对；不一致时停止并报告适配器异常，不得给出推荐。
4. 增加 API 超时、无效 JSON、计数不一致和正常零余票的测试，四种情况必须可区分。

### E-02：评分假设 DOM Y 轴方向，没有识别银幕方向（已修复）

严重度：高

`buildRowInfos()` 直接按 `y` 从小到大排序，并把该顺序视为从银幕向后。实施计划明确要求不能假设 DOM 顺序或坐标方向，必须读取银幕标记确认。

这可能把“距银幕后方 65%”计算到错误排，真实 dry-run 中 F/G/P 排同时接近最高分，也说明需要对真实布局方向和坐标做可视核验。

修复要求：

1. 从页面读取 `SCREEN` 标记的位置或稳定的等价布局信息。
2. 明确判断座位 Y 轴靠近/远离银幕的方向后再计算目标排。
3. 无法判断银幕方向时不得输出带位置评分的推荐，应返回 `site_changed`/明确错误。
4. fixture 至少覆盖银幕在上、银幕在下、DOM 顺序相反三种布局。
5. dry-run 输出识别到的银幕方向、目标排及判断依据，便于人工核对。

### E-03：价位汇总会合并同类型的不同价位区（已修复）

严重度：高

`summarizeSeats()` 的 Map 仅以 `seat.seatType` 为 key。若同一个 seatType 在页面上存在不同 `priceCategory` 或 `surchargeYen`，后出现的座位会被合并到第一种价格下，CLI 汇总会显示错误。

修复要求：

1. 汇总 key 至少包含 `seatType + priceCategory + surchargeYen`。
2. 未知价格必须作为独立类别展示。
3. 增加“同 seatType、两个附加费”和“同 seatType、已知/未知价格”测试。

### E-04：dry-run 数值参数校验不完整（已修复）

严重度：中

- `--tickets 0` 当前会被接受，但 WatchRule 的有效范围是 1..6。
- `--target-row-ratio` 可接受 `NaN`、负数及大于 1 的值，随后产生无意义评分。
- `--top 0` 虽不会产生危险操作，但与“最佳 N 组”的用途不符。
- `--adjacent` 除字符串 `false` 外的任何值都被当作 true，拼写错误不会报错。

修复要求：

1. `--tickets` 限制为 1..6。
2. `--target-row-ratio` 必须是 0..1 的有限数。
3. `--top` 必须是正整数，并设置合理上限。
4. `--adjacent` 只接受明确的 true/false 值。
5. 为所有边界和非法值增加 CLI/纯函数测试。

## 建议修复

### E-05：页面选择器没有完全复用 selectors.ts（已修复）

`SELECTORS.seat` 已定义，但 `readSeatMap()` 仍在 `page.evaluate()` 内硬编码 `div.seat` 和 `.seat-types li`。建议将选择器作为 evaluate 参数传入，保持站点改版时的单点维护原则。

### E-06：真实 fixture 和视觉证据不足（已修复）

当前 `seats-standard.json` 是标准化后的人工数据，不能证明原始 DOM、API schema 和银幕布局适配。建议在不含 Cookie/token/个人信息的前提下保存：

- 脱敏后的真实 seat-state JSON fixture。
- 脱敏后的座位 DOM/legend fixture。
- 至少一个普通厅和一个含多价位特殊席的 fixture。

真实截图只用于本地验收，不应默认提交；验收报告记录人工对照结果即可。

修复后已加入脱敏的真实 seat-state、座位 DOM/legend 和 theater layout fixture，并在单元测试中验证。

## 修复后最终复验

2026-09-25 再次执行全部检查及真实场次 dry-run：

- `npm run typecheck`：通过。
- `npm test`：通过，18 个测试文件、224 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- 真实场次 API 可售 281，程序解析可售 281，计数一致。
- layout 明确识别银幕方向为 `top`，目标排为 K。
- Grand Class ¥3,100、Premium Class ¥1,600、Flat Seat 未知附加费均正确分类。
- 默认推荐的 5 组全部为普通席 ¥0。
- 命令退出码为 0，全程没有座位点击或锁座动作。

## Worker 执行步骤

1. 阅读 `IMPLEMENTATION_PLAN.md` 和本报告。
2. 优先修复 E-01～E-04，并添加要求的回归测试。
3. 不实现点击座位、条款勾选、下一步、锁座、票种或付款。
4. 运行：

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
git diff --check
```

5. 使用已登录 profile 对一个仍可售场次执行只读 dry-run，核对：API 可售数、座位等级、价位、银幕方向、目标排及推荐结果。
6. 报告修改文件、测试结果、真实 dry-run 结果以及是否产生任何站点写操作。

## 正式通过条件

- E-01～E-04 全部修复并有回归测试。
- API 缺失或数据矛盾不会被误报成售罄。
- 银幕方向和目标排可解释、可验证，无法判断时安全失败。
- 不同价位区的汇总不会互相合并。
- 默认不会推荐高价或未知附加费座位。
- 所有检查和测试通过。
- 至少一个真实多价位场次的 dry-run 与页面人工观察一致。
- 全程不点击座位、不锁座、不执行付款相关动作。
