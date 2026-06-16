import { beforeEach, describe, expect, it } from "vitest";
import { useInfoDrawerStore } from "./info-drawer-store";
import { usePropertiesDrawerStore } from "./properties-drawer-store";

const fileScope = {
  connectionId: "c1",
  bucket: "b1",
  prefix: "folder/",
  objectKey: "folder/a.txt",
};

describe("info-drawer-store", () => {
  beforeEach(() => {
    useInfoDrawerStore.setState({
      isOpen: false,
      activeTab: "activity",
      scope: null,
      userFilter: null,
      actionFilter: null,
    });
    usePropertiesDrawerStore.setState({ isOpen: false, scope: null });
  });

  it("close() clears objectKey but keeps folder context", () => {
    useInfoDrawerStore.setState({ isOpen: true, scope: fileScope });
    useInfoDrawerStore.getState().close();

    const s = useInfoDrawerStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.scope).toEqual({
      connectionId: "c1",
      bucket: "b1",
      prefix: "folder/",
      objectKey: undefined,
    });
  });

  it("close() leaves scope null when there was no scope", () => {
    useInfoDrawerStore.getState().close();
    expect(useInfoDrawerStore.getState().scope).toBeNull();
  });

  it("open() closes the properties drawer (mutual exclusivity)", () => {
    usePropertiesDrawerStore.setState({
      isOpen: true,
      scope: { connectionId: "c1", bucket: "b1", objectKey: "a.txt" },
    });

    useInfoDrawerStore.getState().open("activity");

    expect(usePropertiesDrawerStore.getState().isOpen).toBe(false);
    expect(useInfoDrawerStore.getState().isOpen).toBe(true);
  });

  it("toggle() to close clears objectKey", () => {
    useInfoDrawerStore.setState({ isOpen: true, scope: fileScope });
    useInfoDrawerStore.getState().toggle("activity"); // open + same tab => close

    const s = useInfoDrawerStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.scope?.objectKey).toBeUndefined();
  });
});
