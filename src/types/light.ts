export type LightMode = "unknown" | "dark" | "context" | "bright";

export type LightSensorState = {
  enabled: boolean;
  status: "unknown" | "ok" | "error";
  mode: LightMode;
  raw: number | null;
  lux: number | null;
  roomLightOn: boolean;
  updatedAt: number | null;
  error: string | null;
};