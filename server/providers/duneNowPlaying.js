const crypto = require("crypto");
const { getJellyfinSecrets } = require("../secretsStore");
const { createMediaFromJellyfinItem } = require("./jellyfinNowPlaying");

const DUNE_STATUS_URL =
  process.env.DUNE_STATUS_URL ||
  "http://192.168.68.112/cgi-bin/do?cmd=status";
const DUNE_REQUEST_TIMEOUT_MS = 2500;
const JELLYFIN_SEARCH_TIMEOUT_MS = 5000;
const MATCH_CACHE_TTL_MS = 60 * 60 * 1000;
const MISS_CACHE_TTL_MS = 30 * 1000;

// Only one lookup per file; polling the Dune does not poll the Jellyfin library.
const matchCache = new Map();
const pendingMatches = new Map();
let previousFile = null;
let sessionNumber = 0;
let currentSessionId = null;

function decodeXmlAttribute(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    const name = entity.toLowerCase();
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[name] ?? _;
  });
}

function parseDuneStatus(xml) {
  const params = Object.create(null);
  for (const match of xml.matchAll(/<param\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"\s*\/?>/gi)) {
    params[match[1]] = decodeXmlAttribute(match[2]);
  }
  return params;
}

function normalizePath(value) {
  return typeof value === "string"
    ? value.replace(/\\/g, "/").replace(/\/+/g, "/").normalize("NFC").toLowerCase()
    : "";
}

function getDuneRelativePath(playbackUrl) {
  const path = normalizePath(playbackUrl);
  const match = path.match(/^\/tmp\/mnt\/smb\/[^/]+\/(.+)$/);
  return match ? match[1] : null;
}

function matchesJellyfinPath(dunePath, jellyfinPath) {
  const relativePath = getDuneRelativePath(dunePath);
  const libraryPath = normalizePath(jellyfinPath);

  // Match full relative directory + filename, not just a title or basename.
  return Boolean(
    relativePath &&
      libraryPath &&
      libraryPath.endsWith("/" + relativePath)
  );
}

function cleanReleaseTitle(value) {
  return value
    .replace(/\.(mkv|mp4|m4v|avi|iso|ts|mov)$/i, "")
    .replace(/[._]/g, " ")
    .replace(/\s+(?:WEB[- ]?DL|WEBDL|WEBRip|BluRay|BDRip|DVDRip|REMUX|HDRip|HDTV|2160p|1080p|720p)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-–\s]+$/, "");
}

function getJellyfinSearchTerms(playbackUrl) {
  const filename = playbackUrl.split(/[\\/]/).pop() ?? "";
  const cleaned = cleanReleaseTitle(filename);
  const terms = [];
  const episode = cleaned.match(/^(.*?)\s*[-– ]+\s*S\d{1,2}E\d{1,3}(?:E\d{1,3})?\s*[-– ]*\s*(.*)$/i);
  if (episode) {
    if (episode[2].trim()) terms.push(episode[2].trim());
    if (episode[1].trim()) terms.push(episode[1].trim());
  } else {
    terms.push(cleaned.replace(/\s*\(?\b(?:19|20)\d{2}\b\)?.*$/, "").trim());
  }
  return [...new Set(terms.filter(Boolean))];
}

async function searchJellyfinItems(baseUrl, apiKey, searchTerm) {
  const url = new URL("/Items", baseUrl);
  url.searchParams.set("Recursive", "true");
  url.searchParams.set("IncludeItemTypes", "Episode,Movie");
  url.searchParams.set("SearchTerm", searchTerm);
  url.searchParams.set("Fields", "Path,Genres,ProviderIds");
  url.searchParams.set("Limit", "100");

  const response = await fetch(url, {
    headers: { "X-MediaBrowser-Token": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(JELLYFIN_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Jellyfin lookup HTTP " + response.status);
  const data = await response.json();
  return Array.isArray(data.Items) ? data.Items : [];
}

async function findLibraryMatch(playbackUrl) {
  const cached = matchCache.get(playbackUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.item;
  const pending = pendingMatches.get(playbackUrl);
  if (pending) return pending;

  const request = (async () => {
    const { baseUrl, apiKey } = getJellyfinSecrets();
    if (!baseUrl || !apiKey || !getDuneRelativePath(playbackUrl)) return null;

    for (const term of getJellyfinSearchTerms(playbackUrl)) {
      const items = await searchJellyfinItems(baseUrl, apiKey, term);
      const matches = items.filter(item =>
        typeof item.Path === "string" &&
        matchesJellyfinPath(playbackUrl, item.Path)
      );

      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return null; // Ambiguous: never guess.
    }
    return null;
  })();

  pendingMatches.set(playbackUrl, request);
  try {
    const item = await request;
    matchCache.set(playbackUrl, {
      item,
      expiresAt: Date.now() + (item ? MATCH_CACHE_TTL_MS : MISS_CACHE_TTL_MS),
    });
    return item;
  } finally {
    pendingMatches.delete(playbackUrl);
  }
}

function secondsToMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}

async function fetchDuneNowPlaying() {
  const checkedAt = Date.now();
  const providerStatus = {
    enabled: true,
    status: "ok",
    message: null,
    lastCheckedAt: checkedAt,
  };

  let params;
  try {
    const response = await fetch(DUNE_STATUS_URL, {
      signal: AbortSignal.timeout(DUNE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    params = parseDuneStatus(await response.text());
  } catch {
    // If the device is off, normal Jellyfin and Spotify polling keep working.
    return {
      media: null,
      providerStatus: {
        ...providerStatus,
        status: "error",
        message: "Dune niet bereikbaar.",
      },
    };
  }

  const playbackUrl = params.playback_url;
  const isActive =
    params.player_state === "file_playback" &&
    (params.playback_state === "playing" ||
      params.playback_state === "paused") &&
    typeof playbackUrl === "string" &&
    playbackUrl.length > 0;

  if (!isActive) {
    previousFile = null;
    currentSessionId = null;
    return {
      media: null,
      providerStatus: {
        ...providerStatus,
        message: "Geen actieve Dune playback.",
      },
    };
  }

  if (previousFile !== playbackUrl) {
    previousFile = playbackUrl;
    sessionNumber += 1;
    currentSessionId =
      "dune-" +
      sessionNumber +
      "-" +
      crypto.createHash("sha1").update(playbackUrl).digest("hex").slice(0, 12);
  }

  const status = params.playback_state;
  const progressMs = secondsToMs(params.playback_position);
  const durationMs = secondsToMs(params.playback_duration);
  const filename = playbackUrl.split(/[\\/]/).pop() ?? "Onbekend bestand";

  let item = null;
  try {
    item = await findLibraryMatch(playbackUrl);
  } catch {
    // Keep Dune playback visible even if metadata is temporarily unavailable.
  }

  if (item) {
    const { baseUrl, apiKey } = getJellyfinSecrets();
    return {
      media: createMediaFromJellyfinItem({
        item,
        baseUrl,
        apiKey,
        source: "dune",
        status,
        progressMs,
        durationMs,
        playSessionId: currentSessionId,
        deviceName: "Dune HD (Real Vision 4K)",
        checkedAt,
      }),
      providerStatus,
    };
  }

  return {
    media: {
      source: "dune",
      status,
      kind: /\bS\d{1,2}E\d{1,3}\b/i.test(filename) ? "episode" : "movie",
      title: cleanReleaseTitle(filename) || filename,
      subtitle: "Dune HD · niet gevonden in Jellyfin",
      secondaryText: "",
      sourceItemId: null,
      playSessionId: currentSessionId,
      progressMs,
      durationMs,
      deviceName: "Dune HD (Real Vision 4K)",
      userName: null,
      lastUpdatedAt: checkedAt,
    },
    providerStatus: {
      ...providerStatus,
      message: "Geen exacte Jellyfin-match voor Dune bestand.",
    },
  };
}

module.exports = {
  fetchDuneNowPlaying,
  parseDuneStatus,
  getDuneRelativePath,
  matchesJellyfinPath,
  getJellyfinSearchTerms,
};