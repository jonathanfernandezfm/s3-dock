import { describe, test, expect } from "vitest";
import {
  toBucketVersioningStatus,
  enabledFlagToSdkStatus,
  statusToActivityAction,
} from "./versioning-helpers";

describe("toBucketVersioningStatus", () => {
  test("maps 'Enabled' to 'Enabled'", () => {
    expect(toBucketVersioningStatus({ Status: "Enabled" })).toEqual({
      status: "Enabled",
      mfaDeleteEnabled: false,
    });
  });

  test("maps 'Suspended' to 'Suspended'", () => {
    expect(toBucketVersioningStatus({ Status: "Suspended" })).toEqual({
      status: "Suspended",
      mfaDeleteEnabled: false,
    });
  });

  test("treats missing Status as 'Disabled' (bucket never had versioning)", () => {
    expect(toBucketVersioningStatus({})).toEqual({
      status: "Disabled",
      mfaDeleteEnabled: false,
    });
  });

  test("treats unknown Status as 'Disabled' defensively", () => {
    expect(toBucketVersioningStatus({ Status: "Banana" })).toEqual({
      status: "Disabled",
      mfaDeleteEnabled: false,
    });
  });

  test("surfaces MFADelete='Enabled' as mfaDeleteEnabled true", () => {
    expect(toBucketVersioningStatus({ Status: "Enabled", MFADelete: "Enabled" })).toEqual({
      status: "Enabled",
      mfaDeleteEnabled: true,
    });
  });
});

describe("enabledFlagToSdkStatus", () => {
  test("maps true to 'Enabled'", () => {
    expect(enabledFlagToSdkStatus(true)).toBe("Enabled");
  });

  test("maps false to 'Suspended'", () => {
    expect(enabledFlagToSdkStatus(false)).toBe("Suspended");
  });
});

describe("statusToActivityAction", () => {
  test("'Enabled' → 'BUCKET_VERSIONING_ENABLE'", () => {
    expect(statusToActivityAction("Enabled")).toBe("BUCKET_VERSIONING_ENABLE");
  });

  test("'Suspended' → 'BUCKET_VERSIONING_SUSPEND'", () => {
    expect(statusToActivityAction("Suspended")).toBe("BUCKET_VERSIONING_SUSPEND");
  });
});
