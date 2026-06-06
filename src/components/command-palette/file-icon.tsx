import {
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FileCode,
  FileArchive,
  File,
  Folder,
} from "lucide-react";

export function FileIcon({
  mime,
  extension,
  isFolder,
}: {
  mime: string | null;
  extension: string | null;
  isFolder: boolean;
}) {
  if (isFolder) return <Folder className="h-4 w-4" />;
  if (mime?.startsWith("image/")) return <FileImage className="h-4 w-4" />;
  if (mime?.startsWith("video/")) return <FileVideo className="h-4 w-4" />;
  if (mime?.startsWith("audio/")) return <FileAudio className="h-4 w-4" />;
  if (mime === "application/pdf") return <FileText className="h-4 w-4" />;
  if (mime?.startsWith("text/")) return <FileText className="h-4 w-4" />;
  const code = new Set(["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "sh", "sql", "json", "yaml", "yml", "toml"]);
  if (extension && code.has(extension)) return <FileCode className="h-4 w-4" />;
  const archive = new Set(["zip", "tar", "gz", "tar.gz", "7z", "rar", "bz2"]);
  if (extension && archive.has(extension)) return <FileArchive className="h-4 w-4" />;
  return <File className="h-4 w-4" />;
}
