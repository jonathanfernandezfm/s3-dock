"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

function readSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeSystemTheme(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

export function useTheme() {
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    readSystemTheme,
    () => "light" as const
  );
  const [mounted, setMounted] = useState(false);
  const [themeOverride, setThemeOverride] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      setThemeOverride(stored);
    }
    setMounted(true);
  }, []);

  // Before mount, use "light" to match server-rendered HTML and avoid hydration mismatch
  const theme = mounted ? (themeOverride ?? systemTheme) : "light";

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
  }, [theme, mounted]);

  const setTheme = (next: "light" | "dark") => {
    setThemeOverride(next);
    localStorage.setItem("theme", next);
  };

  return { theme, setTheme };
}
