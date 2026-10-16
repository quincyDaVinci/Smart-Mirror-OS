const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveMediaByPriority } = require("./mediaPriority");

function media(source, status = "playing") {
  return { source, status };
}

test("uses Dune > Jellyfin > YouTube > Spotify for active playback", () => {
  assert.equal(
    resolveMediaByPriority({
      duneMedia: media("dune"),
      jellyfinMedia: media("jellyfin"),
      youtubeMedia: media("youtube"),
      spotifyMedia: media("spotify"),
    }).source,
    "dune",
  );

  assert.equal(
    resolveMediaByPriority({
      duneMedia: null,
      jellyfinMedia: media("jellyfin"),
      youtubeMedia: media("youtube"),
      spotifyMedia: media("spotify"),
    }).source,
    "jellyfin",
  );

  assert.equal(
    resolveMediaByPriority({
      duneMedia: null,
      jellyfinMedia: null,
      youtubeMedia: media("youtube"),
      spotifyMedia: media("spotify"),
    }).source,
    "youtube",
  );
});

test("paused playback keeps the same source priority", () => {
  assert.equal(
    resolveMediaByPriority({
      duneMedia: null,
      jellyfinMedia: media("jellyfin", "paused"),
      youtubeMedia: media("youtube", "playing"),
      spotifyMedia: media("spotify", "playing"),
    }).source,
    "jellyfin",
  );

  assert.equal(
    resolveMediaByPriority({
      duneMedia: null,
      jellyfinMedia: null,
      youtubeMedia: media("youtube", "paused"),
      spotifyMedia: media("spotify", "playing"),
    }).source,
    "youtube",
  );
});

test("falls back in the same source order when nothing is active", () => {
  assert.equal(
    resolveMediaByPriority({
      duneMedia: null,
      jellyfinMedia: media("jellyfin", "idle"),
      youtubeMedia: media("youtube", "idle"),
      spotifyMedia: media("spotify", "idle"),
    }).source,
    "jellyfin",
  );
});
