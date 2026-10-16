const YOUTUBE_OEMBED_URL = "https://www.youtube.com/oembed";
const YOUTUBE_HEARTBEAT_STALE_MS = 15000;
const YOUTUBE_METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_METADATA_MISS_TTL_MS = 5 * 60 * 1000;
const YOUTUBE_METADATA_TIMEOUT_MS = 5000;
const YOUTUBE_METADATA_CACHE_MAX_ENTRIES = 100;
const YOUTUBE_DEVICE_NAME = "LG C9";

const metadataCache = new Map();
const pendingMetadata = new Map();

let latestHeartbeat = null;
let latestMedia = null;

function normalizeFiniteMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed);
}

function normalizeYouTubeHeartbeat(input = {}) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const videoId =
    typeof input.videoId === "string" &&
    /^[A-Za-z0-9_-]{11}$/.test(input.videoId)
      ? input.videoId
      : null;

  if (!videoId) {
    return null;
  }

  const status =
    input.status === "playing" ||
    input.status === "paused" ||
    input.status === "ended" ||
    input.status === "idle"
      ? input.status
      : "idle";

  const durationMs = normalizeFiniteMs(input.durationMs);
  let progressMs = normalizeFiniteMs(input.progressMs);

  if (
    progressMs !== null &&
    durationMs !== null &&
    durationMs > 0 &&
    progressMs > durationMs
  ) {
    progressMs = durationMs;
  }

  return {
    videoId,
    status,
    progressMs,
    durationMs,
    visible: input.visible === true,
  };
}

function isYouTubeHeartbeatActive(heartbeat, now = Date.now()) {
  return Boolean(
    heartbeat &&
      heartbeat.visible === true &&
      (heartbeat.status === "playing" || heartbeat.status === "paused") &&
      Number.isFinite(heartbeat.receivedAt) &&
      now - heartbeat.receivedAt <= YOUTUBE_HEARTBEAT_STALE_MS,
  );
}

function getFallbackMetadata(videoId) {
  return {
    title: "YouTube video",
    authorName: "YouTube",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

function trimMetadataCache() {
  while (metadataCache.size > YOUTUBE_METADATA_CACHE_MAX_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value;

    if (oldestKey === undefined) {
      break;
    }

    metadataCache.delete(oldestKey);
  }
}

async function fetchYouTubeMetadata(videoId) {
  const cached = metadataCache.get(videoId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pending = pendingMetadata.get(videoId);

  if (pending) {
    return pending;
  }

  const request = (async () => {
    const url = new URL(YOUTUBE_OEMBED_URL);
    url.searchParams.set(
      "url",
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    );
    url.searchParams.set("format", "json");

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Smart-Mirror-OS/0.0.0 youtube-oembed (github.com/quincyDaVinci/Smart-Mirror-OS)",
        },
        signal: AbortSignal.timeout(YOUTUBE_METADATA_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`YouTube oEmbed gaf status ${response.status}`);
      }

      const payload = await response.json();
      const fallback = getFallbackMetadata(videoId);
      const value = {
        title:
          typeof payload.title === "string" && payload.title.trim().length > 0
            ? payload.title.trim()
            : fallback.title,
        authorName:
          typeof payload.author_name === "string" &&
          payload.author_name.trim().length > 0
            ? payload.author_name.trim()
            : fallback.authorName,
        thumbnailUrl:
          typeof payload.thumbnail_url === "string" &&
          payload.thumbnail_url.trim().length > 0
            ? payload.thumbnail_url.trim()
            : fallback.thumbnailUrl,
      };

      metadataCache.set(videoId, {
        value,
        expiresAt: Date.now() + YOUTUBE_METADATA_CACHE_TTL_MS,
      });
      trimMetadataCache();
      return value;
    } catch {
      const value = getFallbackMetadata(videoId);
      metadataCache.set(videoId, {
        value,
        expiresAt: Date.now() + YOUTUBE_METADATA_MISS_TTL_MS,
      });
      trimMetadataCache();
      return value;
    }
  })();

  pendingMetadata.set(videoId, request);

  try {
    return await request;
  } finally {
    pendingMetadata.delete(videoId);
  }
}

function createYouTubeMedia(heartbeat, metadata) {
  return {
    source: "youtube",
    status: heartbeat.status,
    kind: "video",
    title: metadata.title,
    subtitle: metadata.authorName,
    secondaryText: "YouTube",
    sourceItemId: heartbeat.videoId,
    playSessionId: `youtube:${heartbeat.videoId}`,
    progressMs: heartbeat.progressMs,
    durationMs: heartbeat.durationMs,
    artworkUrl: metadata.thumbnailUrl,
    deviceName: YOUTUBE_DEVICE_NAME,
    userName: null,
    isLiked: null,
    lastUpdatedAt: heartbeat.receivedAt,
  };
}

async function recordYouTubeHeartbeat(input) {
  const normalized = normalizeYouTubeHeartbeat(input);

  if (!normalized) {
    return {
      accepted: false,
      refreshNeeded: false,
    };
  }

  const previous = latestHeartbeat;
  const receivedAt = Date.now();
  latestHeartbeat = {
    ...normalized,
    receivedAt,
  };

  const active = isYouTubeHeartbeatActive(latestHeartbeat, receivedAt);

  if (active) {
    const metadata = await fetchYouTubeMetadata(latestHeartbeat.videoId);
    latestMedia = createYouTubeMedia(latestHeartbeat, metadata);
  } else {
    latestMedia = null;
  }

  const previousActive = isYouTubeHeartbeatActive(previous, receivedAt);
  const refreshNeeded =
    previousActive !== active ||
    previous?.videoId !== latestHeartbeat.videoId ||
    previous?.status !== latestHeartbeat.status ||
    previous?.visible !== latestHeartbeat.visible;

  return {
    accepted: true,
    refreshNeeded,
  };
}

function getYouTubeNowPlaying(now = Date.now()) {
  if (!latestHeartbeat) {
    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "idle",
        message: "Nog geen YouTube heartbeat ontvangen.",
        lastCheckedAt: null,
      },
    };
  }

  if (!isYouTubeHeartbeatActive(latestHeartbeat, now) || !latestMedia) {
    const stale =
      Number.isFinite(latestHeartbeat.receivedAt) &&
      now - latestHeartbeat.receivedAt > YOUTUBE_HEARTBEAT_STALE_MS;

    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "ok",
        message: stale
          ? "YouTube heartbeat verlopen."
          : "Geen actieve YouTube playback.",
        lastCheckedAt: latestHeartbeat.receivedAt,
      },
    };
  }

  return {
    media: latestMedia,
    providerStatus: {
      enabled: true,
      status: "ok",
      message: null,
      lastCheckedAt: latestHeartbeat.receivedAt,
    },
  };
}

function resetYouTubeNowPlayingForTests() {
  metadataCache.clear();
  pendingMetadata.clear();
  latestHeartbeat = null;
  latestMedia = null;
}

module.exports = {
  recordYouTubeHeartbeat,
  getYouTubeNowPlaying,
  normalizeYouTubeHeartbeat,
  isYouTubeHeartbeatActive,
  getFallbackMetadata,
  resetYouTubeNowPlayingForTests,
};
