import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = new URL("./fixtures/", import.meta.url);

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(name, FIXTURES_DIR));
}

export function fixtureText(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

export function readFixtureJson(name: string): unknown {
  return JSON.parse(fixtureText(name)) as unknown;
}
