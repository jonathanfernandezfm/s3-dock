export type ParsedProfile =
  | {
      kind: "static";
      name: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | { kind: "role-chain"; name: string; reason: string }
  | { kind: "sso"; name: string; reason: string }
  | { kind: "unsupported"; name: string; reason: string };

export interface ParseAwsProfilesInput {
  credentials?: string;
  config?: string;
}

type RawProfile = Record<string, string>;

function parseIni(text: string): Map<string, RawProfile> {
  const sections = new Map<string, RawProfile>();
  let current: RawProfile | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;

    const headerMatch = line.match(/^\[([^\]]+)\]$/);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      current = {};
      sections.set(name, current);
      continue;
    }

    if (current === null) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    current[key] = value;
  }

  return sections;
}

export function parseAwsProfiles(input: ParseAwsProfilesInput): ParsedProfile[] {
  const credentialsSections = input.credentials ? parseIni(input.credentials) : new Map();
  const profiles: ParsedProfile[] = [];

  for (const [name, fields] of credentialsSections) {
    profiles.push(classify(name, fields));
  }

  return profiles;
}

function classify(name: string, fields: RawProfile): ParsedProfile {
  const accessKeyId = fields["aws_access_key_id"];
  const secretAccessKey = fields["aws_secret_access_key"];
  const region = fields["region"] ?? "us-east-1";

  return {
    kind: "static",
    name,
    region,
    accessKeyId,
    secretAccessKey,
  };
}
