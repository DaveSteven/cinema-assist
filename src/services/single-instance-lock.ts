import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export type LockHandle = {
  path: string;
  release(): void;
};

export class LockError extends Error {
  readonly key: string;
  readonly path: string;

  constructor(key: string, path: string) {
    super(`Another watch task already holds the lock for ${key} (${path})`);
    this.name = "LockError";
    this.key = key;
    this.path = path;
  }
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireSingleInstanceLock(dir: string, key: string): LockHandle {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sanitize(key)}.lock`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return {
        path,
        release: (): void => {
          try {
            unlinkSync(path);
          } catch {
            // Already released or removed.
          }
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      const existing = Number.parseInt(readFileSync(path, "utf8"), 10);
      if (!Number.isFinite(existing) || !isProcessAlive(existing)) {
        try {
          unlinkSync(path);
        } catch {
          // Another actor removed the stale lock first.
        }
        continue;
      }
      throw new LockError(key, path);
    }
  }

  throw new LockError(key, path);
}
