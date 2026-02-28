"use client";

import type { S3Object } from "@/types";

export function createDragPreview(items: S3Object[]): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 14px;
    font-family: var(--font-sans);
    color: hsl(var(--foreground));
    max-width: 250px;
    pointer-events: none;
  `;

  // Icon
  const icon = document.createElement("span");
  icon.style.cssText = `
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  `;

  if (items.length === 1) {
    const item = items[0];
    if (item.isFolder) {
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #3b82f6;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`;
    } else {
      icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: hsl(var(--muted-foreground));"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }
  } else {
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: hsl(var(--muted-foreground));"><path d="M16 2v5h5"/><path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17l4 4z"/><path d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15"/><path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11"/></svg>`;
  }
  el.appendChild(icon);

  // Name
  const name = document.createElement("span");
  name.style.cssText = `
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  `;

  if (items.length === 1) {
    const item = items[0];
    const fileName = item.key.split("/").filter(Boolean).pop() || item.key;
    name.textContent = fileName;
  } else {
    name.textContent = `${items.length} items`;
  }
  el.appendChild(name);

  // Badge for multiple items
  if (items.length > 1) {
    const badge = document.createElement("span");
    badge.style.cssText = `
      background: hsl(var(--primary));
      color: hsl(var(--primary-foreground));
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      flex-shrink: 0;
    `;
    badge.textContent = String(items.length);
    el.appendChild(badge);
  }

  // Position off-screen temporarily for measurement
  el.style.position = "absolute";
  el.style.top = "-1000px";
  el.style.left = "-1000px";
  document.body.appendChild(el);

  return el;
}

export function removeDragPreview(el: HTMLElement) {
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}
