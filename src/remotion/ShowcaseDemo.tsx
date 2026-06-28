import React from "react";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { FPS } from "./theme";
import { IntroScene, INTRO_DURATION } from "./scenes/IntroScene";
import { BrowseScene, BROWSE_DURATION } from "./scenes/BrowseScene";
import { SearchScene, SEARCH_DURATION } from "./scenes/SearchScene";
import { DragScene, DRAG_DURATION } from "./scenes/DragScene";
import { OutroScene, OUTRO_DURATION } from "./scenes/OutroScene";

const TRANSITION = 15; // frames each transition overlaps

const SCENES = [
  INTRO_DURATION,
  BROWSE_DURATION,
  SEARCH_DURATION,
  DRAG_DURATION,
  OUTRO_DURATION,
];

export const DEMO_DURATION =
  SCENES.reduce((a, b) => a + b, 0) - TRANSITION * (SCENES.length - 1);

// Suppress unused FPS lint warning — it's the module's source of truth
void FPS;

const timing = () =>
  springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION });

export const ShowcaseDemo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={INTRO_DURATION}>
      <IntroScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={timing()} />

    <TransitionSeries.Sequence durationInFrames={BROWSE_DURATION}>
      <BrowseScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide()} timing={timing()} />

    <TransitionSeries.Sequence durationInFrames={SEARCH_DURATION}>
      <SearchScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={timing()} />

    <TransitionSeries.Sequence durationInFrames={DRAG_DURATION}>
      <DragScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide()} timing={timing()} />

    <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION}>
      <OutroScene />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
