import type { WidgetId } from "./layout";

export type FocusSource = "manual" | "media-auto";

export type DisplayState = {
  mode: "on" | "dimmed" | "sleep";
  reason: string;
  keepAwakeReason: string | null;
  updatedAt: number;
  focusedWidgetId: WidgetId | null;
  focusSource: FocusSource | null;
  focusSetAt: number | null;
  focusUntil: number | null;
  mediaIdleSince: number | null;
  mediaAutoFocusSuppressed: boolean;
  mediaAutoFocusSuppressedAt: number | null;
  mediaAutoFocusSuppressionSawActive: boolean;
  mediaLyricsVisible: boolean;
  spotifyContextKeepAwake: boolean;
  spotifyContextKeepAwakeSetAt: number | null;
};
