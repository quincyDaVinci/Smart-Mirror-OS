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
  lightSensorEnabled: boolean;
  lightOffLuxThreshold: number;
  lightOnLuxThreshold: number;
};

export const defaultMirrorSettings: MirrorSettings = {
  showSeconds: true,
  mirrorMode: "normal",
  autoSleepEnabled: false,
  sleepTimeoutSeconds: 180,
  showStatusBar: true,
  layoutPaddingPx: 0,
  layoutPaddingTopPx: 0,
  layoutPaddingRightPx: 0,
  layoutPaddingBottomPx: 0,
  layoutPaddingLeftPx: 0,
  widgetGapPx: 16,
  zoomPercent: 150,
  focusIdleTimeoutSeconds: 45,
  mediaFocusExitDelaySeconds: 10,
  lightSensorEnabled: true,
  lightOnLuxThreshold: 50,
  lightOffLuxThreshold: 70,
};
