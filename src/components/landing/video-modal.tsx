"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface VideoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full-screen demo player. Radix handles ESC-to-close and focus trapping.
 * If the video assets are missing (they are until the demo is produced),
 * the onError fallback shows a "coming soon" panel instead of a broken player.
 */
export function VideoModal({ open, onOpenChange }: VideoModalProps) {
  const [failed, setFailed] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,1100px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_80px_var(--accent-amber-glow)] focus:outline-none">
          <Dialog.Title className="sr-only">S3 Dock product demo</Dialog.Title>
          {failed ? (
            <div className="flex aspect-video items-center justify-center font-mono text-sm text-white/50">
              Demo video coming soon.
            </div>
          ) : (
            <video
              className="aspect-video w-full"
              poster="/demo/poster.png"
              controls
              autoPlay
              onError={() => setFailed(true)}
            >
              <source src="/demo/showcase.webm" type="video/webm" />
              <source src="/demo/showcase.mp4" type="video/mp4" />
            </video>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
