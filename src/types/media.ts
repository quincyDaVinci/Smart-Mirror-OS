export type MediaSource = "jellyfin" | "spotify";
export type MediaStatus = "idle" | "playing" | "paused" | "error";
export type MediaKind = "movie" | "episode" | "track" | "podcast" | "unknown";

export type ProviderStatus = {
  enabled: boolean;
  status: "idle" | "ok" | "error";
  message: string | null;
  lastCheckedAt: number | null;
};

export type MediaState = {
  status: MediaStatus;
  source: MediaSource | null;
  kind: MediaKind;
  title: string;
  subtitle: string;
  secondaryText: string;
  productionYear: number | null;
  genres: string[];
  communityRating: number | null;
  artworkUrl: string | null;
  progressMs: number | null;
  durationMs: number | null;
  deviceName: string | null;
  userName: string | null;
  lastUpdatedAt: number | null;
  sourceState: {
    jellyfin: ProviderStatus;
    spotify: ProviderStatus;
  };
};

export const defaultMediaState: MediaState = {
  status: "idle",
  source: null,
  kind: "unknown",
  title: "Geen media actief",
  subtitle: "Er wordt nu niets afgespeeld",
  secondaryText: "",
  productionYear: null,
  genres: [],
  communityRating: null,
  artworkUrl: null,
  progressMs: null,
  durationMs: null,
  deviceName: null,
  userName: null,
  lastUpdatedAt: null,
  sourceState: {
    jellyfin: {
      enabled: true,
      status: "idle",
      message: null,
      lastCheckedAt: null,
    },
    spotify: {
      enabled: true,
      status: "idle",
      message: null,
      lastCheckedAt: null,
    },
  },
};
