"use client";

import { Button } from "@/components/ui/button";
import { List, LayoutGrid } from "lucide-react";

interface ViewModeToggleProps {
  value: "list" | "grid";
  onChange: (mode: "list" | "grid") => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5">
      <Button
        size="icon"
        className="h-7 w-7"
        variant={value === "list" ? "secondary" : "ghost"}
        aria-label="List view"
        onClick={() => onChange("list")}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        className="h-7 w-7"
        variant={value === "grid" ? "secondary" : "ghost"}
        aria-label="Grid view"
        onClick={() => onChange("grid")}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
    </div>
  );
}
