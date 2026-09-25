# 阶段 A 验收报告

验收日期：2026-09-25  
结论：**有条件通过，修复下列问题后可正式关闭阶段 A。**

## 已通过项目

- `npm run typecheck`：通过。
- `npm test`：通过，1 个测试文件、14 个测试全部成功。
- `npm run lint`：通过，无需修复。
- `npm run format:check`：通过，无需格式化。
- `npm run cli -- config`：在正常运行权限下通过。
- TypeScript 已启用 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`noUnusedLocals` 和 `noUnusedParameters`。
- 已安装 Playwright、Zod、Pino、better-sqlite3、Vitest、TypeScript 和 Biome。
- `.env.example` 只包含示例配置，没有真实账号或 token。
- `.gitignore` 已覆盖 `.env`、`.auth/`、运行数据库、日志、截图、trace、测试报告和构建产物。
- `describeConfig()` 不会输出 Telegram token 或 chat ID。
- 当前 Git 状态中未发现 Cookie、认证 profile、数据库或其他敏感运行文件。

## 必须修复

### A-01：移除当前无法运行的 npm scripts

严重度：中  
状态：待修复

`package.json` 当前声明了以下命令：

```json
{
  "login": "tsx scripts/login.ts",
  "inspect-schedule": "tsx scripts/inspect-schedule.ts",
  "dry-run": "tsx scripts/dry-run.ts"
}
```

但对应文件均不存在：

```text
scripts/login.ts
scripts/inspect-schedule.ts
scripts/dry-run.ts
```

这些功能分别属于后续阶段 D、B、E，不应在阶段 A 暴露失效命令。

修复要求：

1. 从 `package.json` 暂时删除上述三个 scripts。
2. 不要为了让命令表面可运行而提前实现后续阶段功能。
3. 后续阶段完成相应入口时，再把命令加回 `package.json`。
4. `cli`、`typecheck`、`lint`、`format` 和 `test` scripts 保持不变。

验收标准：

- `package.json` 不再声明指向不存在文件的命令。
- `rg 'scripts/(login|inspect-schedule|dry-run)\.ts' package.json` 无匹配。

### A-02：明确目录采用按需创建策略

严重度：低  
状态：待修复

原实施计划阶段 A 要求建立完整目录骨架，但以下目录目前不存在：

```text
src/domain/
src/adapters/cinemasunshine/
src/services/
src/persistence/
src/notifications/
scripts/
tests/fixtures/
tests/integration/
```

Git 不保存空目录。为了避免加入大量无意义的 `.gitkeep`，本项目决定采用“进入对应阶段时按需创建目录”的策略。

修复要求：

修改 `IMPLEMENTATION_PLAN.md` 的“阶段 A：工程骨架”：

- 不再要求阶段 A 创建所有空目录。
- 明确目录由后续阶段在首次添加实际文件时创建。
- `data/.gitkeep` 保留，因为运行时需要明确的数据目录。

验收标准：

- 实施计划不再把不存在的空目录视为阶段 A 未完成项。
- 建议目录结构本身可以保留，作为后续阶段目标。

## 不需要修复

在受限执行沙箱中直接运行 `tsx` 时，可能出现类似错误：

```text
listen EPERM .../tsx-*/....pipe
```

这是沙箱阻止 `tsx` 创建 IPC socket 所致。使用正常本机权限运行 `npm run cli -- config` 已验证成功，因此不属于项目缺陷。不要为了规避验收环境限制而替换 `tsx`。

## Worker 执行步骤

1. 阅读 `IMPLEMENTATION_PLAN.md`、本报告和当前 `package.json`。
2. 只修复 A-01 和 A-02，不实现阶段 B 或后续功能。
3. 检查 diff，确认未加入凭据、Cookie、数据库或认证文件。
4. 运行完整复验命令：

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
npm run cli -- config
```

5. 检查 Git 状态：

```bash
git status --short --ignored
```

6. 报告修改文件、全部命令结果和任何残留问题。

## 正式通过条件

只有同时满足以下条件，阶段 A 才能标记为正式通过：

- A-01、A-02 均已修复。
- typecheck、test、lint、format check 全部通过。
- CLI 配置命令可运行且输出中没有秘密。
- `package.json` 不包含失效入口。
- Git 状态中没有敏感运行文件。
- 未提前实现或混入阶段 B 及后续功能。

