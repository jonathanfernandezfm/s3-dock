function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

export function zipEntryName(key: string, rootPrefix: string): string {
  const relative =
    rootPrefix && key.startsWith(rootPrefix)
      ? key.slice(rootPrefix.length)
      : key;
  return relative.replace(/^\/+/, "");
}

export function zipDownloadName(
  keys: string[],
  bucket: string,
  currentPath: string
): string {
  if (keys.length === 1 && keys[0].endsWith("/")) {
    const folder = lastSegment(keys[0]);
    if (folder) return `${folder}.zip`;
  }
  return `${lastSegment(currentPath) || bucket}.zip`;
}

export function sanitizeZipFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>| -]/g, "_").trim();
  if (!cleaned) return "download.zip";
  return cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`;
}
