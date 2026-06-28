import React from "react";
import { Composition } from "remotion";
import { ShowcaseDemo, DEMO_DURATION } from "./ShowcaseDemo";
import { FPS } from "./theme";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ShowcaseDemo"
    component={ShowcaseDemo}
    durationInFrames={DEMO_DURATION}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
