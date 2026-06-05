import { describe, test, expect } from "vitest";
import { parseAwsProfiles } from "./parse-profiles";

describe("parseAwsProfiles", () => {
  test("parses a single static profile from a credentials file", () => {
    const credentials = [
      "[default]",
      "aws_access_key_id = AKIA00000000EXAMPLE",
      "aws_secret_access_key = secret123",
    ].join("\n");

    const result = parseAwsProfiles({ credentials });

    expect(result).toEqual([
      {
        kind: "static",
        name: "default",
        region: "us-east-1",
        accessKeyId: "AKIA00000000EXAMPLE",
        secretAccessKey: "secret123",
      },
    ]);
  });

  test("parses multiple named static profiles", () => {
    const credentials = [
      "[default]",
      "aws_access_key_id = AKIA_DEFAULT",
      "aws_secret_access_key = secret_default",
      "",
      "[dev]",
      "aws_access_key_id = AKIA_DEV",
      "aws_secret_access_key = secret_dev",
    ].join("\n");

    const result = parseAwsProfiles({ credentials });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("default");
    expect(result[1].name).toBe("dev");
  });
});
