"use client";

import { TabBar } from "./tab-bar";
import { TabContent } from "./tab-content";

export function TabContainer() {
  return (
    <div className="flex flex-col h-full">
      <TabBar />
      <div className="flex-1 p-6 overflow-auto">
        <TabContent />
      </div>
    </div>
  );
}
