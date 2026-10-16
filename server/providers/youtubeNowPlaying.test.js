const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeYouTubeHeartbeat,
  isYouTubeHeartbeatActive,
  getFallbackMetadata,
} = require("./youtubeNowPlaying");

test("normalizes a valid LG YouTube heartbeat", () => {
  assert.deepEqual(
    normalizeYouTubeHeartbeat({
      videoId: "6l9CX6KSbuI",
      status: "playing",
      progressMs: 811727.4,
      durationMs: 1239504.4,
      visible: true,
    }),
    {
      videoId: "6l9CX6KSbuI",
      status: "playing",
      progressMs: 811727,
      durationMs: 1239504,
      visible: true,
    },
  );
});

test("rejects invalid video IDs and clamps progress to duration", () => {
  assert.equal(normalizeYouTubeHeartbeat({ videoId: "bad" }), null);

  const heartbeat = normalizeYouTubeHeartbeat({
    videoId: "6l9CX6KSbuI",
    status: "paused",
    progressMs: 20000,
    durationMs: 10000,
    visible: true,
  });

  assert.equal(heartbeat.progressMs, 10000);
});

test("requires visible, recent playing or paused playback", () => {
  const base = {
    videoId: "6l9CX6KSbuI",
    status: "playing",
    progressMs: 1000,
    durationMs: 2000,
    visible: true,
    receivedAt: 100000,
  };

  assert.equal(isYouTubeHeartbeatActive(base, 110000), true);
  assert.equal(isYouTubeHeartbeatActive({ ...base, visible: false }, 110000), false);
  assert.equal(isYouTubeHeartbeatActive({ ...base, status: "idle" }, 110000), false);
  assert.equal(isYouTubeHeartbeatActive(base, 116000), false);
});

test("builds a key-free thumbnail fallback from video ID", () => {
  assert.deepEqual(getFallbackMetadata("6l9CX6KSbuI"), {
    title: "YouTube video",
    authorName: "YouTube",
    thumbnailUrl: "https://i.ytimg.com/vi/6l9CX6KSbuI/hqdefault.jpg",
  });
});
