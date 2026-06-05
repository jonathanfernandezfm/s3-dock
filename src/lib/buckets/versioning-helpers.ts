import type { BucketVersioningStatus, S3BucketVersioning } from "@/types/s3";
import type { ActivityAction } from "@/generated/prisma/client";

export function toBucketVersioningStatus(input: {
  Status?: string;
  MFADelete?: string;
}): S3BucketVersioning {
  let status: BucketVersioningStatus;
  if (input.Status === "Enabled") status = "Enabled";
  else if (input.Status === "Suspended") status = "Suspended";
  else status = "Disabled";
  return {
    status,
    mfaDeleteEnabled: input.MFADelete === "Enabled",
  };
}

export function enabledFlagToSdkStatus(enabled: boolean): "Enabled" | "Suspended" {
  return enabled ? "Enabled" : "Suspended";
}

export function statusToActivityAction(
  status: "Enabled" | "Suspended",
): Extract<ActivityAction, "BUCKET_VERSIONING_ENABLE" | "BUCKET_VERSIONING_SUSPEND"> {
  return status === "Enabled" ? "BUCKET_VERSIONING_ENABLE" : "BUCKET_VERSIONING_SUSPEND";
}
