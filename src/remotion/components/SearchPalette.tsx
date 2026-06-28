import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { mono } from "../fonts";
import { colors, enterSpring } from "../theme";

interface SearchPaletteProps {
  query: string;
  results: string[];
  typeStartFrame?: number;
  revealFrame?: number;
}

export const SearchPalette: React.FC<SearchPaletteProps> = ({
  query,
  results,
  typeStartFrame = 20,
  revealFrame = 80,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // How many characters are typed
  const typedCount = Math.floor(
    interpolate(
      frame,
      [typeStartFrame, typeStartFrame + query.length * 2.5],
      [0, query.length],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );

  // Blinking caret
  const caretVisible = Math.floor(frame / 8) % 2 === 0;

  // Panel entrance
  const panelProgress = spring({
    frame: frame - 5,
    fps,
    config: enterSpring,
  });

  return (
    <div
      style={{
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.10)",
        backgroundColor: colors.panelAlt,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
        opacity: panelProgress,
        transform: `translateY(${(1 - panelProgress) * 16}px)`,
        width: 520,
      }}
    >
      {/* Search row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          padding: "12px 16px",
        }}
      >
        {/* Search icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.30)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <span
          style={{
            fontFamily: mono,
            fontSize: 14,
            color: colors.textHi,
            flex: 1,
          }}
        >
          {query.slice(0, typedCount)}
          {caretVisible && (
            <span style={{ color: colors.amber }}>▏</span>
          )}
        </span>
        <kbd
          style={{
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.10)",
            padding: "2px 6px",
            fontFamily: mono,
            fontSize: 10,
            color: colors.textLow,
          }}
        >
          ⌘K
        </kbd>
      </div>
      {/* Results */}
      <div style={{ padding: 8 }}>
        {results.map((result, i) => {
          const resultProgress = spring({
            frame: frame - (revealFrame + i * 6),
            fps,
            config: enterSpring,
          });
          const isFirst = i === 0;
          return (
            <div
              key={result}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 8,
                padding: "8px 12px",
                fontFamily: mono,
                fontSize: 12,
                color: isFirst ? colors.textHi : colors.textMid,
                backgroundColor: isFirst
                  ? `oklch(0.83 0.16 85 / 0.10)`
                  : "transparent",
                opacity: resultProgress,
                transform: `translateY(${(1 - resultProgress) * 8}px)`,
              }}
            >
              {/* FileText icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgba(255,255,255,0.30)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              {result}
            </div>
          );
        })}
      </div>
    </div>
  );
};
