/**
 * Clerk appearance shared by the sign-in and sign-up pages, matching the
 * landing page theme (dark canvas, amber accent). The `var(--accent-amber)`
 * classes resolve because the auth layout wraps these pages in `.landing`.
 */
export const landingClerkAppearance = {
  variables: {
    colorPrimary: "#eab308",
    colorBackground: "transparent",
    colorText: "#ffffff",
    colorTextSecondary: "rgba(255, 255, 255, 0.6)",
    colorInputBackground: "rgba(0, 0, 0, 0.4)",
    colorInputText: "#ffffff",
  },
  elements: {
    rootBox: "w-full",
    card: "shadow-none border-0 w-full bg-transparent",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    socialButtonsBlockButton:
      "border border-white/15 bg-white/5 text-white hover:bg-white/10",
    socialButtonsBlockButtonText: "font-medium text-white",
    dividerLine: "bg-white/10",
    dividerText: "text-white/40",
    formFieldLabel: "text-white/80 font-medium",
    formFieldInput:
      "bg-black/40 border-white/10 text-white focus:border-[var(--accent-amber)] focus:ring-[var(--accent-amber)]",
    formButtonPrimary:
      "bg-[var(--accent-amber)] text-black hover:opacity-90 shadow-none font-semibold",
    footerActionLink: "text-[var(--accent-amber)] hover:opacity-80 font-medium",
    identityPreviewEditButton: "text-[var(--accent-amber)]",
    formFieldAction: "text-[var(--accent-amber)] hover:opacity-80",
    alert: "bg-red-500/10 text-red-400 border-red-500/20",
  },
} as const;
