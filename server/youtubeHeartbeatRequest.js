function isAllowedYouTubeHeartbeatRequest(headers = {}) {
  const origin =
    typeof headers.origin === "string" ? headers.origin.trim() : "";
  const userAgent =
    typeof headers["user-agent"] === "string"
      ? headers["user-agent"]
      : "";

  if (origin === "https://www.youtube.com") {
    return true;
  }

  if (origin !== "null") {
    return false;
  }

  return (
    /LG Browser\//i.test(userAgent) &&
    /webOS\.TV-/i.test(userAgent)
  );
}

module.exports = {
  isAllowedYouTubeHeartbeatRequest,
};
