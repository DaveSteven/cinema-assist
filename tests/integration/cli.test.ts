import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

let workDir: string;
let dbPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "cinema-cli-"));
  dbPath = join(workDir, "cli.sqlite");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(tsxBin, ["src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DB_PATH: dbPath, NODE_OPTIONS: "--experimental-sqlite" },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("watch CLI end to end", () => {
  it("supports add, list, disable, enable, remove and rejects unknown ids", {
    timeout: 60_000,
  }, () => {
    const added = runCli([
      "watch",
      "add",
      "--title",
      "作品",
      "--date",
      "2026-09-29",
      "--tickets",
      "2",
    ]);
    expect(added.status).toBe(0);
    expect(added.stdout).toContain("Created watch rule:");

    const listed = runCli(["watch", "list"]);
    expect(listed.status).toBe(0);
    const id = listed.stdout.split("\n")[0]?.trim() ?? "";
    expect(id).not.toBe("");
    expect(listed.stdout).toContain("enabled:      true");

    const disabled = runCli(["watch", "disable", id]);
    expect(disabled.status).toBe(0);
    expect(disabled.stdout).toContain(`Disabled ${id}`);
    expect(runCli(["watch", "list"]).stdout).toContain("enabled:      false");

    const enabled = runCli(["watch", "enable", id]);
    expect(enabled.status).toBe(0);
    expect(enabled.stdout).toContain(`Enabled ${id}`);

    const removed = runCli(["watch", "remove", id]);
    expect(removed.status).toBe(0);
    expect(runCli(["watch", "list"]).stdout).toContain("No watch rules.");

    const missing = runCli(["watch", "remove", "does-not-exist"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Watch rule not found");
  });
});
