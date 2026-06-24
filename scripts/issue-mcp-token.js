require("dotenv").config();
const { Client } = require("pg");
const { randomBytes, createHash, randomUUID } = require("crypto");

const TOKEN_PREFIX = "s3dock_pat_";

async function main() {
  const email = process.argv[2];
  const name = process.argv[3] || "cli-issued";
  if (!email) {
    console.error("Usage: node scripts/issue-mcp-token.js <user-email> [token-name]");
    process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const u = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (u.rowCount === 0) throw new Error(`No user with email ${email}`);
    const raw = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    await db.query(
      'INSERT INTO mcp_tokens (id, "userId", name, "tokenHash", prefix, "createdAt") VALUES ($1,$2,$3,$4,$5, now())',
      [randomUUID(), u.rows[0].id, name, tokenHash, raw.slice(0, 12)]
    );
    console.log("\nToken (shown once — store it now):\n");
    console.log(raw);
    console.log("\nConfigure it as S3DOCK_MCP_TOKEN in the MCP client.\n");
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
