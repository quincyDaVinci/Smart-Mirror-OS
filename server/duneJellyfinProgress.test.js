const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DUNE_JELLYFIN_PROGRESS_INTERVAL_MS,
  msToTicks,
  createDuneProgressCheckpointTracker,
  isSafeDuneJellyfinCheckpoint,
  createDuneJellyfinProgressSync,
} = require("./duneJellyfinProgress");

function dune({
  status = "playing",
  progressMs = 300000,
  session = "dune-session-1",
  itemId = "item-1",
  matchType = "path",
  durationMs = 7200000,
  jellyfinDurationMs = 7200000,
} = {}) {
  return {
    source: "dune",
    status,
    sourceItemId: itemId,
    playSessionId: session,
    progressMs,
    durationMs,
    _duneJellyfinMatchType: matchType,
    _duneJellyfinDurationMs: jellyfinDurationMs,
  };
}

test("converts milliseconds to Jellyfin ticks", () => {
  assert.equal(msToTicks(360000), 3600000000);
});

test("checkpoints every two minutes and immediately on pause and stop", () => {
  const tracker = createDuneProgressCheckpointTracker();

  assert.deepEqual(tracker.observe(dune(), 1000), []);

  const interval = tracker.observe(
    dune({ progressMs: 420000 }),
    1000 + DUNE_JELLYFIN_PROGRESS_INTERVAL_MS,
  );
  assert.equal(interval.length, 1);
  assert.equal(interval[0].reason, "interval");
  assert.equal(interval[0].progressMs, 420000);

  const pause = tracker.observe(
    dune({ status: "paused", progressMs: 421000 }),
    1000 + DUNE_JELLYFIN_PROGRESS_INTERVAL_MS + 5000,
  );
  assert.equal(pause.length, 1);
  assert.equal(pause[0].reason, "pause");

  const stopped = tracker.observe(
    null,
    1000 + DUNE_JELLYFIN_PROGRESS_INTERVAL_MS + 10000,
  );
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].reason, "stop");
  assert.equal(stopped[0].progressMs, 421000);
});

test("keeps checkpointing a long-paused Dune session every two minutes", () => {
  const tracker = createDuneProgressCheckpointTracker();

  tracker.observe(dune({ status: "paused" }), 1000);

  const checkpoint = tracker.observe(
    dune({ status: "paused" }),
    1000 + DUNE_JELLYFIN_PROGRESS_INTERVAL_MS,
  );

  assert.equal(checkpoint.length, 1);
  assert.equal(checkpoint[0].reason, "interval");
});

test("IMDb fallback requires close duration but exact path does not", () => {
  assert.equal(
    isSafeDuneJellyfinCheckpoint({
      ...dune({ matchType: "path", durationMs: 7000000 }),
      matchType: "path",
      jellyfinDurationMs: 7200000,
    }),
    true,
  );

  assert.equal(
    isSafeDuneJellyfinCheckpoint({
      ...dune({
        matchType: "imdb",
        durationMs: 7200000,
        jellyfinDurationMs: 7250000,
      }),
      matchType: "imdb",
      jellyfinDurationMs: 7250000,
    }),
    true,
  );

  assert.equal(
    isSafeDuneJellyfinCheckpoint({
      ...dune({
        matchType: "imdb",
        durationMs: 7200000,
        jellyfinDurationMs: 7800000,
      }),
      matchType: "imdb",
      jellyfinDurationMs: 7800000,
    }),
    false,
  );
});

test("writes only PlaybackPositionTicks to the exact configured Jellyfin user", async () => {
  const calls = [];
  const responses = [
    {
      ok: true,
      json: async () => [
        { Id: "user-other", Name: "Other" },
        { Id: "user-quincy", Name: "Quincy" },
      ],
    },
    {
      ok: true,
      json: async () => ({
        PlaybackPositionTicks: 3600000000,
      }),
    },
  ];

  const sync = createDuneJellyfinProgressSync({
    getSecrets: () => ({
      baseUrl: "http://jellyfin.local:8096",
      apiKey: "test-key",
      userName: "Quincy",
    }),
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url: String(url),
        options,
      });
      return responses.shift();
    },
    now: () => 1000,
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  const result = await sync.syncCheckpoint({
    sourceItemId: "item-1",
    playSessionId: "dune-session-1",
    progressMs: 360000,
    durationMs: 7200000,
    jellyfinDurationMs: 7200000,
    matchType: "path",
    reason: "interval",
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://jellyfin.local:8096/Users");
  assert.equal(
    calls[1].url,
    "http://jellyfin.local:8096/UserItems/item-1/UserData?userId=user-quincy",
  );
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    PlaybackPositionTicks: 3600000000,
  });
});

test("refuses to write when User Filter is missing", async () => {
  let fetchCalled = false;
  const sync = createDuneJellyfinProgressSync({
    getSecrets: () => ({
      baseUrl: "http://jellyfin.local:8096",
      apiKey: "test-key",
      userName: null,
    }),
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    },
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  const result = await sync.syncCheckpoint({
    sourceItemId: "item-1",
    playSessionId: "dune-session-1",
    progressMs: 360000,
    durationMs: 7200000,
    jellyfinDurationMs: 7200000,
    matchType: "path",
    reason: "pause",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "user-unresolved");
  assert.equal(fetchCalled, false);
});

test("falls back to legacy Jellyfin user-data route on 404", async () => {
  const calls = [];
  const responses = [
    {
      ok: true,
      status: 200,
      json: async () => [{ Id: "user-quincy", Name: "Quincy" }],
    },
    {
      ok: false,
      status: 404,
      json: async () => ({}),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        PlaybackPositionTicks: 3600000000,
      }),
    },
  ];

  const sync = createDuneJellyfinProgressSync({
    getSecrets: () => ({
      baseUrl: "http://jellyfin.local:8096",
      apiKey: "test-key",
      userName: "Quincy",
    }),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return responses.shift();
    },
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  const result = await sync.syncCheckpoint({
    sourceItemId: "item-1",
    playSessionId: "dune-session-1",
    progressMs: 360000,
    durationMs: 7200000,
    jellyfinDurationMs: 7200000,
    matchType: "path",
    reason: "stop",
  });

  assert.equal(result.ok, true);
  assert.equal(result.endpoint, "legacy");
  assert.equal(calls.length, 3);
  assert.equal(
    calls[2].url,
    "http://jellyfin.local:8096/Users/user-quincy/Items/item-1/UserData",
  );
});
