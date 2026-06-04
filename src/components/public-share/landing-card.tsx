import type { ShareLink, Connection } from "@/generated/prisma/client";
import { BrandHeader } from "./brand-header";
import { BrandFooter } from "./brand-footer";

type Props = {
  link: ShareLink & { connection: Connection };
  teamLabel?: string;
  previewUrl: string;
};

function basename(key: string): string {
  return key.split("/").pop() ?? key;
}

function inferMime(key: string): "image" | "video" | "audio" | "pdf" | "text" | "other" {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "log", "json", "yml", "yaml", "csv", "html", "css", "js", "ts"].includes(ext))
    return "text";
  return "other";
}

function PreviewBody({
  kind,
  url,
  filename,
}: {
  kind: ReturnType<typeof inferMime>;
  url: string;
  filename: string;
}) {
  if (kind === "image")
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={filename} className="w-full max-h-[400px] object-contain bg-muted" />
    );
  if (kind === "video")
    return <video src={url} controls className="w-full max-h-[400px] bg-black" />;
  if (kind === "audio")
    return (
      <div className="p-6 bg-muted flex justify-center">
        <audio src={url} controls className="w-full max-w-sm" />
      </div>
    );
  if (kind === "pdf")
    return <iframe src={url} title={filename} className="w-full h-[500px] bg-muted" />;
  return null;
}

export function LandingCard({ link, teamLabel = "S3 Dock", previewUrl }: Props) {
  const filename = basename(link.key);
  const kind = inferMime(link.key);
  const inline =
    kind !== "other" && kind !== "text" && previewUrl ? (
      <PreviewBody kind={kind} url={previewUrl} filename={filename} />
    ) : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="bg-card text-card-foreground rounded-xl shadow-md overflow-hidden max-w-2xl w-full border border-border">
        <BrandHeader teamLabel={teamLabel} expiresAt={link.expiresAt} />

        {inline ? (
          inline
        ) : (
          <div className="px-4 py-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 bg-muted rounded-lg flex items-center justify-center text-xs text-muted-foreground font-semibold">
              {filename.split(".").pop()?.toUpperCase() ?? "FILE"}
            </div>
            <div className="text-sm font-semibold text-foreground">{filename}</div>
            <div className="text-xs text-muted-foreground mt-1">
              shared by {link.createdByDisplayName}
            </div>
          </div>
        )}

        <div className="px-4 py-3">
          {inline && (
            <div className="text-sm font-semibold text-foreground mb-1">{filename}</div>
          )}
          {inline && (
            <div className="text-xs text-muted-foreground mb-3">
              shared by {link.createdByDisplayName}
            </div>
          )}
          {link.description && (
            <div className="text-sm text-foreground italic bg-muted rounded-md px-3 py-2 border-l-2 border-foreground mb-3">
              {link.description}
            </div>
          )}
          <a
            href={`/s/${link.slug}/download`}
            className="block w-full bg-primary text-primary-foreground text-center rounded-md py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Download
          </a>
        </div>

        <BrandFooter />
      </div>
    </div>
  );
}
