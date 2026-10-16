const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAllowedYouTubeHeartbeatRequest,
} = require("./youtubeHeartbeatRequest");

test("accepts normal YouTube web origin", () => {
  assert.equal(
    isAllowedYouTubeHeartbeatRequest({
      origin: "https://www.youtube.com",
      "user-agent": "anything",
    }),
    true,
  );
});

test("accepts null origin from LG webOS YouTube app", () => {
  assert.equal(
    isAllowedYouTubeHeartbeatRequest({
      origin: "null",
      "user-agent":
        "LG Browser/8.00.00 (webOS.TV-2019), _TV_O18/05.50.00 (LG, OLED65C9PLA, wireless)",
    }),
    true,
  );
});

test("rejects null origin from non-LG clients", () => {
  assert.equal(
    isAllowedYouTubeHeartbeatRequest({
      origin: "null",
      "user-agent": "Mozilla/5.0",
    }),
    false,
  );
});

test("rejects unrelated origins", () => {
  assert.equal(
    isAllowedYouTubeHeartbeatRequest({
      origin: "http://192.168.68.50",
      "user-agent":
        "LG Browser/8.00.00 (webOS.TV-2019), _TV_O18/05.50.00 (LG, OLED65C9PLA, wireless)",
    }),
    false,
  );
});
