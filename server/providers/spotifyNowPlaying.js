const { getSpotifySecrets } = require("../secretsStore");

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_CURRENTLY_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";
const SPOTIFY_SAVED_TRACKS_CONTAINS_URL =
  "https://api.spotify.com/v1/me/tracks/contains";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;
let spotifyRateLimitedUntil = 0;

const DEBUG_SPOTIFY = false;

function logSpotifyDebug(message, meta = null) {
  if (!DEBUG_SPOTIFY) {
    return;
  }

  if (meta === null) {
    console.log(`[spotify-debug] ${message}`);
    return;
  }

  console.log(`[spotify-debug] ${message}`, meta);
}

function parseRetryAfterToMs(retryAfterHeader) {
  if (
    typeof retryAfterHeader !== "string" ||
    retryAfterHeader.trim().length === 0
  ) {
    return null;
  }

  const asSeconds = Number(retryAfterHeader);

  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return asSeconds * 1000;
  }

  const asDateMs = Date.parse(retryAfterHeader);

  if (!Number.isFinite(asDateMs)) {
    return null;
  }

  const delta = asDateMs - Date.now();
  return delta > 0 ? delta : null;
}

function formatRateLimitWaitMessage(msRemaining) {
  const secondsRemaining = Math.max(1, Math.ceil(msRemaining / 1000));
  return `Spotify rate-limited, opnieuw proberen over ${secondsRemaining}s.`;
}

function resetSpotifyAccessTokenCache() {
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
}

function getBasicAuthorizationHeader(clientId, clientSecret) {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function refreshSpotifyAccessToken({
  clientId,
  clientSecret,
  refreshToken,
}) {
  logSpotifyDebug("refreshSpotifyAccessToken:start", {
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasRefreshToken: Boolean(refreshToken),
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthorizationHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  logSpotifyDebug("refreshSpotifyAccessToken:response", {
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    let errorDetails = null;

    try {
      errorDetails = await response.text();
    } catch {
      errorDetails = null;
    }

    logSpotifyDebug("refreshSpotifyAccessToken:failed", {
      status: response.status,
      errorDetails,
    });

    throw new Error(
      `Spotify token refresh gaf status ${response.status}${
        errorDetails ? ` · ${errorDetails}` : ""
      }`,
    );
  }

  const payload = await response.json();

  if (!payload.access_token) {
    throw new Error("Spotify token refresh gaf geen access_token terug");
  }

  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiresAt =
    Date.now() + Math.max((payload.expires_in ?? 3600) - 60, 60) * 1000;

  logSpotifyDebug("refreshSpotifyAccessToken:success", {
    expiresIn: payload.expires_in ?? 3600,
  });

  return cachedAccessToken;
}

async function getSpotifyAccessToken() {
  const spotifySecrets = getSpotifySecrets();

  if (
    !spotifySecrets.clientId ||
    !spotifySecrets.clientSecret ||
    !spotifySecrets.refreshToken
  ) {
    return null;
  }

  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now()) {
    return cachedAccessToken;
  }

  return refreshSpotifyAccessToken({
    clientId: spotifySecrets.clientId,
    clientSecret: spotifySecrets.clientSecret,
    refreshToken: spotifySecrets.refreshToken,
  });
}

function getSpotifyArtworkUrl(item) {
  if (!item) {
    return null;
  }

  if (Array.isArray(item.album?.images) && item.album.images.length > 0) {
    return item.album.images[0].url ?? null;
  }

  if (Array.isArray(item.images) && item.images.length > 0) {
    return item.images[0].url ?? null;
  }

  if (Array.isArray(item.show?.images) && item.show.images.length > 0) {
    return item.show.images[0].url ?? null;
  }

  return null;
}

function getSpotifySubtitle(item, currentlyPlayingType) {
  if (!item) {
    return "Er wordt nu niets afgespeeld";
  }

  if (currentlyPlayingType === "episode") {
    return item.show?.name ?? "Podcast";
  }

  if (Array.isArray(item.artists) && item.artists.length > 0) {
    return item.artists
      .map((artist) => artist.name)
      .filter(Boolean)
      .join(", ");
  }

  return "Onbekende artiest";
}

function getSpotifySecondaryText(item, currentlyPlayingType, deviceName) {
  if (!item) {
    return "";
  }

  if (currentlyPlayingType === "episode") {
    return deviceName ?? item.show?.publisher ?? "";
  }

  return item.album?.name ?? deviceName ?? "";
}

function getSpotifyKind(currentlyPlayingType) {
  if (currentlyPlayingType === "episode") {
    return "podcast";
  }

  if (currentlyPlayingType === "track") {
    return "track";
  }

  return "unknown";
}

function getProductionYear(item, currentlyPlayingType) {
  if (currentlyPlayingType !== "track") {
    return null;
  }

  const releaseDate = item.album?.release_date;

  if (typeof releaseDate !== "string" || releaseDate.length < 4) {
    return null;
  }

  const year = Number(releaseDate.slice(0, 4));

  return Number.isFinite(year) ? year : null;
}

async function fetchSpotifyTrackLikedState(accessToken, trackId) {
  if (!trackId) {
    return null;
  }

  const url = new URL(SPOTIFY_SAVED_TRACKS_CONTAINS_URL);
  url.searchParams.set("ids", trackId);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();

  if (!Array.isArray(payload) || typeof payload[0] !== "boolean") {
    return null;
  }

  return payload[0];
}

async function fetchSpotifyNowPlaying() {
  const checkedAt = Date.now();

  const spotifySecrets = getSpotifySecrets();

  logSpotifyDebug("fetchSpotifyNowPlaying:start", {
    checkedAt,
    hasClientId: Boolean(spotifySecrets.clientId),
    hasClientSecret: Boolean(spotifySecrets.clientSecret),
    hasRefreshToken: Boolean(spotifySecrets.refreshToken),
    redirectUri: spotifySecrets.redirectUri,
    spotifyRateLimitedUntil,
  });

  if (
    !spotifySecrets.clientId ||
    !spotifySecrets.clientSecret ||
    !spotifySecrets.refreshToken
  ) {
    logSpotifyDebug("fetchSpotifyNowPlaying:missing-secrets", {
      hasClientId: Boolean(spotifySecrets.clientId),
      hasClientSecret: Boolean(spotifySecrets.clientSecret),
      hasRefreshToken: Boolean(spotifySecrets.refreshToken),
    });

    return {
      media: null,
      providerStatus: {
        enabled: false,
        status: "idle",
        message: "Spotify is nog niet geconfigureerd.",
        lastCheckedAt: checkedAt,
      },
    };
  }

  if (spotifyRateLimitedUntil > checkedAt) {
    logSpotifyDebug("fetchSpotifyNowPlaying:rate-limited-short-circuit", {
      msRemaining: spotifyRateLimitedUntil - checkedAt,
    });

    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "ok",
        message: formatRateLimitWaitMessage(
          spotifyRateLimitedUntil - checkedAt,
        ),
        lastCheckedAt: checkedAt,
      },
    };
  }

  const accessToken = await getSpotifyAccessToken();

  if (!accessToken) {
    logSpotifyDebug("fetchSpotifyNowPlaying:no-access-token");

    return {
      media: null,
      providerStatus: {
        enabled: false,
        status: "error",
        message: "Spotify access token ontbreekt.",
        lastCheckedAt: checkedAt,
      },
    };
  }

  const response = await fetch(SPOTIFY_CURRENTLY_PLAYING_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  logSpotifyDebug("fetchSpotifyNowPlaying:currently-playing-response", {
    status: response.status,
    ok: response.ok,
  });

  if (response.status === 204) {
    logSpotifyDebug("fetchSpotifyNowPlaying:no-active-session-204");

    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "ok",
        message: "Geen actieve Spotify sessie.",
        lastCheckedAt: checkedAt,
      },
    };
  }

  if (response.status === 401) {
    logSpotifyDebug("fetchSpotifyNowPlaying:unauthorized-401");
    resetSpotifyAccessTokenCache();

    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "error",
        message: "Spotify autorisatie verlopen of ongeldig.",
        lastCheckedAt: checkedAt,
      },
    };
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterToMs(
      response.headers.get("retry-after"),
    );
    const boundedRetryAfterMs = Math.min(
      Math.max(retryAfterMs ?? 30000, 15000),
      5 * 60 * 1000,
    );

    spotifyRateLimitedUntil = checkedAt + boundedRetryAfterMs;

    logSpotifyDebug("fetchSpotifyNowPlaying:rate-limited-429", {
      retryAfterHeader: response.headers.get("retry-after"),
      retryAfterMs,
      boundedRetryAfterMs,
    });

    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "ok",
        message: formatRateLimitWaitMessage(boundedRetryAfterMs),
        lastCheckedAt: checkedAt,
      },
    };
  }

  if (!response.ok) {
    throw new Error(`Spotify gaf status ${response.status}`);
  }

  spotifyRateLimitedUntil = 0;

  const payload = await response.json();
  const item = payload.item;
  const currentlyPlayingType = payload.currently_playing_type ?? "unknown";

  logSpotifyDebug("fetchSpotifyNowPlaying:payload", {
    isPlaying: payload.is_playing,
    currentlyPlayingType,
    hasItem: Boolean(item),
    itemId: item?.id ?? null,
    itemName: item?.name ?? null,
    deviceName: payload.device?.name ?? null,
  });

  const isLiked =
    currentlyPlayingType === "track" && typeof item?.id === "string"
      ? await fetchSpotifyTrackLikedState(accessToken, item.id)
      : null;

  if (!item) {
    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "ok",
        message: "Geen actieve Spotify sessie.",
        lastCheckedAt: checkedAt,
      },
    };
  }

  return {
    media: {
      status: payload.is_playing ? "playing" : "paused",
      source: "spotify",
      kind: getSpotifyKind(currentlyPlayingType),
      title: item.name ?? "Onbekende titel",
      subtitle: getSpotifySubtitle(item, currentlyPlayingType),
      secondaryText: getSpotifySecondaryText(
        item,
        currentlyPlayingType,
        payload.device?.name ?? null,
      ),
      productionYear: getProductionYear(item, currentlyPlayingType),
      genres: [],
      communityRating: null,
      artworkUrl: getSpotifyArtworkUrl(item),
      progressMs:
        typeof payload.progress_ms === "number" ? payload.progress_ms : null,
      durationMs:
        typeof item.duration_ms === "number" ? item.duration_ms : null,
      deviceName: payload.device?.name ?? null,
      userName: "Spotify",
      isLiked,
      lastUpdatedAt: checkedAt,
    },
    providerStatus: {
      enabled: true,
      status: "ok",
      message: null,
      lastCheckedAt: checkedAt,
    },
  };
}

module.exports = {
  fetchSpotifyNowPlaying,
  resetSpotifyAccessTokenCache,
};
