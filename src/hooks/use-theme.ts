"use client";
import { useEffect, useSyncExternalStore } from "react";

function readSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeSystemTheme(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function readStoredTheme(): "light" | "dark" | null {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : null;
}

// Same-tab writes don't fire the `storage` event, so keep an in-process listener
// set alongside the cross-tab `storage` subscription.
const storedThemeListeners = new Set<() => void>();

function subscribeStoredTheme(onStoreChange: () => void) {
  storedThemeListeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    storedThemeListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function emitStoredThemeChange() {
  storedThemeListeners.forEach((listener) => listener());
}

export function useTheme() {
  // useSyncExternalStore returns the server snapshot ("light" / no override)
  // during SSR and hydration, then the client value — matching server-rendered
  // HTML on first paint and avoiding a hydration mismatch without a mount flag.
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    readSystemTheme,
    () => "light" as const
  );
  const storedTheme = useSyncExternalStore(
    subscribeStoredTheme,
    readStoredTheme,
    () => null
  );

  const theme = storedTheme ?? systemTheme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = (next: "light" | "dark") => {
    localStorage.setItem("theme", next);
    emitStoredThemeChange();
  };

  return { theme, setTheme };
}
