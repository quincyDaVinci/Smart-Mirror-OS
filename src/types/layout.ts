export type WidgetId = "clock" | "weather" | "media" | "calendar";

export type LayoutItem = {
  id: WidgetId;
  enabled: boolean;
};