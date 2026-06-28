import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { mono } from "../fonts";
import { colors } from "../theme";

interface DragFileProps {
  label: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startFrame: number;
  durationInFrames: number;
}

export const DragFile: React.FC<DragFileProps> = ({
  label,
  from,
  to,
  startFrame,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 14, stiffness: 80, mass: 0.8 },
    durationInFrames,
  });

  const x = from.x + (to.x - from.x) * progress;
  const y = from.y + (to.y - from.y) * progress;

  // Scale overshoot on landing
  const landingProgress = spring({
    frame: frame - (startFrame + durationInFrames - 5),
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.3 },
  });
  const scale = 1 + landingProgress * 0.08 - landingProgress * 0.08;

  // In-flight amber glow
  const inFlight = interpolate(progress, [0, 0.1, 0.9, 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Hide before startFrame
  if (frame < startFrame) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${scale})`,
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 8,
        border: `1px solid ${colors.amber}`,
        borderColor: `oklch(0.83 0.16 85 / ${0.4 + inFlight * 0.4})`,
        backgroundColor: `oklch(0.83 0.16 85 / ${0.08 + inFlight * 0.08})`,
        boxShadow: inFlight > 0.05
          ? `0 0 ${inFlight * 20}px ${colors.amberGlow}`
          : "none",
        padding: "8px 14px",
        fontFamily: mono,
        fontSize: 12,
        color: colors.textHi,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {/* Image icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={colors.amber}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      {label}
    </div>
  );
};
