export function BrandFooter() {
  return (
    <div className="flex items-center justify-center gap-1.5 px-4 py-2 border-t border-border">
      <span className="text-[10px] text-muted-foreground">Shared via</span>
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 bg-foreground rounded-sm" />
        <span className="text-[11px] font-semibold text-muted-foreground">S3 Dock</span>
      </div>
    </div>
  );
}
