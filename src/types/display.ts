import type { WidgetId } from "./layout";

export type FocusSource = "manual" | "media-auto";

export type DisplayState = {
  mode: "on" | "dimmed" | "sleep";
  reason: string;
  updatedAt: number;
  focusedWidgetId: WidgetId | null;
  focusSource: FocusSource | null;
  focusSetAt: number | null;
  focusUntil: number | null;
  mediaIdleSince: number | null;
};