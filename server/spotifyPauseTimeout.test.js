const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSpotifyPauseTimeoutTracker,
} = require("./spotifyPauseTimeout");

function spotify(status, title = "Track") {
  return {
    source: "spotify",
    status,
    kind: "track",
    title,
    subtitle: "Artist",
    secondaryText: "Album",
    durationMs: 180000,
    deviceName: "Spotify device",
  };
}

test("keeps paused Spotify until the configured media exit timeout", () => {
  const tracker = createSpotifyPauseTimeoutTracker();

  assert.equal(tracker.filter(spotify("paused"), 10000, 1000).media?.source, "spotify");
  assert.equal(tracker.filter(spotify("paused"), 10000, 10999).media?.source, "spotify");

  const expired = tracker.filter(spotify("paused"), 10000, 11000);
  assert.equal(expired.media, null);
  assert.equal(expired.timedOut, true);
});

test("playing Spotify resets the paused timeout", () => {
  const tracker = createSpotifyPauseTimeoutTracker();

  tracker.filter(spotify("paused"), 10000, 1000);
  tracker.filter(spotify("playing"), 10000, 9000);

  const pausedAgain = tracker.filter(spotify("paused"), 10000, 20000);
  assert.equal(pausedAgain.media?.source, "spotify");
  assert.equal(pausedAgain.timedOut, false);
});

test("changing paused track starts a fresh timeout", () => {
  const tracker = createSpotifyPauseTimeoutTracker();

  tracker.filter(spotify("paused", "Track A"), 10000, 1000);
  const changed = tracker.filter(spotify("paused", "Track B"), 10000, 20000);

  assert.equal(changed.media?.title, "Track B");
  assert.equal(changed.timedOut, false);
});
