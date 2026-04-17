export type DebugLogLevel = "info" | "warn" | "error";

export type DebugLogEntry = {
  id: string;
  timestamp: number;
  level: DebugLogLevel;
  source: string;
  message: string;
  meta: string | null;
};