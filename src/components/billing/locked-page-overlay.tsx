"use client";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpgradeModalStore } from "@/lib/stores/upgrade-modal-store";

interface LockedPageOverlayProps {
  feature: string;
  description: string;
}

export function LockedPageOverlay({ feature, description }: LockedPageOverlayProps) {
  const openModal = useUpgradeModalStore((s) => s.open);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="rounded-full bg-muted p-4">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold">{feature}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
          PRO feature
        </span>
      </div>
      <Button className="bg-blue-500 hover:bg-blue-600" onClick={openModal}>
        Upgrade to PRO — $4/mo
      </Button>
    </div>
  );
}
