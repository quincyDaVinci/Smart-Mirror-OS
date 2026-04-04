export type MirrorMode = string;

export type MirrorSettings = {
  showSeconds: boolean;
  mirrorMode: MirrorMode;
  autoSleepEnabled: boolean;
  sleepTimeoutSeconds: number;
};

export const defaultMirrorSettings: MirrorSettings = {
  showSeconds: true,
  mirrorMode: "normal",
  autoSleepEnabled: false,
  sleepTimeoutSeconds: 180,
};