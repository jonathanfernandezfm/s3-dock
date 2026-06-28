import React from "react";
import { useCurrentFrame, useVideoConfig, spring, staticFile } from "remotion";
import { sans } from "../fonts";
import { colors, enterSpring } from "../theme";

interface BrandLockupProps {
  size?: "full" | "compact";
  startFrame?: number;
  showTagline?: boolean;
}

export const BrandLockup: React.FC<BrandLockupProps> = ({
  size = "full",
  startFrame = 10,
  showTagline = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProgress = spring({
    frame: frame - startFrame,
    fps,
    config: enterSpring,
  });

  const headlineWords = ["S3,", "finally", "usable."];
  const taglineWords = showTagline ? ["Your", "modern", "S3", "UI."] : [];

  const isCompact = size === "compact";
  const logoSize = isCompact ? 64 : 96;
  const headlineFontSize = isCompact ? 64 : 96;
  const gap = isCompact ? 16 : 24;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap,
      }}
    >
      {/* Logo */}
      <div
        style={{
          opacity: logoProgress,
          transform: `scale(${0.8 + logoProgress * 0.2})`,
        }}
      >
        <img
          src={staticFile("/logo.png")}
          style={{
            width: logoSize,
            height: logoSize,
            objectFit: "contain",
          }}
          alt="S3 Dock logo"
        />
      </div>

      {/* Headline words */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {headlineWords.map((word, i) => {
          const delay = startFrame + 6 + i * 3;
          const progress = spring({
            frame: frame - delay,
            fps,
            config: enterSpring,
          });
          return (
            <span
              key={i}
              style={{
                fontFamily: sans,
                fontWeight: 600,
                fontSize: headlineFontSize,
                letterSpacing: "-0.02em",
                color: colors.textHi,
                opacity: progress,
                transform: `translateY(${(1 - progress) * 20}px)`,
                display: "inline-block",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {/* Tagline */}
      {taglineWords.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {taglineWords.map((word, i) => {
            const delay = startFrame + 20 + i * 3;
            const progress = spring({
              frame: frame - delay,
              fps,
              config: enterSpring,
            });
            return (
              <span
                key={i}
                style={{
                  fontFamily: sans,
                  fontWeight: 400,
                  fontSize: 28,
                  letterSpacing: "-0.01em",
                  color: colors.textMid,
                  opacity: progress,
                  transform: `translateY(${(1 - progress) * 12}px)`,
                  display: "inline-block",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};
