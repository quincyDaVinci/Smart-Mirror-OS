export type DisplayState = {
  mode: "on" | "dimmed" | "sleep";
  reason: string;
  updatedAt: number;
};