const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_MEDIA_SOURCE_PRIORITY,
  getActiveMediaSources,
  normalizeMediaSourcePriority,
  resolveMediaByPriority,
} = require("./mediaPriority");

function media(source, status = "playing") {
  return { source, status };
}

test("uses Dune > Jellyfin > YouTube > Spotify by default", () => {
  assert.deepEqual(DEFAULT_MEDIA_SOURCE_PRIORITY, [
    "dune",
    "jellyfin",
    "youtube",
    "spotify",
  ]);

  assert.equal(
    resolveMediaByPriority({
      duneMedia: media("dune"),
      jellyfinMedia: media("jellyfin"),
      youtubeMedia: media("youtube"),
      spotifyMedia: media("spotify"),
    }).source,
    "dune",
  );
});

test("uses configured priority for active playback", () => {
  assert.equal(
    resolveMediaByPriority({
      duneMedia: media("dune"),
      jellyfinMedia: media("jellyfin"),
      youtubeMedia: media("youtube"),
      spotifyMedia: media("spotify"),
      priority: ["spotify", "youtube", "jellyfin", "dune"],
    }).source,
    "spotify",
  );
});

test("manual override wins only while that source is active", () => {
  const sources = {
    duneMedia: media("dune"),
    jellyfinMedia: null,
    youtubeMedia: media("youtube"),
    spotifyMedia: media("spotify"),
  };

  assert.equal(
    resolveMediaByPriority({
      ...sources,
      overrideSource: "spotify",
    }).source,
    "spotify",
  );

  assert.equal(
    resolveMediaByPriority({
      ...sources,
      spotifyMedia: null,
      overrideSource: "spotify",
    }).source,
    "dune",
  );
});

test("paused playback counts as active", () => {
  assert.deepEqual(
    getActiveMediaSources({
      duneMedia: null,
      jellyfinMedia: media("jellyfin", "paused"),
      youtubeMedia: media("youtube", "playing"),
      spotifyMedia: media("spotify", "paused"),
    }),
    ["jellyfin", "youtube", "spotify"],
  );
});

test("active sources follow configured priority", () => {
  assert.deepEqual(
    getActiveMediaSources({
      duneMedia: media("dune"),
      jellyfinMedia: null,
      youtubeMedia: media("youtube"),
      spotifyMedia: media("spotify"),
      priority: ["spotify", "youtube", "dune", "jellyfin"],
    }),
    ["spotify", "youtube", "dune"],
  );
});

test("invalid configured priority falls back to default", () => {
  assert.deepEqual(
    normalizeMediaSourcePriority(["spotify", "youtube"]),
    DEFAULT_MEDIA_SOURCE_PRIORITY,
  );

  assert.deepEqual(
    normalizeMediaSourcePriority([
      "spotify",
      "spotify",
      "youtube",
      "dune",
    ]),
    DEFAULT_MEDIA_SOURCE_PRIORITY,
  );
});

test("falls back in configured order when nothing is active", () => {
  assert.equal(
    resolveMediaByPriority({
      duneMedia: null,
      jellyfinMedia: media("jellyfin", "idle"),
      youtubeMedia: media("youtube", "idle"),
      spotifyMedia: media("spotify", "idle"),
      priority: ["spotify", "youtube", "jellyfin", "dune"],
    }).source,
    "spotify",
  );
});
