import { describe, test, expect } from "vitest";
import { filterNonEmptyWorkspaceGroups } from "./bucket-list-helpers";

describe("filterNonEmptyWorkspaceGroups", () => {
  test("excludes workspaces that have no connection groups", () => {
    const input = [
      { workspace: { id: "ws-1" }, groups: [] },
      { workspace: { id: "ws-2" }, groups: [{}] },
    ];
    const result = filterNonEmptyWorkspaceGroups(input);
    expect(result).toHaveLength(1);
    expect(result[0].workspace.id).toBe("ws-2");
  });

  test("keeps all workspaces when every workspace has at least one group", () => {
    const input = [
      { workspace: { id: "ws-1" }, groups: [{}] },
      { workspace: { id: "ws-2" }, groups: [{}, {}] },
    ];
    expect(filterNonEmptyWorkspaceGroups(input)).toHaveLength(2);
  });

  test("returns empty array when all workspaces have no groups", () => {
    const input = [
      { workspace: { id: "ws-1" }, groups: [] },
      { workspace: { id: "ws-2" }, groups: [] },
    ];
    expect(filterNonEmptyWorkspaceGroups(input)).toHaveLength(0);
  });

  test("preserves order so separator index is reliable for non-first workspaces", () => {
    const input = [
      { workspace: { id: "ws-1" }, groups: [] },
      { workspace: { id: "ws-2" }, groups: [{}] },
      { workspace: { id: "ws-3" }, groups: [] },
      { workspace: { id: "ws-4" }, groups: [{}] },
    ];
    const result = filterNonEmptyWorkspaceGroups(input);
    expect(result.map((r) => r.workspace.id)).toEqual(["ws-2", "ws-4"]);
  });
});
