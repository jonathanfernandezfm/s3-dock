import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";
import { sans } from "../fonts";
import { colors, enterSpring } from "../theme";

interface CaptionProps {
  text: string;
  startFrame?: number;
}

export const Caption: React.FC<CaptionProps> = ({ text, startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "0 48px",
      }}
    >
      {words.map((word, i) => {
        const delay = startFrame + i * 3;
        const progress = spring({
          frame: frame - delay,
          fps,
          config: enterSpring,
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              fontFamily: sans,
              fontWeight: 600,
              fontSize: 56,
              letterSpacing: "-0.02em",
              color: colors.textHi,
              opacity: progress,
              transform: `translateY(${(1 - progress) * 24}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
