import dotenv from "dotenv";
import { describeConfig, loadConfig } from "./config.js";

dotenv.config({ quiet: true });

const USAGE = `cinema-assist

Usage:
  npm run cli -- config    Print the resolved (redacted) configuration
  npm run cli -- help      Show this message

Monitoring commands arrive in a later phase.`;

function main(): void {
  const command = process.argv[2] ?? "help";

  if (command === "config") {
    const config = loadConfig();
    process.stdout.write(`${JSON.stringify(describeConfig(config), null, 2)}\n`);
    return;
  }

  process.stdout.write(`${USAGE}\n`);
}

main();
