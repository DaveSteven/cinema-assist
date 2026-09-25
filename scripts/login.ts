import {
  buildLoginUrl,
  checkLogin,
  launchPersistentContext,
  waitForLogin,
} from "../src/adapters/cinemasunshine/browser-session.js";
import { loadConfig } from "../src/config.js";

async function runHealthCheck(): Promise<void> {
  const config = loadConfig();
  const context = await launchPersistentContext({
    profileDir: config.browserProfileDir,
    headless: true,
    channel: config.browserChannel,
  });
  try {
    const result = await checkLogin(context);
    if (result.loggedIn) {
      process.stdout.write("登录有效\n");
    } else {
      process.stdout.write("登录已失效，请运行 npm run login 手动登录\n");
      process.exitCode = 2;
    }
  } finally {
    await context.close();
  }
}

async function runManualLogin(): Promise<void> {
  const config = loadConfig();
  const context = await launchPersistentContext({
    profileDir: config.browserProfileDir,
    headless: false,
    channel: config.browserChannel,
  });

  const onSignal = (): void => {
    context.close().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(buildLoginUrl(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    process.stdout.write(
      "请在弹出的浏览器中手动完成登录。本工具不会保存密码，也不会记录或上传 Cookie。\n",
    );
    process.stdout.write("检测到登录完成后会输出「登录有效」并自动关闭窗口。\n");

    const loggedIn = await waitForLogin(page);
    if (loggedIn) {
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      process.stdout.write("登录有效\n");
    } else {
      process.stdout.write("未检测到登录完成，未保存新的登录状态。\n");
      process.exitCode = 1;
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    await runHealthCheck();
    return;
  }
  await runManualLogin();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
