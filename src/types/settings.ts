export type MirrorMode = "normal" | "portrait-left" | "portrait-right";

export type MirrorSettings = {
  showSeconds: boolean;
  mirrorMode: MirrorMode;
  autoSleepEnabled: boolean;
  sleepTimeoutSeconds: number;
  showStatusBar: boolean;
  layoutPaddingPx: number;
  layoutPaddingTopPx: number;
  layoutPaddingRightPx: number;
  layoutPaddingBottomPx: number;
  layoutPaddingLeftPx: number;
  widgetGapPx: number;
  zoomPercent: number;
  focusIdleTimeoutSeconds: number;
  mediaFocusExitDelaySeconds: number;
};

export const defaultMirrorSettings: MirrorSettings = {
  showSeconds: true,
  mirrorMode: "normal",
  autoSleepEnabled: false,
  sleepTimeoutSeconds: 180,
  showStatusBar: true,
  layoutPaddingPx: 32,
  layoutPaddingTopPx: 32,
  layoutPaddingRightPx: 32,
  layoutPaddingBottomPx: 32,
  layoutPaddingLeftPx: 32,
  widgetGapPx: 16,
  zoomPercent: 100,
  focusIdleTimeoutSeconds: 45,
  mediaFocusExitDelaySeconds: 10,
};
