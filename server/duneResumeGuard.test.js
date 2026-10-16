const test = require("node:test");
const assert = require("node:assert/strict");
const { createDuneResumeGuard } = require("./duneResumeGuard");
const { createMediaPauseTimeoutTracker } = require("./mediaPauseTimeout");

function media(progressMs, status = "playing", session = "session-1") {
  return {
    source: "dune", status, progressMs,
    playSessionId: session, sourceItemId: "item-1",
    durationMs: 7200000,
    _duneJellyfinMatchType: "path",
    _duneJellyfinDurationMs: 7200000,
  };
}
function checkpoint(progressMs, reason = "stop", session = "session-1") {
  return {
    sourceItemId: "item-1", playSessionId: session,
    progressMs, matchType: "path", reason, durationMs: 7200000,
  };
}
function harness(savedMs, seekAccepted = true) {
  let time = 100000;
  const writes = [];
  const seeks = [];
  const guard = createDuneResumeGuard({
    now: () => time,
    readPosition: async () => savedMs,
    seek: async target => { seeks.push(target); return seekAccepted; },
    writeCheckpoint: async cp => { writes.push(cp); },
    logger: { log() {}, warn() {}, error() {} },
  });
  return {
    guard, writes, seeks,
    advance(ms) { time += ms; },
    observe(m, cps = []) { return guard.observe(m, cps); },
  };
}

test("seeks to Jellyfin resume and protects accidental restart/early exit", async () => {
  const h = harness(74 * 60000);
  await h.observe(media(0));
  assert.deepEqual(h.seeks, [74 * 60000]);
  h.advance(1000);
  await h.observe(media(74 * 60000));
  h.advance(60000);
  await h.observe(media(75 * 60000), [checkpoint(75 * 60000, "interval")]);
  h.advance(1000);
  await h.observe(null, [checkpoint(75 * 60000)]);
  assert.equal(h.writes.length, 0);
});

test("writes after three minutes of observed playback, not three minutes paused", async () => {
  const h = harness(74 * 60000);
  await h.observe(media(0));
  h.advance(1000);
  await h.observe(media(74 * 60000));
  h.advance(60000);
  await h.observe(media(75 * 60000));
  h.advance(60000);
  await h.observe(media(75 * 60000, "paused"));
  h.advance(240000);
  await h.observe(media(75 * 60000, "paused"), [checkpoint(75 * 60000, "interval")]);
  assert.equal(h.writes.length, 0);
  h.advance(60000);
  await h.observe(media(76 * 60000));
  h.advance(60000);
  await h.observe(media(77 * 60000));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].reason, "resume-confirmed");
});

test("manual seek during confirmation resets playback clock", async () => {
  const h = harness(70 * 60000, false);
  await h.observe(media(0));
  h.advance(120000);
  await h.observe(media(2 * 60000));
  h.advance(1000);
  await h.observe(media(40 * 60000));
  h.advance(120000);
  await h.observe(media(42 * 60000));
  assert.equal(h.writes.length, 0);
  h.advance(60000);
  await h.observe(media(43 * 60000));
  assert.equal(h.writes.length, 1);
});

test("lookup failures never send checkpoints", async () => {
  const h = harness(null);
  await h.observe(media(0));
  h.advance(300000);
  await h.observe(media(5 * 60000), [checkpoint(5 * 60000, "interval")]);
  await h.observe(null, [checkpoint(5 * 60000)]);
  assert.equal(h.writes.length, 0);
  assert.equal(h.seeks.length, 0);
});

test("old stop checkpoint cannot inherit new file session approval", async () => {
  const h = harness(0);
  await h.observe(media(1000, "playing", "old"));
  h.advance(5000);
  await h.observe(media(1000, "playing", "new"), [checkpoint(1000, "stop", "old")]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].playSessionId, "old");
});

for (const source of ["jellyfin", "youtube"]) {
  test(source + " paused expires and resumed playback resets timeout", () => {
    const filter = createMediaPauseTimeoutTracker(source);
    const m = { source, status: "paused", playSessionId: "s1", title: "Film" };
    assert.equal(filter.filter(m, 10000, 100).timedOut, false);
    assert.equal(filter.filter(m, 10000, 10100).timedOut, true);
    assert.equal(filter.filter({ ...m, status: "playing" }, 10000, 10101).timedOut, false);
    assert.equal(filter.filter(m, 10000, 10102).timedOut, false);
  });
}
