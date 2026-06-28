import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { GridBackdrop } from "../components/GridBackdrop";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { SearchPalette } from "../components/SearchPalette";
import { AppWindow } from "@/components/landing/mocks/app-window";
import { FileGrid, type FileItem } from "@/components/landing/mocks/file-grid";
import { enterSpring } from "../theme";

export const SEARCH_DURATION = 150;

const BG_FILES: FileItem[] = [
  { name: "design-assets", kind: "folder" },
  { name: "hero.png", kind: "image" },
  { name: "report-q2.pdf", kind: "doc" },
  { name: "launch.mp4", kind: "video" },
];

export const SearchScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const windowProgress = spring({
    frame: frame - 5,
    fps,
    config: enterSpring,
  });

  const paletteProgress = spring({
    frame: frame - 25,
    fps,
    config: enterSpring,
  });

  return (
    <AbsoluteFill>
      <GridBackdrop />

      {/* Background app window (dimmed) */}
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 120px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 960,
            opacity: windowProgress * 0.35,
            transform: `translateY(${(1 - windowProgress) * 16}px) scale(0.97)`,
          }}
        >
          <AppWindow title="s3dock.com — my-bucket">
            <FileGrid items={BG_FILES} />
          </AppWindow>
        </div>
      </AbsoluteFill>

      {/* Search palette centered */}
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            opacity: paletteProgress,
            transform: `scale(${0.95 + paletteProgress * 0.05})`,
          }}
        >
          <SearchPalette
            query="invoice.pdf"
            results={[
              "billing/2026/invoice.pdf",
              "archive/invoice.pdf",
            ]}
            typeStartFrame={35}
            revealFrame={95}
          />
        </div>
      </AbsoluteFill>

      {/* Cursor moves to palette */}
      <Cursor
        path={[
          { x: 960, y: 600, atFrame: 10 },
          { x: 960, y: 540, atFrame: 30 },
          { x: 960, y: 540, atFrame: 150 },
        ]}
        clickFrames={[28]}
      />

      <Caption text="Search every bucket, instantly." startFrame={20} />
    </AbsoluteFill>
  );
};
