export type ParsedTitle = {
  core: string;
  formats: string[];
};

const FORMAT_KEYWORDS: readonly string[] = [
  "dolby atmos",
  "dolby cinema",
  "dolby",
  "atmos",
  "imax",
  "4dx",
  "bestia",
  "grand class",
  "sola",
  "字幕",
  "吹替",
  "enhanced",
];

const FORMAT_ALIASES: Record<string, string> = {
  dolbyatmos: "dolbyatmos",
  atmos: "dolbyatmos",
  dolby: "dolbyatmos",
};

function canonicalFormat(token: string): string {
  const normalized = token.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  return FORMAT_ALIASES[normalized] ?? normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseTitle(title: string): ParsedTitle {
  const normalized = title.normalize("NFKC");
  const formats = new Set<string>();

  for (const match of normalized.matchAll(/【([^】]*)】/g)) {
    const token = match[1]?.trim();
    if (token) formats.add(canonicalFormat(token));
  }

  let core = normalized.replace(/【[^】]*】/g, " ");
  for (const keyword of FORMAT_KEYWORDS) {
    const pattern = new RegExp(escapeRegExp(keyword), "gi");
    if (pattern.test(core)) {
      formats.add(canonicalFormat(keyword));
      core = core.replace(pattern, " ");
    }
  }

  core = core.replace(/[\s/／・,，。.、-]+/g, "").toLowerCase();

  return { core, formats: [...formats].sort() };
}

export function titlesMatchCore(a: string, b: string): boolean {
  const left = parseTitle(a);
  const right = parseTitle(b);
  return left.core.length > 0 && left.core === right.core;
}

export function formatsMatch(a: string, b: string): boolean {
  const left = parseTitle(a);
  const right = parseTitle(b);
  return left.formats.join(",") === right.formats.join(",");
}
