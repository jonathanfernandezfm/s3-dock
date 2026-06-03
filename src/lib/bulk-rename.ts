export type RenamePattern =
  | { kind: "find-replace"; find: string; replace: string; matchCase: boolean }
  | { kind: "prefix"; text: string }
  | { kind: "suffix"; text: string }
  | { kind: "sequence"; baseName: string; startAt: number; padTo: number };

export interface RenamePreviewItem {
  oldKey: string;
  newKey: string;
  changed: boolean;
}

function splitNameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function transformName(name: string, isFolder: boolean, pattern: RenamePattern, index: number): string {
  if (isFolder) {
    switch (pattern.kind) {
      case "find-replace": {
        const flags = pattern.matchCase ? "g" : "gi";
        const re = new RegExp(pattern.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        return pattern.find ? name.replace(re, pattern.replace) : name;
      }
      case "prefix":
        return pattern.text + name;
      case "suffix":
        return name + pattern.text;
      case "sequence": {
        const n = String(pattern.startAt + index).padStart(pattern.padTo, "0");
        return `${pattern.baseName}${n}`;
      }
    }
  }
  const { stem, ext } = splitNameExt(name);
  switch (pattern.kind) {
    case "find-replace": {
      if (!pattern.find) return stem + ext;
      const flags = pattern.matchCase ? "g" : "gi";
      const re = new RegExp(pattern.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      return stem.replace(re, pattern.replace) + ext;
    }
    case "prefix":
      return pattern.text + stem + ext;
    case "suffix":
      return stem + pattern.text + ext;
    case "sequence": {
      const n = String(pattern.startAt + index).padStart(pattern.padTo, "0");
      return `${pattern.baseName}${n}${ext}`;
    }
  }
}

export function applyRenamePattern(
  keys: string[],
  pattern: RenamePattern
): RenamePreviewItem[] {
  return keys.map((oldKey, index) => {
    const isFolder = oldKey.endsWith("/");
    const trimmed = isFolder ? oldKey.slice(0, -1) : oldKey;
    const lastSlash = trimmed.lastIndexOf("/");
    const parent = lastSlash === -1 ? "" : trimmed.slice(0, lastSlash + 1);
    const name = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
    const newName = transformName(name, isFolder, pattern, index);
    const newKey = parent + newName + (isFolder ? "/" : "");
    return { oldKey, newKey, changed: oldKey !== newKey };
  });
}
