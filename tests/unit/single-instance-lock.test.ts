import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSingleInstanceLock, LockError } from "../../src/services/single-instance-lock.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cinema-lock-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("acquireSingleInstanceLock", () => {
  it("acquires and releases a lock", () => {
    const handle = acquireSingleInstanceLock(dir, "rule-1");
    expect(existsSync(handle.path)).toBe(true);

    handle.release();
    expect(existsSync(handle.path)).toBe(false);
  });

  it("rejects a second holder of the same key", () => {
    const first = acquireSingleInstanceLock(dir, "rule-1");
    expect(() => acquireSingleInstanceLock(dir, "rule-1")).toThrow(LockError);
    first.release();
  });

  it("allows different keys", () => {
    const a = acquireSingleInstanceLock(dir, "rule-a");
    const b = acquireSingleInstanceLock(dir, "rule-b");
    a.release();
    b.release();
  });

  it("sanitizes keys into safe file names", () => {
    const handle = acquireSingleInstanceLock(dir, "../../etc/passwd");
    expect(handle.path.startsWith(dir)).toBe(true);
    handle.release();
  });

  it("reclaims a stale lock from a dead process", () => {
    const stale = acquireSingleInstanceLock(dir, "rule-stale");
    const stalePath = stale.path;
    writeFileSync(stalePath, "999999999");

    const handle = acquireSingleInstanceLock(dir, "rule-stale");
    expect(handle.path).toBe(stalePath);
    handle.release();
  });

  it("reclaims a corrupt lock file", () => {
    const stale = acquireSingleInstanceLock(dir, "rule-corrupt");
    writeFileSync(stale.path, "not-a-pid");

    const handle = acquireSingleInstanceLock(dir, "rule-corrupt");
    expect(existsSync(handle.path)).toBe(true);
    handle.release();
  });
});
