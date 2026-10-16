const test = require("node:test");
const assert = require("node:assert/strict");
const { createDunePauseTimeoutTracker } = require("./dunePauseTimeout");

function dune(status, playSessionId = "dune-session-1") {
  return {
    source: "dune",
    status,
    kind: "movie",
    title: "Movie",
    playSessionId,
    sourceItemId: "jellyfin-item-1",
    durationMs: 7200000,
    deviceName: "Dune HD (Real Vision 4K)",
  };
}

test("keeps paused Dune active until media exit timeout", () => {
  const tracker = createDunePauseTimeoutTracker();

  assert.equal(
    tracker.filter(dune("paused"), 60000, 1000).media?.source,
    "dune",
  );
  assert.equal(
    tracker.filter(dune("paused"), 60000, 60999).media?.source,
    "dune",
  );

  const expired = tracker.filter(dune("paused"), 60000, 61000);
  assert.equal(expired.media, null);
  assert.equal(expired.timedOut, true);
});

test("resuming Dune resets paused timeout", () => {
  const tracker = createDunePauseTimeoutTracker();

  tracker.filter(dune("paused"), 60000, 1000);
  tracker.filter(dune("playing"), 60000, 30000);

  const pausedAgain = tracker.filter(dune("paused"), 60000, 80000);
  assert.equal(pausedAgain.media?.source, "dune");
  assert.equal(pausedAgain.timedOut, false);
});

test("new Dune session starts a fresh paused timeout", () => {
  const tracker = createDunePauseTimeoutTracker();

  tracker.filter(dune("paused", "dune-session-1"), 60000, 1000);
  const next = tracker.filter(
    dune("paused", "dune-session-2"),
    60000,
    90000,
  );

  assert.equal(next.media?.playSessionId, "dune-session-2");
  assert.equal(next.timedOut, false);
});
