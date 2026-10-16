const DEFAULT_MEDIA_SOURCE_PRIORITY = [
  "dune",
  "jellyfin",
  "youtube",
  "spotify",
];

const MEDIA_BY_SOURCE_KEY = {
  dune: "duneMedia",
  jellyfin: "jellyfinMedia",
  youtube: "youtubeMedia",
  spotify: "spotifyMedia",
};

function isActiveMedia(media) {
  return Boolean(
    media &&
      (media.status === "playing" || media.status === "paused"),
  );
}

function normalizeMediaSourcePriority(priority) {
  if (!Array.isArray(priority) || priority.length !== DEFAULT_MEDIA_SOURCE_PRIORITY.length) {
    return [...DEFAULT_MEDIA_SOURCE_PRIORITY];
  }

  const unique = new Set(priority);

  if (
    unique.size !== DEFAULT_MEDIA_SOURCE_PRIORITY.length ||
    DEFAULT_MEDIA_SOURCE_PRIORITY.some((source) => !unique.has(source))
  ) {
    return [...DEFAULT_MEDIA_SOURCE_PRIORITY];
  }

  return [...priority];
}

function getMediaBySource(mediaSources, source) {
  const key = MEDIA_BY_SOURCE_KEY[source];
  return key ? (mediaSources[key] ?? null) : null;
}

function getActiveMediaSources({
  duneMedia,
  jellyfinMedia,
  youtubeMedia,
  spotifyMedia,
  priority = DEFAULT_MEDIA_SOURCE_PRIORITY,
}) {
  const mediaSources = {
    duneMedia,
    jellyfinMedia,
    youtubeMedia,
    spotifyMedia,
  };

  return normalizeMediaSourcePriority(priority).filter((source) =>
    isActiveMedia(getMediaBySource(mediaSources, source)),
  );
}

function resolveMediaByPriority({
  duneMedia,
  jellyfinMedia,
  youtubeMedia,
  spotifyMedia,
  priority = DEFAULT_MEDIA_SOURCE_PRIORITY,
  overrideSource = null,
}) {
  const mediaSources = {
    duneMedia,
    jellyfinMedia,
    youtubeMedia,
    spotifyMedia,
  };
  const normalizedPriority = normalizeMediaSourcePriority(priority);
  const activeSources = getActiveMediaSources({
    ...mediaSources,
    priority: normalizedPriority,
  });

  if (overrideSource && activeSources.includes(overrideSource)) {
    return getMediaBySource(mediaSources, overrideSource);
  }

  for (const source of activeSources) {
    return getMediaBySource(mediaSources, source);
  }

  for (const source of normalizedPriority) {
    const media = getMediaBySource(mediaSources, source);

    if (media) {
      return media;
    }
  }

  return null;
}

module.exports = {
  DEFAULT_MEDIA_SOURCE_PRIORITY,
  isActiveMedia,
  normalizeMediaSourcePriority,
  getActiveMediaSources,
  resolveMediaByPriority,
};
