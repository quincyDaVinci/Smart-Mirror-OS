export type LightSensorState = {
  enabled: boolean;
  status: "unknown" | "ok" | "error";
  raw: number | null;
  lux: number | null;
  roomLightOn: boolean;
  updatedAt: number | null;
  error: string | null;
};