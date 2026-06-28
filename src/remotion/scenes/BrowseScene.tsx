import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { AppWindow } from "@/components/landing/mocks/app-window";
import { FileGrid, type FileItem } from "@/components/landing/mocks/file-grid";
import { GridBackdrop } from "../components/GridBackdrop";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { enterSpring } from "../theme";

export const BROWSE_DURATION = 130;

const HERO_FILES: FileItem[] = [
  { name: "design-assets", kind: "folder" },
  { name: "hero.png", kind: "image", highlighted: true },
  { name: "report-q2.pdf", kind: "doc" },
  { name: "launch.mp4", kind: "video" },
  { name: "archive.zip", kind: "archive" },
  { name: "notes.md", kind: "doc" },
  { name: "logo.png", kind: "image" },
  { name: "data.csv", kind: "doc" },
];

export const BrowseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Window slides up
  const windowProgress = spring({
    frame: frame - 5,
    fps,
    config: enterSpring,
  });

  return (
    <AbsoluteFill>
      <GridBackdrop />
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
            opacity: windowProgress,
            transform: `translateY(${(1 - windowProgress) * 32}px)`,
          }}
        >
          <AppWindow title="s3dock.com — my-bucket">
            {/* Stagger each file tile in */}
            <div style={{ position: "relative" }}>
              <Sequence from={0}>
                <FileGrid items={HERO_FILES} />
              </Sequence>
            </div>
          </AppWindow>
        </div>
      </AbsoluteFill>

      {/* Cursor drifting across */}
      <Cursor
        path={[
          { x: 600, y: 500, atFrame: 20 },
          { x: 780, y: 420, atFrame: 60 },
          { x: 900, y: 480, atFrame: 100 },
        ]}
        clickFrames={[55]}
      />

      <Caption text="Browse any bucket like a drive." startFrame={15} />
    </AbsoluteFill>
  );
};
