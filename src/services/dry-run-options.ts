export function parseTicketsOption(value: string | undefined, fallback = 1): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
    throw new Error(`--tickets must be an integer between 1 and 6, received "${value}"`);
  }
  return parsed;
}

export function parseTargetRowRatioOption(value: string | undefined, fallback = 0.65): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`--target-row-ratio must be a number between 0 and 1, received "${value}"`);
  }
  return parsed;
}

export function parseTopOption(value: string | undefined, fallback = 5): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error(`--top must be an integer between 1 and 50, received "${value}"`);
  }
  return parsed;
}

export function parseAdjacentOption(value: string | undefined, fallback = true): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`--adjacent must be true or false, received "${value}"`);
}

export function parseMaxSurchargeOption(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--max-surcharge must be a non-negative integer, received "${value}"`);
  }
  return parsed;
}
