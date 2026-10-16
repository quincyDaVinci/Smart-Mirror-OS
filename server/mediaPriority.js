function isActiveMedia(media) {
  return Boolean(
    media &&
      (media.status === "playing" || media.status === "paused"),
  );
}

function resolveMediaByPriority({
  duneMedia,
  jellyfinMedia,
  youtubeMedia,
  spotifyMedia,
}) {
  if (isActiveMedia(duneMedia)) {
    return duneMedia;
  }

  if (isActiveMedia(jellyfinMedia)) {
    return jellyfinMedia;
  }

  if (isActiveMedia(youtubeMedia)) {
    return youtubeMedia;
  }

  if (isActiveMedia(spotifyMedia)) {
    return spotifyMedia;
  }

  return duneMedia ?? jellyfinMedia ?? youtubeMedia ?? spotifyMedia ?? null;
}

module.exports = {
  isActiveMedia,
  resolveMediaByPriority,
};
