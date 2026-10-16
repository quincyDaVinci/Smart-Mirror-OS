// Pause filtering for sources whose providers keep reporting paused indefinitely.
// A stable session key prevents each poll from restarting the timeout.
function createMediaPauseTimeoutTracker(source) {
  let pausedKey = null;
  let pausedSince = null;

  function filter(media, timeoutMs, now = Date.now()) {
    if (!media || media.source !== source || media.status !== "paused") {
      pausedKey = null;
      pausedSince = null;
      return { media, timedOut: false };
    }
    const key = [
      media.playSessionId ?? "",
      media.sourceItemId ?? "",
      media.kind ?? "",
      media.title ?? "",
      media.durationMs ?? "",
      media.deviceName ?? "",
    ].join("\n");
    if (pausedKey !== key || pausedSince === null) {
      pausedKey = key;
      pausedSince = now;
      return { media, timedOut: false };
    }
    const delay = Number.isFinite(Number(timeoutMs))
      ? Math.max(0, Number(timeoutMs))
      : 0;
    return now - pausedSince >= delay
      ? { media: null, timedOut: true }
      : { media, timedOut: false };
  }

  return { filter };
}

module.exports = { createMediaPauseTimeoutTracker };
