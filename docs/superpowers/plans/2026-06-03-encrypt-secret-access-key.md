# Secret Access Key Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt `secretAccessKey` at rest in PostgreSQL using AES-256-GCM so plain-text credentials are never stored in the database.

**Architecture:** A single `src/lib/crypto.ts` utility handles encrypt/decrypt using Node's built-in `crypto` module and an `ENCRYPTION_KEY` env var. The `src/lib/db/connections.ts` layer is the only place that touches the DB, so encrypt-on-write and decrypt-on-read are both centralized there. Stored format `enc:ivHex:authTagHex:ciphertextHex` lets the decrypt function detect and pass through any legacy plaintext rows transparently.

**Tech Stack:** Node.js `crypto` (built-in), AES-256-GCM, existing Prisma + Next.js stack

---

### Task 1: Create `src/lib/crypto.ts`

**Files:**
- Create: `src/lib/crypto.ts`

- [ ] **Step 1: Write the module**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = "enc:";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    return stored; // legacy plaintext — transparent migration
  }
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/crypto.ts
git commit -m "feat: add AES-256-GCM encrypt/decrypt utility"
```

---

### Task 2: Wire encryption into the DB layer

**Files:**
- Modify: `src/lib/db/connections.ts`

The three points to change:
1. `createConnection` — encrypt before `prisma.connection.create`
2. `updateConnection` — encrypt before `prisma.connection.update` (only when `secretAccessKey` present)
3. `getConnectionAccessById` — decrypt after reading

- [ ] **Step 1: Add import at top of connections.ts**

Add to imports:
```ts
import { encrypt, decrypt } from "@/lib/crypto";
```

- [ ] **Step 2: Encrypt in `createConnection`**

In `prisma.connection.create({ data: { ... } })`, replace:
```ts
secretAccessKey: data.secretAccessKey,
```
with:
```ts
secretAccessKey: encrypt(data.secretAccessKey),
```

- [ ] **Step 3: Encrypt in `updateConnection`**

Before `prisma.connection.update`, add:
```ts
const updateData = { ...data };
if (updateData.secretAccessKey) {
  updateData.secretAccessKey = encrypt(updateData.secretAccessKey);
}
```
And pass `updateData` instead of `data` to `prisma.connection.update`.

- [ ] **Step 4: Decrypt in `getConnectionAccessById`**

In the returned `connection` object, replace:
```ts
secretAccessKey: connection.secretAccessKey,
```
with:
```ts
secretAccessKey: decrypt(connection.secretAccessKey),
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/connections.ts
git commit -m "feat: encrypt secretAccessKey at rest via DB layer"
```

---

### Task 3: Add ENCRYPTION_KEY to env files

**Files:**
- Modify: `.env.example`
- Modify: `.env`

- [ ] **Step 1: Add to `.env.example`**

```
# Secret Encryption
# =================
# 32-byte key as 64 hex characters. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_64_char_hex_key_here
```

- [ ] **Step 2: Generate and add a real key to `.env`**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into `.env` as `ENCRYPTION_KEY=<output>`.

- [ ] **Step 3: Fix schema comment**

In `prisma/schema.prisma` line 156, update the comment from:
```
secretAccessKey String // AWS secret access key (encrypted in production)
```
to:
```
secretAccessKey String // AES-256-GCM encrypted; use src/lib/crypto.ts to decrypt
```

- [ ] **Step 4: Commit**

```bash
git add .env.example prisma/schema.prisma
git commit -m "chore: add ENCRYPTION_KEY env var and update schema comment"
```

---

## Self-Review

- **Spec coverage:** encrypt on write (create + update), decrypt on read, env var, transparent migration of legacy plaintext. All covered.
- **Placeholder scan:** No TBDs or vague steps.
- **Type consistency:** `encrypt`/`decrypt` signatures match usage in connections.ts.
- **Migration:** Legacy rows (no `enc:` prefix) are returned as-is until overwritten — no data loss, no migration script needed.
