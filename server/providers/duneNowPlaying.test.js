const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDuneStatus,
  getDuneRelativePath,
  matchesJellyfinPath,
  getJellyfinSearchTerms,
  getFileImdbId,
  findUniqueCandidate,
} = require("./duneNowPlaying");

const filename =
  "The Gentlemen - S01E08 - The Gospel According to Bobby Glass WEBDL-2160p.mkv";
const dunePath = "/tmp/mnt/smb/1/The Gentlemen/Season 1/" + filename;
const jellyfinPath = "/tv/The Gentlemen/Season 1/" + filename;

test("parses actual Dune file playback status", () => {
  const xml = [
    '<param name="player_state" value="file_playback"/>',
    '<param name="playback_state" value="playing"/>',
    '<param name="playback_url" value="' + dunePath + '"/>',
    '<param name="playback_duration" value="2594"/>',
    '<param name="playback_position" value="1212"/>',
  ].join("\n");

  const params = parseDuneStatus(xml);
  assert.equal(params.player_state, "file_playback");
  assert.equal(params.playback_state, "playing");
  assert.equal(params.playback_position, "1212");
  assert.equal(params.playback_duration, "2594");
  assert.equal(params.playback_url, dunePath);
});

test("matches relative directory and filename, excluding SMB and library root", () => {
  assert.equal(getDuneRelativePath(dunePath), ("The Gentlemen/Season 1/" + filename).toLowerCase());
  assert.ok(matchesJellyfinPath(dunePath, jellyfinPath));
  assert.ok(!matchesJellyfinPath(dunePath, "/movies/Other Title/" + filename));
  assert.ok(!matchesJellyfinPath(dunePath, "/tv/Other Title/Season 1/" + filename));
  assert.ok(!matchesJellyfinPath(dunePath, "/tv/The Gentlemen/Season 1/other.mkv"));
});

test("extracts the Jellyfin episode title for SearchTerm", () => {
  const terms = getJellyfinSearchTerms(dunePath);
  assert.equal(terms[0], "The Gospel According to Bobby Glass");
  assert.ok(terms.includes("The Gentlemen"));
});

test("supports movie filenames and decodes XML entities", () => {
  assert.deepEqual(getJellyfinSearchTerms("/tmp/mnt/smb/2/Movie Name (2024) 2160p.mkv"), ["Movie Name"]);
  assert.equal(parseDuneStatus('<param name="playback_url" value="Movie &amp; Film.mkv"/>').playback_url, "Movie & Film.mkv");
});


test("finds extended Lord of the Rings metadata despite punctuation and release tags", () => {
  const filename =
    "The Lord of the Rings The Fellowship of the Ring (2001) [imdbid-tt0120737] - Extended [Remux-2160p] [DV HDR10][TrueHD Atmos 7 1][HEVC]-FrameSToR.mkv";
  const path = "/tmp/mnt/smb/2/" + filename;

  assert.deepEqual(getJellyfinSearchTerms(path), [
    "The Lord of the Rings The Fellowship of the Ring",
    "Fellowship of the Ring",
  ]);
  assert.equal(getFileImdbId(path), "tt0120737");

  const movie = {
    Id: "lord-of-the-rings-movie",
    Name: "The Lord of the Rings: The Fellowship of the Ring",
    Path: "/movies/LOTR/Theatrical Edition.mkv",
    ProviderIds: { Imdb: "tt0120737" },
  };
  const unrelated = {
    Id: "wrong-movie",
    Name: "Fellowship",
    Path: "/movies/Other.mkv",
    ProviderIds: { Imdb: "tt9999999" },
  };

  assert.equal(findUniqueCandidate([unrelated, movie], path), movie);
  assert.equal(findUniqueCandidate([unrelated], path), null);
  assert.equal(findUniqueCandidate([movie, { ...movie, Id: "duplicate" }], path), null);
});

test("prefers exact Jellyfin media source path and never guesses by title alone", () => {
  const item = {
    Name: "The Gentlemen",
    Path: "/tv/Other Version.mkv",
    MediaSources: [{ Path: jellyfinPath }],
  };
  assert.equal(findUniqueCandidate([item], dunePath), item);
  assert.equal(findUniqueCandidate([{ Name: "The Gentlemen", Path: "/tv/Other.mkv" }], dunePath), null);
});
