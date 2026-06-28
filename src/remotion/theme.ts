export const FPS = 30;

export const colors = {
  bg: "#0a0a0a",          // ≈ var(--landing-bg)
  panel: "#0d0d0d",
  panelAlt: "#101010",
  amber: "oklch(0.83 0.16 85)",
  amberGlow: "oklch(0.83 0.16 85 / 0.25)",
  textHi: "rgba(255,255,255,0.92)",
  textMid: "rgba(255,255,255,0.55)",
  textLow: "rgba(255,255,255,0.35)",
};

// A reusable "premium" spring config for entrances.
export const enterSpring = { damping: 18, mass: 0.6, stiffness: 120 } as const;
