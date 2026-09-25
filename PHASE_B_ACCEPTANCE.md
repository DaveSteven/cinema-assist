# 阶段 B 验收报告

验收日期：2026-09-25  
初次验收结论：**未通过。存在一个会导致开售前被错误标记为已开售的关键问题。**  
复验结论（2026-09-25）：**已通过。B-01、B-02、B-03 均已修复并验证。**

## 复验记录

- 已改为使用 `validFrom` / `validThrough` 判断公众销售窗口。
- 已保留独立的会员销售窗口 `validFromForMembers` / `validThroughForMembers`。
- 缺失明确开始时间时采取保守的 `not_open` 状态。
- 已增加开售前、公众开售、销售结束、会员提前开售和字段缺失回归测试。
- 已增加超时、网络异常和 `maxRetries=0` 测试。
- 非法 JSON 已统一包装为带请求路径的 `ScheduleValidationError`。
- 复验命令全部通过：typecheck、69 个测试、lint、format check。
- 官网未来场次只读复验：2026-09-29 场次在 2026-09-25 的公众视角正确返回 `not_open`；公众窗口为 9 月 27 日 00:00 JST，会员窗口为 9 月 26 日 20:30 JST。

## 验收范围

- Cinema Sunshine 公开排片 JSON 客户端。
- Zod schema 及未知字段保留。
- 官网数据到内部 `Screening` 的标准化。
- 标题、日期、规格和时间范围筛选。
- 404、重试、限流和格式错误处理。
- 离线 fixture 与单元测试。
- 当前官网公开数据的只读冒烟验证。

## 已通过项目

- `npm run typecheck`：通过。
- `npm test`：通过，5 个测试文件、57 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- 已实现以下公开 JSON 客户端：
  - `/schedule/data/schedule.json`
  - `/schedule/data/theaters.json`
  - `/schedule/data/maintenance.json`
  - `/schedule/data/{movieCode}/{theaterCode}/{YYYYMMDD}.json`
- 请求包含超时、User-Agent、cache buster、有限重试、指数退避和随机抖动。
- 单日排片 404 返回 `null`，不会被当作程序崩溃。
- 429 和 5xx 会有限重试，403 不会重试。
- Zod 使用 loose object，未知字段能够保留用于诊断。
- 已实现标题、正则、日期、规格包含/排除和开始时间范围筛选。
- 已实现 performance ID 和购票 URL 提取。
- 时间统一转换为 `Asia/Tokyo` 的 ISO 字符串。
- fixture 测试完全离线，不依赖官网。
- 使用当前官网数据完成只读冒烟测试：成功发现池袋影院 39 部影片，并成功解析真实场次及 performance ID。
- 没有混入登录、选座、锁座或付款逻辑。

## 必须修复

### B-01：使用了错误的开售时间字段

严重度：关键  
状态：待修复

当前 `normalizeDaySchedule()` 将下列字段传给 `classifySalesStatus()`：

```ts
availabilityStarts: entry.offers?.availabilityStarts
```

但官网真实数据表明：

- `availabilityStarts`：排片信息开始可见的时间。
- `validFrom`：普通用户在线购票开始时间。
- `validFromForMembers`：会员购票窗口中的最早开始时间；当前数据对应 PLATINUM 的 20:30。
- BRONZE/GOLD 的 21:00 条件还会出现在 `additionalProperty` 的 `standardMemberConditions` 中。
- `validThrough` / `validThroughForMembers`：相应销售窗口结束时间。

2026-09-25 对官网未来场次进行只读验证，得到：

```json
{
  "targetDate": "2026-09-29",
  "availabilityStarts": "2026-09-23T00:00:00+0900",
  "validFrom": "2026-09-27T00:00:00+0900",
  "validFromForMembers": "2026-09-26T11:30:00.000Z",
  "reportedStatusAt2026-09-25": "open"
}
```

在 9 月 25 日时，普通用户正确状态应为 `not_open`，代码却返回 `open`。这会使后续监听器提前两天启动购票流程，属于阻断阶段 B 的功能错误。

#### 修复要求

1. 不再使用 `offers.availabilityStarts` 判定是否已开售。
2. 默认/公众销售状态使用 `offers.validFrom` 和 `offers.validThrough`。
3. 不要把所有会员统一为一个开售时间：
   - 至少保留 `validFromForMembers`，供后续 PLATINUM 模式使用。
   - 保留 `additionalProperty`，后续阶段可解析 `standardMemberConditions`。
4. 阶段 B 可以采用以下任一设计：
   - 给 `normalizeDaySchedule` 增加明确的销售受众参数；或
   - 在 `Screening` 中保存不同受众的销售窗口，再由调用方计算状态。
5. 禁止根据固定的“三天前 20:30”覆盖官网字段；特殊场次必须尊重官网返回值。
6. 当 `validFrom` 缺失时采取保守策略：不得仅因排片已经可见便报告 `open`。应根据明确的可购状态/购票 ID 设计 fallback，并写测试说明。

#### 必须增加的回归测试

```text
availabilityStarts 已过、validFrom 未到           -> not_open
公众 validFrom 已到、validThrough 未到            -> open/few/sold_out
validThrough 已过                                 -> ended
PLATINUM 会员窗口已到、公众窗口未到                -> 会员视角 open，公众视角 not_open
缺失 validFrom                                    -> 保守结果，不可误报 open
```

修复现有 fixture 测试中的错误预期：fixture 的 `now=2026-09-10`、`validFrom=2026-09-16` 时不应期待 `open`。

#### 验收标准

- 9 月 29 日示例场次在 9 月 25 日的公众视角返回 `not_open`。
- 到达 `validFrom` 后才返回 `open`、`few` 或 `sold_out`。
- 全部新增回归测试通过。
- 原有 typecheck、lint、format 和其余测试继续通过。

## 建议改进

### B-02：补充超时与网络异常测试

严重度：低  
状态：建议

客户端已经实现 `AbortController` 超时和通用网络错误重试，但现有测试没有验证：

- 请求超时后会终止。
- 网络异常会按 `maxRetries` 重试并最终抛出原始错误。
- `maxRetries=0` 时只请求一次。

建议加入 fake fetch/fake timer 测试，防止后续重构破坏超时行为。

### B-03：统一无效 JSON 的错误类型

严重度：低  
状态：建议

结构不匹配会抛出 `ScheduleValidationError`，但响应不是合法 JSON 时最终会抛出原始 `SyntaxError`。建议将非法 JSON 也包装为包含请求路径的诊断错误，便于判断是站点改版还是短暂代理错误。

## Worker 执行步骤

1. 阅读 `IMPLEMENTATION_PLAN.md`、本报告及阶段 B 当前实现。
2. 优先只修复 B-01，并增加要求的回归测试。
3. 可以顺带完成 B-02、B-03，但不得开始阶段 C。
4. 不加入登录、浏览器、座位或锁座代码。
5. 不在测试中高频请求官网；单元测试必须继续使用 fixture/fake fetch。
6. 完成后运行：

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

7. 使用官网当前一条未来场次做一次只读冒烟验证，确认 `validFrom` 之前为 `not_open`。
8. 报告修改文件、测试结果、冒烟结果和残留问题。

## 正式通过条件

- B-01 已修复且回归测试完整。
- 当前官网真实未来场次不会提前报告 `open`。
- 404 仍返回 `null`。
- performance ID、购票 URL、JST 时间和筛选结果保持正确。
- typecheck、test、lint、format check 全部通过。
- 未混入阶段 C 或更后面的功能。
