import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { FileGrid, type FileItem } from "@/components/landing/mocks/file-grid";
import { GridBackdrop } from "../components/GridBackdrop";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { DragFile } from "../components/DragFile";
import { colors, enterSpring } from "../theme";
import { mono } from "../fonts";

export const DRAG_DURATION = 140;

const PROD_FILES: FileItem[] = [
  { name: "hero-final.png", kind: "image", highlighted: true },
  { name: "banner.jpg", kind: "image" },
  { name: "thumb.png", kind: "image" },
];

const STAGING_FILES: FileItem[] = [
  { name: "placeholder.png", kind: "image" },
  { name: "draft.jpg", kind: "image" },
];

interface MiniPanelProps {
  title: string;
  files: FileItem[];
  style?: React.CSSProperties;
  showDropZone?: boolean;
  dropZoneActive?: boolean;
}

const MiniPanel: React.FC<MiniPanelProps> = ({ title, files, style, showDropZone, dropZoneActive }) => {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        backgroundColor: colors.panel,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          padding: "10px 16px",
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#ff5f57" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#febc2e" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#28c840" }} />
        <span
          style={{
            marginLeft: 12,
            fontFamily: mono,
            fontSize: 11,
            color: colors.textLow,
          }}
        >
          {title}
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <FileGrid items={files} />
        {showDropZone && (
          <div
            style={{
              position: "absolute",
              inset: 8,
              borderRadius: 12,
              border: `2px dashed ${dropZoneActive ? colors.amber : "rgba(255,255,255,0.15)"}`,
              backgroundColor: dropZoneActive
                ? "oklch(0.83 0.16 85 / 0.08)"
                : "transparent",
              transition: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {dropZoneActive && (
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  color: colors.amber,
                }}
              >
                Drop here
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const DragScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const panelProgress = spring({
    frame: frame - 5,
    fps,
    config: enterSpring,
  });

  // Drop zone activates mid-drag
  const dropZoneActive = frame > 70 && frame < 115;

  return (
    <AbsoluteFill>
      <GridBackdrop />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
          padding: "80px 200px",
        }}
      >
        {/* Prod panel */}
        <div
          style={{
            width: "100%",
            opacity: panelProgress,
            transform: `translateY(${(1 - panelProgress) * 24}px)`,
          }}
        >
          <MiniPanel title="prod / images" files={PROD_FILES} />
        </div>

        {/* Staging panel */}
        <div
          style={{
            width: "100%",
            opacity: panelProgress,
            transform: `translateY(${(1 - panelProgress) * 32}px)`,
          }}
        >
          <MiniPanel
            title="staging / images"
            files={STAGING_FILES}
            showDropZone={frame > 50}
            dropZoneActive={dropZoneActive}
          />
        </div>
      </AbsoluteFill>

      {/* Drag chip — flies from prod panel top to staging panel bottom */}
      <DragFile
        label="hero-final.png"
        from={{ x: 760, y: 360 }}
        to={{ x: 760, y: 700 }}
        startFrame={45}
        durationInFrames={60}
      />

      {/* Cursor follows the drag */}
      <Cursor
        path={[
          { x: 700, y: 340, atFrame: 25 },
          { x: 760, y: 360, atFrame: 45 },
          { x: 760, y: 700, atFrame: 105 },
          { x: 760, y: 710, atFrame: 115 },
        ]}
        clickFrames={[45]}
      />

      <Caption text="Drag files across buckets." startFrame={10} />
    </AbsoluteFill>
  );
};
