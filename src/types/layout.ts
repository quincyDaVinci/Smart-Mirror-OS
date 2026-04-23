export type WidgetId = "clock" | "weather" | "media" | "calendar";

export const widgetEdgePositionOptions = [
  "top-left",
  "top-right",
  "left-middle",
  "right-middle",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type WidgetEdgePosition = (typeof widgetEdgePositionOptions)[number];

export type LayoutItem = {
  id: WidgetId;
  enabled: boolean;
  position: WidgetEdgePosition;
};