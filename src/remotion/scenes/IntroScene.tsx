import React from "react";
import { AbsoluteFill } from "remotion";
import { GridBackdrop } from "../components/GridBackdrop";
import { BrandLockup } from "../components/BrandLockup";

export const INTRO_DURATION = 80;

export const IntroScene: React.FC = () => {
  return (
    <AbsoluteFill>
      <GridBackdrop />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BrandLockup size="full" startFrame={8} showTagline={false} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
