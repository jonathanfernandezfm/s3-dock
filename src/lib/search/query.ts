export type ParsedQuery = {
  freeText: string;
  mime?: string;
  ext?: string;
  sizeMin?: bigint;
  sizeMax?: bigint;
  before?: Date;
  after?: Date;
  bucket?: string;
  connection?: string;
  tag?: string;
};

const KNOWN_OPERATORS = new Set([
  "mime",
  "ext",
  "size",
  "before",
  "after",
  "in",
  "connection",
  "tag",
]);

const UNITS: Record<string, bigint> = {
  b: 1n,
  kb: 1024n,
  mb: 1024n * 1024n,
  gb: 1024n * 1024n * 1024n,
};

type Tokenized = { token: string; isOperator: boolean };

function tokenize(input: string): Tokenized[] {
  const tokens: Tokenized[] = [];
  // Match: bareword | operator:bareword | operator:"quoted value"
  const re = /(\w+):"([^"]+)"|(\w+):(\S+)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[1] && m[2]) tokens.push({ token: `${m[1]}:${m[2]}`, isOperator: true });
    else if (m[3] && m[4]) tokens.push({ token: `${m[3]}:${m[4]}`, isOperator: true });
    else if (m[5]) tokens.push({ token: m[5], isOperator: false });
  }
  return tokens;
}

function parseSize(value: string): { min?: bigint; max?: bigint } | null {
  const m = /^(>=|<=|>|<)(\d+)(b|kb|mb|gb)?$/i.exec(value);
  if (!m) return null;
  const [, cmp, num, unit] = m;
  const factor = UNITS[(unit ?? "b").toLowerCase()];
  const bytes = BigInt(num) * factor;
  if (cmp === ">") return { min: bytes + 1n };
  if (cmp === ">=") return { min: bytes };
  if (cmp === "<") return { max: bytes - 1n };
  if (cmp === "<=") return { max: bytes };
  return null;
}

function parseDate(value: string, now: Date): Date | null {
  if (value === "today") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (value === "yesterday") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  const rel = /^(\d+)d$/.exec(value);
  if (rel) {
    return new Date(now.getTime() - parseInt(rel[1], 10) * 86_400_000);
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (iso && !isNaN(iso.getTime())) return iso;
  return null;
}

export function parseSearchQuery(
  input: string,
  opts: { now?: Date } = {}
): ParsedQuery {
  const now = opts.now ?? new Date();
  const parsed: ParsedQuery = { freeText: "" };
  const freeTokens: string[] = [];

  for (const { token, isOperator } of tokenize(input)) {
    if (!isOperator) {
      freeTokens.push(token);
      continue;
    }
    const colon = token.indexOf(":");
    const op = token.slice(0, colon).toLowerCase();
    const value = token.slice(colon + 1);
    if (!KNOWN_OPERATORS.has(op)) {
      freeTokens.push(token);
      continue;
    }
    switch (op) {
      case "mime":
        parsed.mime = value;
        break;
      case "ext":
        parsed.ext = value.toLowerCase();
        break;
      case "size": {
        const sz = parseSize(value);
        if (!sz) {
          freeTokens.push(token);
          break;
        }
        if (sz.min !== undefined) parsed.sizeMin = sz.min;
        if (sz.max !== undefined) parsed.sizeMax = sz.max;
        break;
      }
      case "before": {
        const d = parseDate(value, now);
        if (d) parsed.before = d;
        else freeTokens.push(token);
        break;
      }
      case "after": {
        const d = parseDate(value, now);
        if (d) parsed.after = d;
        else freeTokens.push(token);
        break;
      }
      case "in":
        parsed.bucket = value;
        break;
      case "connection":
        parsed.connection = value;
        break;
      case "tag":
        parsed.tag = value;
        break;
    }
  }
  parsed.freeText = freeTokens.join(" ");
  return parsed;
}
