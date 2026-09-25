# 阶段 C 验收报告

验收日期：2026-09-25  
初次验收结论：**未通过。基础设施完整，但存在三项会导致实际监听结果错误的阻断问题。**  
复验结论（2026-09-25）：**正式通过。C-01 至 C-06 均已修复或完成并验证。**

## 复验记录

- C-01：WatchService 已按会员/公众选择销售窗口，并用规则等级或 override 对 `ready` 状态进行二次门控。
- C-01 回归覆盖 PLATINUM 20:29/20:30、BRONZE/GOLD 20:30/21:00、非会员和 override。
- C-02：已移除永久负缓存；每轮会重新读取候选电影的当日排片，同一 movieCode 后续新增规格可被发现。
- C-03：已优先选择 `open`/`few` 场次，其次等待 `not_open`；早场售罄不会掩盖晚场可购场次。
- C-04：通知只有发送成功后才加入内存去重集合；失败后可以重试。
- C-05：规则创建时已验证真实日历日期和可解析的开售 override。
- C-06：CLI 端到端测试已覆盖 add、list、disable、enable、remove 和不存在 ID 的失败退出码。
- 最终复验：typecheck、12 个测试文件、130 个测试、lint、format check 全部通过。
- 受限沙箱内 CLI 子进程曾因 `tsx` IPC 权限出现一次假失败；在正常权限下单测和全套测试均通过，不属于项目缺陷。

## 验收范围

- SQLite migration 和 WatchRule CRUD。
- `watch add/list/enable/disable/remove/run` CLI。
- JST 开售时间推算和分级轮询。
- 429/403/异常退避。
- 单进程及跨进程单实例锁。
- 状态事件与通知去重。
- 规则匹配和场次状态转换。
- 阶段边界：不得提前实现登录、选座和锁座。

## 已通过项目

- `npm run typecheck`：通过。
- `npm test`：通过，10 个测试文件、119 个测试全部成功。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- SQLite migration、WAL、外键、规则表和事件表已经实现。
- WatchRule 支持创建、读取、列表、启用、禁用、删除和运行时状态。
- CLI 使用临时数据库完成真实冒烟测试：成功创建并列出 PLATINUM、2 张票、IMAX/字幕、指定时间段的规则。
- JST 推算正确：
  - PLATINUM：观影日 3 天前 20:30。
  - BRONZE/GOLD：观影日 3 天前 21:00。
  - 非会员：观影日 2 天前 00:00。
- 分级轮询间隔和计划一致：10 分钟、2 分钟、30 秒、10 秒、3 秒。
- 429/403 会进入限流状态并指数退避；普通异常也会退避。
- 单实例锁同时覆盖同进程重复运行和跨服务实例重复运行。
- stale/corrupt lock 能被回收，锁文件名经过清理。
- 相同状态通知和事件不会在每次轮询重复写入。
- `assist` 和 `hold` 会明确拒绝，未提前实现浏览器或锁座。
- 日志配置包含 password、token、authorization、cookie 脱敏。

## 必须修复

### C-01：会员规则仍按公众销售窗口判断

严重度：关键  
状态：待修复

`WatchService.scan()` 调用：

```ts
normalizeDaySchedule(day, {
  movieCode,
  theaterCode: rule.theaterCode,
  now,
});
```

没有传递 `audience`，因此默认使用 `public`。`memberTier` 目前只影响预计开售时间和轮询频率，不影响真正的 `salesStatus`。

结果：PLATINUM 规则虽然会在 20:30 高频轮询，但在官网会员窗口已开放后仍返回 `waiting_for_sale`，直到公众窗口开放。

修复要求：

1. `memberTier !== "none"` 时按会员销售窗口标准化场次。
2. `memberTier === "none"` 时继续使用公众窗口。
3. 注意 BRONZE/GOLD 21:00 晚于 `validFromForMembers` 常见的 PLATINUM 20:30；不得在 20:30 就把 BRONZE/GOLD 标记为 `ready`。
4. 建议让 WatchService 同时结合官网会员窗口和 `expectedSaleOpensAtForRule()`：会员状态必须满足当前等级的开售时间，并尊重特殊场次官网数据。
5. `saleOpensAtOverride` 必须参与真实 ready 判断，而不只是改变轮询频率。

必须增加测试：

```text
PLATINUM：20:29 waiting_for_sale，20:30 ready
BRONZE/GOLD：20:30 waiting_for_sale，21:00 ready
非会员：会员窗口开放但公众窗口未开放 -> waiting_for_sale
saleOpensAtOverride 未到 -> waiting_for_sale；到点 -> ready
```

### C-02：不匹配的 movieCode 被永久缓存，后续排片更新无法发现

严重度：高  
状态：待修复

当前逻辑在某个 movieCode 本轮没有完整匹配时执行：

```ts
titleCache.set(movieCode, "");
```

之后每轮遇到该 code 都直接跳过：

```ts
if (titleCache.get(movieCode) === "") continue;
```

这里的“不匹配”包含标题、规格和时间范围。影院可能先发布一部分场次，稍后为同一电影补充 IMAX 场、夜场或其他规格；程序会因为第一次没有命中而永远不再读取该电影的当日 JSON。

修复要求：

1. 不得永久缓存“完整筛选无匹配”。
2. 最简单且正确的 MVP 修复是每轮重新读取所有候选 movieCode，最多受 `maxDayFetches` 限制。
3. 如果保留缓存，只能缓存不会随排片更新而改变的标题判断，并且必须设置短 TTL；规格、时间和场次列表不得永久缓存。
4. 添加测试：第一次 day JSON 无目标 IMAX 场，第二次同一 movieCode 增加 IMAX 场，第二轮必须发现并进入正确状态。

### C-03：最早场次售罄会掩盖后续可购场次

严重度：高  
状态：待修复

当前实现对所有匹配场次按时间排序后只检查第一个：

```ts
const target = sorted[0];
```

如果时间范围内 18:00 场售罄，但 21:00 场仍有票，程序会返回 `sold_out` 并终止监听，错误地忽略可购买的 21:00 场。

修复要求：

1. 在全部匹配场次中优先选择 `open` 或 `few`。
2. 没有可购场次时，再选择 `not_open` 继续等待。
3. 只有全部匹配场次均为 `sold_out`/`ended` 时，才进入终态。
4. 如果同时存在多个可购场次，按开始时间选择最早场次即可。
5. 增加测试：早场售罄、晚场 open 时必须返回 `ready` 并携带晚场 performance ID。

## 建议修复

### C-04：通知失败后不应在内存中标记为已发送

严重度：中  
状态：建议

`NotificationService.notify()` 当前先执行 `this.sent.add(key)`，再调用 notifier。如果 notifier 抛错，该 key 仍留在内存，后续相同通知不会再尝试发送。

建议在 notifier 成功后再加入 `sent`，并增加“第一次通知失败、第二次成功”的测试。Console notifier 通常不会失败，但后续 Telegram 会遇到网络错误。

### C-05：日期和开售覆盖值只做了表面格式检查

严重度：中  
状态：建议

- `targetDate` 只校验 `YYYY-MM-DD` 形状，`2026-99-99` 也能进入数据库。
- `saleOpensAtOverride` 只要求非空字符串，无效时间会在运行规则时才报错。

建议在创建规则时验证真实日历日期和可解析的带时区时间，并增加闰年、无效月份/日期和无效 override 测试。

### C-06：补充 CLI 端到端测试

严重度：低  
状态：建议

Repository CRUD 已有单元测试，人工 CLI add/list 冒烟也成功。建议增加使用临时数据库的 CLI 测试，覆盖 add、list、disable、enable、remove 及不存在 ID 的退出码。

## Worker 执行步骤

1. 阅读 `IMPLEMENTATION_PLAN.md`、本报告和阶段 C 当前实现。
2. 优先修复 C-01、C-02、C-03，并加入要求的回归测试。
3. 建议同时修复 C-04、C-05；C-06 可延后。
4. 不进入阶段 D，不添加会员登录或浏览器代码。
5. 单元/集成测试继续使用 fixture、fake clock 和 fake notifier，不高频访问官网。
6. 完成后运行：

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

7. 使用临时数据库执行 CLI 冒烟测试：add、list、disable、enable、remove。
8. 报告修改文件、测试结果和残留问题。

## 正式通过条件

- C-01、C-02、C-03 均修复并有回归测试。
- 会员各等级不会早于自身窗口进入 `ready`，也不会错过会员提前购票。
- 同一电影后来新增匹配场次时能够被发现。
- 任一匹配场次可购时不会被其他售罄场次掩盖。
- typecheck、test、lint、format check 全部通过。
- CLI CRUD 使用临时数据库可正常执行。
- 未混入阶段 D 或更后的功能。
