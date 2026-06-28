import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { colors } from "../theme";

interface CursorPoint {
  x: number;
  y: number;
  atFrame: number;
}

interface CursorProps {
  path: CursorPoint[];
  clickFrames?: number[];
}

export const Cursor: React.FC<CursorProps> = ({ path, clickFrames = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Interpolate x and y across the path keyframes
  const frames = path.map((p) => p.atFrame);
  const xs = path.map((p) => p.x);
  const ys = path.map((p) => p.y);

  const x = interpolate(frame, frames, xs, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, frames, ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Render click rings
  const rings = clickFrames.map((cf) => {
    const progress = spring({
      frame: frame - cf,
      fps,
      config: { damping: 20, stiffness: 80, mass: 0.5 },
    });
    const opacity = interpolate(frame, [cf, cf + 20], [0.8, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const scale = progress * 2.5;
    return { scale, opacity, key: cf };
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    >
      {/* Click rings */}
      {rings.map(({ scale, opacity, key }) => (
        <div
          key={key}
          style={{
            position: "absolute",
            left: x - 16,
            top: y - 16,
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: `2px solid ${colors.amber}`,
            transform: `scale(${scale})`,
            opacity,
          }}
        />
      ))}
      {/* Arrow cursor */}
      <svg
        style={{
          position: "absolute",
          left: x,
          top: y,
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
        }}
        width="24"
        height="28"
        viewBox="0 0 24 28"
        fill="none"
      >
        <path
          d="M3 2L21 14L13 15.5L9 25L3 2Z"
          fill="white"
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
};
