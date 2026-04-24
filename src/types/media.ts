export type MediaSource = "jellyfin" | "spotify";
export type MediaStatus = "idle" | "playing" | "paused" | "error";
export type MediaKind = "movie" | "episode" | "track" | "podcast" | "unknown";

export type ProviderStatus = {
  enabled: boolean;
  status: "idle" | "ok" | "error";
  message: string | null;
  lastCheckedAt: number | null;
};

export type MediaSnapshot = {
  source: MediaSource | null;
  kind: MediaKind;
  title: string;
  subtitle: string;
  secondaryText: string;
  productionYear: number | null;
  genres: string[];
  communityRating: number | null;
  artworkUrl: string | null;
  durationMs: number | null;
  deviceName: string | null;
  userName: string | null;
  isLiked: boolean | null;
  capturedAt: number;
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
  isLiked: boolean | null;
  lastUpdatedAt: number | null;
  statusChangedAt: number | null;
  lastPlayed: MediaSnapshot | null;
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
  isLiked: null,
  lastUpdatedAt: null,
  statusChangedAt: null,
  lastPlayed: null,
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
