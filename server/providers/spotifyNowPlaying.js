const { getSpotifySecrets } = require("../secretsStore");

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_CURRENTLY_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

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

  if (!response.ok) {
    let errorDetails = null;

    try {
      errorDetails = await response.text();
    } catch {
      errorDetails = null;
    }

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

async function fetchSpotifyNowPlaying() {
  const checkedAt = Date.now();

  const spotifySecrets = getSpotifySecrets();

  if (
    !spotifySecrets.clientId ||
    !spotifySecrets.clientSecret ||
    !spotifySecrets.refreshToken
  ) {
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

  const accessToken = await getSpotifyAccessToken();

  if (!accessToken) {
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

  if (response.status === 204) {
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
    cachedAccessToken = null;
    cachedAccessTokenExpiresAt = 0;

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

  if (!response.ok) {
    throw new Error(`Spotify gaf status ${response.status}`);
  }

  const payload = await response.json();
  const item = payload.item;
  const currentlyPlayingType = payload.currently_playing_type ?? "unknown";

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
