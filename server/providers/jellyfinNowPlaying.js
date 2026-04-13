const CHECKED_IDLE_MESSAGE = "Geen actieve Jellyfin sessie.";

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

function buildSecondaryText(item, session) {
  if (!item) {
    return "";
  }

  if (item.Type === "Audio") {
    return item.Album ?? "";
  }

  if (item.Type === "Episode") {
    return session.DeviceName ?? "";
  }

  if (item.Type === "Movie") {
    return session.DeviceName ?? "";
  }

  return "";
}

function buildArtworkUrl(baseUrl, itemId, apiKey) {
  if (!itemId) {
    return null;
  }

  const url = new URL(`/Items/${itemId}/Images/Primary`, baseUrl);
  url.searchParams.set("maxWidth", "500");
  url.searchParams.set("quality", "90");
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
  return sessions
    .filter((session) => Boolean(session.NowPlayingItem))
    .sort(
      (a, b) =>
        getSessionScore(b, preferredUserName, preferredDeviceName) -
        getSessionScore(a, preferredUserName, preferredDeviceName),
    )[0] ?? null;
}

async function fetchJellyfinNowPlaying() {
  const baseUrl = process.env.JELLYFIN_BASE_URL;
  const apiKey = process.env.JELLYFIN_API_KEY;
  const preferredUserName = process.env.JELLYFIN_USER_NAME ?? "";
  const preferredDeviceName = process.env.JELLYFIN_DEVICE_NAME ?? "";
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
      secondaryText: buildSecondaryText(item, bestSession),
      artworkUrl: buildArtworkUrl(baseUrl, item.Id, apiKey),
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