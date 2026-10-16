const { getJellyfinSecrets } = require("./secretsStore");

const DUNE_JELLYFIN_PROGRESS_INTERVAL_MS = 2 * 60 * 1000;
const JELLYFIN_PROGRESS_REQUEST_TIMEOUT_MS = 5000;
const JELLYFIN_USER_CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_PROGRESS_MS = 1000;

function msToTicks(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) : null;
}

function normalizeCheckpointMedia(media) {
  if (
    !media ||
    media.source !== "dune" ||
    (media.status !== "playing" && media.status !== "paused") ||
    typeof media.sourceItemId !== "string" ||
    media.sourceItemId.length === 0 ||
    typeof media.playSessionId !== "string" ||
    media.playSessionId.length === 0 ||
    !Number.isFinite(Number(media.progressMs)) ||
    Number(media.progressMs) < MIN_PROGRESS_MS
  ) {
    return null;
  }

  return {
    source: "dune",
    status: media.status,
    sourceItemId: media.sourceItemId,
    playSessionId: media.playSessionId,
    progressMs: Math.max(0, Math.round(Number(media.progressMs))),
    durationMs: Number.isFinite(Number(media.durationMs))
      ? Math.max(0, Math.round(Number(media.durationMs)))
      : null,
    jellyfinDurationMs: Number.isFinite(Number(media._duneJellyfinDurationMs))
      ? Math.max(0, Math.round(Number(media._duneJellyfinDurationMs)))
      : null,
    matchType:
      media._duneJellyfinMatchType === "path" ||
      media._duneJellyfinMatchType === "imdb"
        ? media._duneJellyfinMatchType
        : null,
  };
}

function createCheckpoint(media, reason, observedAt) {
  return {
    ...media,
    reason,
    observedAt,
  };
}

function createDuneProgressCheckpointTracker({
  intervalMs = DUNE_JELLYFIN_PROGRESS_INTERVAL_MS,
} = {}) {
  let previousMedia = null;
  let lastCheckpointAt = null;

  function observe(media, now = Date.now()) {
    const currentMedia = normalizeCheckpointMedia(media);
    const checkpoints = [];

    const sessionChanged =
      previousMedia &&
      (!currentMedia ||
        currentMedia.playSessionId !== previousMedia.playSessionId);

    if (sessionChanged) {
      checkpoints.push(createCheckpoint(previousMedia, "stop", now));
      lastCheckpointAt = null;
    }

    if (!currentMedia) {
      previousMedia = null;
      lastCheckpointAt = null;
      return checkpoints;
    }

    const isNewSession =
      !previousMedia ||
      currentMedia.playSessionId !== previousMedia.playSessionId;

    if (isNewSession) {
      lastCheckpointAt = now;

      if (currentMedia.status === "paused") {
        checkpoints.push(createCheckpoint(currentMedia, "pause", now));
        lastCheckpointAt = now;
      }

      previousMedia = currentMedia;
      return checkpoints;
    }

    const enteredPause =
      previousMedia.status !== "paused" && currentMedia.status === "paused";

    if (enteredPause) {
      checkpoints.push(createCheckpoint(currentMedia, "pause", now));
      lastCheckpointAt = now;
    } else if (
      lastCheckpointAt === null ||
      now - lastCheckpointAt >= Math.max(0, Number(intervalMs) || 0)
    ) {
      checkpoints.push(createCheckpoint(currentMedia, "interval", now));
      lastCheckpointAt = now;
    }

    previousMedia = currentMedia;
    return checkpoints;
  }

  function reset() {
    previousMedia = null;
    lastCheckpointAt = null;
  }

  return {
    observe,
    reset,
  };
}

function isSafeDuneJellyfinCheckpoint(checkpoint) {
  if (
    !checkpoint ||
    typeof checkpoint.sourceItemId !== "string" ||
    checkpoint.sourceItemId.length === 0 ||
    !Number.isFinite(Number(checkpoint.progressMs)) ||
    Number(checkpoint.progressMs) < MIN_PROGRESS_MS
  ) {
    return false;
  }

  if (checkpoint.matchType === "path") {
    return true;
  }

  if (checkpoint.matchType !== "imdb") {
    return false;
  }

  const duneDurationMs = Number(checkpoint.durationMs);
  const jellyfinDurationMs = Number(checkpoint.jellyfinDurationMs);

  if (
    !Number.isFinite(duneDurationMs) ||
    duneDurationMs <= 0 ||
    !Number.isFinite(jellyfinDurationMs) ||
    jellyfinDurationMs <= 0
  ) {
    return false;
  }

  const allowedDifferenceMs = Math.max(
    2 * 60 * 1000,
    Math.round(jellyfinDurationMs * 0.02),
  );

  return Math.abs(duneDurationMs - jellyfinDurationMs) <= allowedDifferenceMs;
}

function createDuneJellyfinProgressSync({
  fetchImpl = fetch,
  getSecrets = getJellyfinSecrets,
  now = Date.now,
  logger = console,
} = {}) {
  let userCache = null;
  let queue = Promise.resolve();
  const warned = new Set();

  function warnOnce(key, message, meta = undefined) {
    if (warned.has(key)) {
      return;
    }

    warned.add(key);
    logger.warn("[dune-progress]", message, meta ?? "");
  }

  async function resolveTargetUser() {
    const secrets = getSecrets();
    const baseUrl =
      typeof secrets.baseUrl === "string" ? secrets.baseUrl.trim() : "";
    const apiKey =
      typeof secrets.apiKey === "string" ? secrets.apiKey.trim() : "";
    const userName =
      typeof secrets.userName === "string" ? secrets.userName.trim() : "";

    if (!baseUrl || !apiKey || !userName) {
      warnOnce(
        "config-missing",
        "Jellyfin progress sync overgeslagen: baseUrl, apiKey en exacte User Filter zijn verplicht.",
      );
      return null;
    }

    if (
      userCache &&
      userCache.baseUrl === baseUrl &&
      userCache.apiKey === apiKey &&
      userCache.userName === userName &&
      userCache.expiresAt > now()
    ) {
      return userCache;
    }

    const usersUrl = new URL("/Users", baseUrl);
    const response = await fetchImpl(usersUrl, {
      headers: {
        "X-MediaBrowser-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JELLYFIN_PROGRESS_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      warnOnce(
        "users-http-" + response.status,
        "Jellyfin user-identiteit kon niet worden geverifieerd.",
        { status: response.status },
      );
      return null;
    }

    const users = await response.json();
    const matches = Array.isArray(users)
      ? users.filter(
          (user) =>
            typeof user?.Name === "string" &&
            user.Name.trim() === userName &&
            typeof user?.Id === "string" &&
            user.Id.length > 0,
        )
      : [];

    if (matches.length !== 1) {
      warnOnce(
        "user-match-" + matches.length,
        "Jellyfin progress sync geblokkeerd: User Filter moet exact één gebruiker matchen.",
        { configuredUserName: userName, matchCount: matches.length },
      );
      return null;
    }

    userCache = {
      baseUrl,
      apiKey,
      userName,
      userId: matches[0].Id,
      expiresAt: now() + JELLYFIN_USER_CACHE_TTL_MS,
    };

    return userCache;
  }

  async function readSavedPosition(media) {
    if (!isSafeDuneJellyfinCheckpoint({
      sourceItemId: media?.sourceItemId,
      progressMs: Math.max(1000, Number(media?.progressMs) || 0),
      matchType: media?._duneJellyfinMatchType,
      durationMs: media?.durationMs,
      jellyfinDurationMs: media?._duneJellyfinDurationMs,
    })) return null;

    const targetUser = await resolveTargetUser();
    if (!targetUser) return null;

    const url = new URL(
      `/Users/${encodeURIComponent(targetUser.userId)}/Items/${encodeURIComponent(media.sourceItemId)}`,
      targetUser.baseUrl,
    );
    const response = await fetchImpl(url, {
      headers: {
        "X-MediaBrowser-Token": targetUser.apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JELLYFIN_PROGRESS_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const item = await response.json();
    if (item?.Id !== media.sourceItemId) return null;
    const ticks = Number(item?.UserData?.PlaybackPositionTicks);
    return Number.isFinite(ticks) && ticks >= 0 ? Math.floor(ticks / 10000) : null;
  }

  async function syncCheckpoint(checkpoint) {
    if (!isSafeDuneJellyfinCheckpoint(checkpoint)) {
      warnOnce(
        "unsafe-match-" + String(checkpoint?.matchType ?? "none"),
        "Dune progress sync overgeslagen: Jellyfin item-match is niet veilig genoeg.",
        {
          matchType: checkpoint?.matchType ?? null,
          itemId: checkpoint?.sourceItemId ?? null,
        },
      );
      return {
        ok: false,
        reason: "unsafe-match",
      };
    }

    const targetUser = await resolveTargetUser();

    if (!targetUser) {
      return {
        ok: false,
        reason: "user-unresolved",
      };
    }

    const positionTicks = msToTicks(checkpoint.progressMs);
    if (positionTicks === null) {
      return {
        ok: false,
        reason: "invalid-progress",
      };
    }

    const requestOptions = {
      method: "POST",
      headers: {
        "X-MediaBrowser-Token": targetUser.apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        PlaybackPositionTicks: positionTicks,
      }),
      signal: AbortSignal.timeout(JELLYFIN_PROGRESS_REQUEST_TIMEOUT_MS),
    };

    const currentUrl = new URL(
      `/UserItems/${encodeURIComponent(checkpoint.sourceItemId)}/UserData`,
      targetUser.baseUrl,
    );
    currentUrl.searchParams.set("userId", targetUser.userId);

    let response = await fetchImpl(currentUrl, requestOptions);
    let endpoint = "current";

    if (response.status === 404 || response.status === 405) {
      const legacyUrl = new URL(
        `/Users/${encodeURIComponent(targetUser.userId)}/Items/${encodeURIComponent(checkpoint.sourceItemId)}/UserData`,
        targetUser.baseUrl,
      );
      response = await fetchImpl(legacyUrl, {
        ...requestOptions,
        signal: AbortSignal.timeout(JELLYFIN_PROGRESS_REQUEST_TIMEOUT_MS),
      });
      endpoint = "legacy";
    }

    if (!response.ok) {
      warnOnce(
        "write-http-" + response.status,
        "Jellyfin progress write geweigerd.",
        {
          status: response.status,
          itemId: checkpoint.sourceItemId,
          reason: checkpoint.reason,
        },
      );
      return {
        ok: false,
        reason: "write-http-" + response.status,
      };
    }

    let savedPositionTicks = null;
    try {
      const body = await response.json();
      savedPositionTicks = Number.isFinite(Number(body?.PlaybackPositionTicks))
        ? Number(body.PlaybackPositionTicks)
        : null;
    } catch {
      // A successful response is sufficient; Jellyfin versions may vary here.
    }

    logger.log("[dune-progress] Jellyfin voortgang bijgewerkt", {
      itemId: checkpoint.sourceItemId,
      reason: checkpoint.reason,
      progressMs: checkpoint.progressMs,
      savedPositionTicks,
      endpoint,
    });

    return {
      ok: true,
      reason: checkpoint.reason,
      endpoint,
      itemId: checkpoint.sourceItemId,
      progressMs: checkpoint.progressMs,
      positionTicks,
      savedPositionTicks,
    };
  }

  function enqueue(checkpoint) {
    queue = queue
      .then(() => syncCheckpoint(checkpoint))
      .catch((error) => {
        logger.error("[dune-progress] Jellyfin progress sync mislukt", {
          reason: checkpoint?.reason ?? null,
          itemId: checkpoint?.sourceItemId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          ok: false,
          reason: "exception",
        };
      });

    return queue;
  }

  function clearUserCache() {
    userCache = null;
    warned.clear();
  }

  return {
    enqueue,
    syncCheckpoint,
    readSavedPosition,
    clearUserCache,
  };
}

module.exports = {
  DUNE_JELLYFIN_PROGRESS_INTERVAL_MS,
  msToTicks,
  normalizeCheckpointMedia,
  createDuneProgressCheckpointTracker,
  isSafeDuneJellyfinCheckpoint,
  createDuneJellyfinProgressSync,
};
