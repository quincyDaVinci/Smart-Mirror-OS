function getSpotifyMediaKey(media) {
  if (!media || media.source !== "spotify") {
    return null;
  }

  return [
    media.kind ?? "",
    media.title ?? "",
    media.subtitle ?? "",
    media.secondaryText ?? "",
    media.durationMs ?? "",
    media.deviceName ?? "",
  ].join("\n");
}

function createSpotifyPauseTimeoutTracker() {
  let pausedKey = null;
  let pausedSince = null;

  function filter(media, timeoutMs, now = Date.now()) {
    if (!media || media.source !== "spotify" || media.status !== "paused") {
      pausedKey = null;
      pausedSince = null;
      return {
        media,
        timedOut: false,
      };
    }

    const nextKey = getSpotifyMediaKey(media);

    if (pausedKey !== nextKey || pausedSince === null) {
      pausedKey = nextKey;
      pausedSince = now;

      return {
        media,
        timedOut: false,
      };
    }

    const safeTimeoutMs =
      Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 0
        ? Number(timeoutMs)
        : 0;

    if (now - pausedSince >= safeTimeoutMs) {
      return {
        media: null,
        timedOut: true,
      };
    }

    return {
      media,
      timedOut: false,
    };
  }

  function reset() {
    pausedKey = null;
    pausedSince = null;
  }

  return {
    filter,
    reset,
  };
}

module.exports = {
  getSpotifyMediaKey,
  createSpotifyPauseTimeoutTracker,
};
