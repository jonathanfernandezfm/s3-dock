import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { GridBackdrop } from "../components/GridBackdrop";
import { BrandLockup } from "../components/BrandLockup";
import { sans, mono } from "../fonts";
import { colors, enterSpring } from "../theme";

export const OUTRO_DURATION = 130;

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ctaProgress = spring({
    frame: frame - 50,
    fps,
    config: enterSpring,
  });

  const domainProgress = spring({
    frame: frame - 62,
    fps,
    config: enterSpring,
  });

  return (
    <AbsoluteFill>
      <GridBackdrop />
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
        }}
      >
        {/* Brand lockup (compact) */}
        <BrandLockup size="compact" startFrame={8} showTagline={false} />

        {/* CTA Button */}
        <div
          style={{
            opacity: ctaProgress,
            transform: `translateY(${(1 - ctaProgress) * 16}px) scale(${0.9 + ctaProgress * 0.1})`,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              paddingLeft: 40,
              paddingRight: 40,
              paddingTop: 16,
              paddingBottom: 16,
              borderRadius: 9999,
              backgroundColor: colors.amber,
              fontFamily: sans,
              fontWeight: 600,
              fontSize: 22,
              color: "#000",
              letterSpacing: "-0.01em",
            }}
          >
            Get started
          </div>
        </div>

        {/* Domain */}
        <div
          style={{
            opacity: domainProgress,
            transform: `translateY(${(1 - domainProgress) * 8}px)`,
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 18,
              color: colors.textMid,
              letterSpacing: "0.04em",
            }}
          >
            s3dock.com
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
