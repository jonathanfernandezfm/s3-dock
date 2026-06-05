import type { ConnectionRole } from "@/lib/db/connections";

export type VersionAction =
  | "list"
  | "presign"
  | "restore"
  | "undelete"
  | "copy"
  | "purge"
  | "bucket_toggle";

const ADMIN_ONLY: ReadonlySet<VersionAction> = new Set(["purge", "bucket_toggle"]);
const WRITE_LEVEL: ReadonlySet<VersionAction> = new Set(["restore", "undelete", "copy"]);

export function canPerformVersionAction(
  role: ConnectionRole | null,
  action: VersionAction,
): boolean {
  if (role === "ADMIN") return true;
  if (role === "VIEWER") {
    if (ADMIN_ONLY.has(action)) return false;
    if (WRITE_LEVEL.has(action)) return false;
    return true;
  }
  return false;
}
