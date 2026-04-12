export type DeploymentStatus =
  | "idle"
  | "checking"
  | "update-available"
  | "up-to-date"
  | "deploying"
  | "success"
  | "error";

export type DeploymentState = {
  status: DeploymentStatus;
  currentCommit: string | null;
  remoteCommit: string | null;
  hasUpdate: boolean;
  lastCheckedAt: number | null;
  lastDeployedAt: number | null;
  message: string | null;
};