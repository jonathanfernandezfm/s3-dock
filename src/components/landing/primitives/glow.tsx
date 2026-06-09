import { cn } from "@/lib/utils";

/**
 * Amber radial bloom. Position/size it with className (absolute positioning expected).
 * Pulse animation is defined in globals.css and disabled under reduced motion.
 */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-glow-pulse pointer-events-none absolute rounded-full blur-3xl",
        "bg-[radial-gradient(ellipse_at_center,var(--accent-amber-glow),transparent_70%)]",
        className
      )}
    />
  );
}
