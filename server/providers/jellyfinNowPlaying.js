const CHECKED_IDLE_MESSAGE = "Geen actieve Jellyfin sessie.";
const { getJellyfinSecrets } = require("../secretsStore");

function ticksToMs(ticks) {
  return typeof ticks === "number" ? Math.floor(ticks / 10000) : null;
}

function getMediaKind(itemType) {
  switch (itemType) {
    case "Movie":
      return "movie";
    case "Episode":
      return "episode";
    case "Audio":
      return "track";
    default:
      return "unknown";
  }
}

function buildSubtitle(item) {
  if (!item) {
    return "Er wordt nu niets afgespeeld";
  }

  if (item.Type === "Audio") {
    if (Array.isArray(item.Artists) && item.Artists.length > 0) {
      return item.Artists.join(", ");
    }

    return item.AlbumArtist ?? "Onbekende artiest";
  }

  if (item.Type === "Episode") {
    const season =
      typeof item.ParentIndexNumber === "number"
        ? `S${String(item.ParentIndexNumber).padStart(2, "0")}`
        : null;

    const episode =
      typeof item.IndexNumber === "number"
        ? `E${String(item.IndexNumber).padStart(2, "0")}`
        : null;

    return [item.SeriesName, season && episode ? `${season}${episode}` : null]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.Type === "Movie") {
    return item.ProductionYear ? `Film · ${item.ProductionYear}` : "Film";
  }

  return item.Type ?? "Onbekend";
}

function buildSecondaryText(item) {
  if (!item) {
    return "";
  }

  if (item.Type === "Audio") {
    return item.Album ?? "";
  }

  return "";
}

function getArtworkTargetItemId(item) {
  if (!item) {
    return null;
  }

  if (item.Type === "Episode") {
    return item.SeriesId ?? item.ParentPrimaryImageItemId ?? item.Id ?? null;
  }

  if (item.Type === "Audio") {
    return item.AlbumId ?? item.Id ?? null;
  }

  return item.Id ?? null;
}

function buildArtworkUrl(baseUrl, item, apiKey) {
  const artworkTargetItemId = getArtworkTargetItemId(item);

  if (!artworkTargetItemId) {
    return null;
  }

  const url = new URL(`/Items/${artworkTargetItemId}/Images/Primary`, baseUrl);
  url.searchParams.set("maxWidth", "1400");
  url.searchParams.set("quality", "96");
  url.searchParams.set("api_key", apiKey);

  return url.toString();
}

function getSessionScore(session, preferredUserName, preferredDeviceName) {
  if (!session?.NowPlayingItem) {
    return -1;
  }

  let score = 0;

  if (session.PlayState?.IsPaused === false) {
    score += 100;
  }

  if (preferredUserName && session.UserName === preferredUserName) {
    score += 20;
  }

  if (preferredDeviceName && session.DeviceName === preferredDeviceName) {
    score += 10;
  }

  if (session.PlayState?.PositionTicks) {
    score += 1;
  }

  return score;
}

function pickBestSession(sessions, preferredUserName, preferredDeviceName) {
  return (
    sessions
      .filter((session) => Boolean(session.NowPlayingItem))
      .sort(
        (a, b) =>
          getSessionScore(b, preferredUserName, preferredDeviceName) -
          getSessionScore(a, preferredUserName, preferredDeviceName),
      )[0] ?? null
  );
}

async function fetchJellyfinNowPlaying() {
  const jellyfinSecrets = getJellyfinSecrets();

  const baseUrl = jellyfinSecrets.baseUrl;
  const apiKey = jellyfinSecrets.apiKey;
  const preferredUserName = jellyfinSecrets.userName ?? "";
  const preferredDeviceName = jellyfinSecrets.deviceName ?? "";
  
  const checkedAt = Date.now();

  if (!baseUrl || !apiKey) {
    return {
      media: null,
      providerStatus: {
        enabled: false,
        status: "idle",
        message: "Jellyfin is nog niet geconfigureerd.",
        lastCheckedAt: checkedAt,
      },
    };
  }

  const sessionsUrl = new URL("/Sessions", baseUrl);
  sessionsUrl.searchParams.set("activeWithinSeconds", "90");

  const response = await fetch(sessionsUrl, {
    headers: {
      "X-MediaBrowser-Token": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Jellyfin gaf status ${response.status}`);
  }

  const sessions = await response.json();
  const bestSession = pickBestSession(
    Array.isArray(sessions) ? sessions : [],
    preferredUserName,
    preferredDeviceName,
  );

  if (!bestSession?.NowPlayingItem) {
    return {
      media: null,
      providerStatus: {
        enabled: true,
        status: "ok",
        message: CHECKED_IDLE_MESSAGE,
        lastCheckedAt: checkedAt,
      },
    };
  }

  const item = bestSession.NowPlayingItem;

  return {
    media: {
      status: bestSession.PlayState?.IsPaused ? "paused" : "playing",
      source: "jellyfin",
      kind: getMediaKind(item.Type),
      title: item.Name ?? "Onbekende titel",
      subtitle: buildSubtitle(item),
      secondaryText: buildSecondaryText(item),
      productionYear: item.ProductionYear ?? null,
      genres: Array.isArray(item.Genres) ? item.Genres : [],
      communityRating:
        typeof item.CommunityRating === "number" ? item.CommunityRating : null,
      artworkUrl: buildArtworkUrl(baseUrl, item, apiKey),
      progressMs: ticksToMs(bestSession.PlayState?.PositionTicks ?? null),
      durationMs: ticksToMs(item.RunTimeTicks ?? null),
      deviceName: bestSession.DeviceName ?? null,
      userName: bestSession.UserName ?? null,
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
  fetchJellyfinNowPlaying,
};
