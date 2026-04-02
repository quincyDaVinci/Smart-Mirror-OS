export type PresenceState = {
  mode: "active" | "idle";
  lastMotionAt: number | null;
};