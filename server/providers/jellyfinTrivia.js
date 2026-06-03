const crypto = require("crypto");

const MOVIEMISTAKES_BASE_URL = "https://www.moviemistakes.com";
const TRIVIA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const RESOLVED_TITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = "Smart-Mirror-OS/0.0.0 (jellyfin trivia lookup)";

const resolvedTitleIdCache = new Map();
const triviaPayloadCache = new Map();
const notFoundCache = new Map();
const pendingTriviaRequests = new Map();

function getCachedEntry(cache, key) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function getCacheHit(cache, key) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return { value: entry.value };
}

function setCachedEntry(cache, key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function isJellyfinVideoMedia(media) {
  return (
    media?.source === "jellyfin" &&
    (media.kind === "movie" || media.kind === "episode") &&
    (media.status === "playing" || media.status === "paused")
  );
}

function normalizeSearchText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function getMediaResolverCacheKey(media) {
  return JSON.stringify({
    itemId: media.sourceItemId ?? "",
    title: media.title ?? "",
    seriesTitle: media.seriesTitle ?? "",
    year: media.productionYear ?? "",
    season: media.seasonNumber ?? "",
    episode: media.episodeNumber ?? "",
    kind: media.kind ?? "",
  });
}

function getMediaKey(media) {
  return [
    media.sourceItemId ?? "",
    media.title ?? "",
    media.subtitle ?? "",
    media.artworkUrl ?? "",
    media.durationMs ?? "",
    media.seasonNumber ?? "",
    media.episodeNumber ?? "",
  ].join("\n");
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function removeUiText(value) {
  return normalizeWhitespace(
    value
      .replace(/\bedit\b/gi, " ")
      .replace(/\d+\s+of\s+\d+\s+found\s+this\s+interesting\.?/gi, " ")
      .replace(/was this review helpful\??/gi, " ")
      .replace(/is this interesting\??/gi, " ")
      .replace(/share this page/gi, " ")
      .replace(/spoilers?/gi, " "),
  );
}

function parseHelpfulVotes(value) {
  const match = value.match(/(\d+)\s+of\s+(\d+)\s+found\s+this\s+interesting/i);

  if (!match) {
    return { helpfulVotes: null, totalVotes: null };
  }

  return {
    helpfulVotes: Number(match[1]),
    totalVotes: Number(match[2]),
  };
}

function parseTimestampMs(text) {
  const lower = text.toLowerCase();
  const patterns = [
    /(?:at|around|about)\s+(?:the\s+)?(?:around\s+)?(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d{1,2})\s*(?:m|min|mins|minute|minutes))?/i,
    /(?:at|around|about)\s+(?:the\s+)?(?:around\s+)?(\d{1,3})\s*(?:m|min|mins|minute|minutes)(?:\s+mark)?/i,
    /(?:at|around|about)\s+(?:the\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/i,
  ];

  const hourMatch = lower.match(patterns[0]);

  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    const minutes = Number(hourMatch[2] ?? 0);

    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return (hours * 60 + minutes) * 60 * 1000;
    }
  }

  const minuteMatch = lower.match(patterns[1]);

  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);

    if (Number.isFinite(minutes)) {
      return minutes * 60 * 1000;
    }
  }

  const clockMatch = lower.match(patterns[2]);

  if (clockMatch) {
    const first = Number(clockMatch[1]);
    const second = Number(clockMatch[2]);
    const third =
      clockMatch[3] !== undefined ? Number(clockMatch[3]) : undefined;

    if (Number.isFinite(first) && Number.isFinite(second)) {
      if (third !== undefined && Number.isFinite(third)) {
        return (first * 60 * 60 + second * 60 + third) * 1000;
      }

      return (first * 60 + second) * 1000;
    }
  }

  return null;
}

function detectSpoilerLevel(text, rawChunk) {
  const lower = `${text} ${rawChunk ?? ""}`.toLowerCase();

  if (/\bspoiler\b|\bending\b|\bfinal scene\b|\bdeath\b/.test(lower)) {
    return "high";
  }

  if (/\breveal\b|\btwist\b/.test(lower)) {
    return "mild";
  }

  return "none";
}

function detectTriviaKind(text, source) {
  const lower = text.toLowerCase();

  if (
    source === "moviemistakes-goof" ||
    /\bgoof\b|\bmistake\b|\bcontinuity\b|\bblooper\b/.test(lower)
  ) {
    return "blooper";
  }

  if (/\bcameo\b|\bbriefly appears\b|\bappearance\b/.test(lower)) {
    return "cameo";
  }

  if (/\bimprovis(?:ed|ation)|\bad-lib/.test(lower)) {
    return "improvisation";
  }

  if (/\bpractical effect\b|\bminiature\b|\bprosthetic\b|\bstunt\b|\bmakeup\b/.test(lower)) {
    return "practical-effect";
  }

  if (/\bhidden\b|\beaster egg\b|\bbackground\b|\bprop\b|\bdetail\b/.test(lower)) {
    return "hidden-detail";
  }

  if (/\bdirector\b|\bdirected\b/.test(lower)) {
    return "director";
  }

  if (/\bactor\b|\bactress\b|\bcast\b|\brole\b|\bplayed by\b/.test(lower)) {
    return "actor";
  }

  if (/\bscene\b|\bshot\b|\bfilmed\b|\btake\b|\bon screen\b/.test(lower)) {
    return "scene";
  }

  if (/\bbehind the scenes\b|\bset\b|\bproduction\b|\bfilming\b/.test(lower)) {
    return "behind-scenes";
  }

  return "general";
}

function scoreTriviaItem({ text, startMs, helpfulVotes, totalVotes, kind, source }) {
  const lower = text.toLowerCase();
  let score = 13;

  if (startMs !== null) score += 14;
  if (source === "moviemistakes-goof") score += 4;
  if (kind !== "general") score += 9;

  if (typeof helpfulVotes === "number") {
    score += Math.min(18, Math.round(Math.log2(helpfulVotes + 1) * 3));
  }

  if (typeof totalVotes === "number" && totalVotes > 0 && helpfulVotes !== null) {
    score += Math.max(0, Math.round((helpfulVotes / totalVotes) * 6));
  }

  if (text.length <= 180) score += 8;
  else if (text.length <= 240) score += 5;
  else if (text.length <= 320) score += 1;
  else score -= 25;

  if (/\b(scene|shot|camera|background|prop|costume|stunt|set|filmed)\b/.test(lower)) {
    score += 6;
  }

  if (/\b(release date|released in|runtime|running time|certificate|rated)\b/.test(lower)) {
    score -= 14;
  }

  if (/\b(budget|box office|award|oscar|golden globe)\b/.test(lower)) {
    score += /\brecord|first|highest|won|nominated\b/.test(lower) ? 1 : -8;
  }

  if (/^this movie|^this film|^the title|^the episode/.test(lower)) {
    score -= 4;
  }

  return score;
}

function createTriviaItem({
  source,
  sourceTitleId,
  rawText,
  rawChunk = "",
  startMsOverride = null,
  sourceUrl,
  helpfulVotesOverride = null,
  totalVotesOverride = null,
}) {
  const text = removeUiText(rawText);

  if (text.length < 35 || text.length > 320) {
    return null;
  }

  const parsedVotes = parseHelpfulVotes(rawChunk || rawText);
  const helpfulVotes =
    typeof helpfulVotesOverride === "number"
      ? helpfulVotesOverride
      : parsedVotes.helpfulVotes;
  const totalVotes =
    typeof totalVotesOverride === "number"
      ? totalVotesOverride
      : parsedVotes.totalVotes;
  const startMs =
    typeof startMsOverride === "number" ? startMsOverride : parseTimestampMs(text);
  const spoilerLevel = detectSpoilerLevel(text, rawChunk);
  const kind = detectTriviaKind(text, source);
  const score = scoreTriviaItem({
    text,
    startMs,
    helpfulVotes,
    totalVotes,
    kind,
    source,
  });

  if (spoilerLevel === "high" || score < 15) {
    return null;
  }

  const id = crypto
    .createHash("sha1")
    .update(`${source}:${sourceTitleId}:${text}`)
    .digest("hex")
    .slice(0, 16);

  return {
    id,
    source,
    sourceTitleId,
    sourceUrl,
    text,
    startMs,
    endMs: startMs !== null ? startMs + 20000 : null,
    helpfulVotes,
    totalVotes,
    score,
    spoilerLevel,
    kind,
  };
}

function dedupeTriviaItems(items) {
  const seenTexts = new Set();
  const uniqueItems = [];

  for (const item of items) {
    const canonicalText = item.text.toLowerCase().replace(/[^a-z0-9]+/g, "");

    if (seenTexts.has(canonicalText)) {
      continue;
    }

    seenTexts.add(canonicalText);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function getMovieMistakesSourceUrls(movieMistakesTitleId) {
  return {
    title: `${MOVIEMISTAKES_BASE_URL}/${movieMistakesTitleId}`,
    trivia: `${MOVIEMISTAKES_BASE_URL}/${movieMistakesTitleId}/trivia`,
  };
}

function getMovieMistakesSearchQuery(media) {
  const title =
    media.kind === "episode" ? media.seriesTitle || media.title : media.title;

  return [title, media.productionYear].filter(Boolean).join(" ");
}

function parseMovieMistakesTitleLabel(label) {
  const normalizedLabel = normalizeWhitespace(label);
  const match = normalizedLabel.match(/^(.*?)\s*\((\d{4})\)$/);

  if (!match) {
    return {
      title: normalizedLabel,
      year: null,
    };
  }

  return {
    title: normalizeWhitespace(match[1]),
    year: Number(match[2]),
  };
}

function parseMovieMistakesSearchResults(html, media) {
  const candidates = [];
  const seenIds = new Set();
  const resultPattern =
    /<h2>\s*<a[^>]+href=["']\/(film\d+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
  let match;

  while ((match = resultPattern.exec(html)) !== null && candidates.length < 8) {
    const movieMistakesTitleId = match[1];

    if (seenIds.has(movieMistakesTitleId)) {
      continue;
    }

    const { title, year } = parseMovieMistakesTitleLabel(stripHtml(match[2]));

    if (!title) {
      continue;
    }

    seenIds.add(movieMistakesTitleId);
    candidates.push({ movieMistakesTitleId, title, year });
  }

  const expectedTitle = normalizeSearchText(
    media.kind === "episode" ? media.seriesTitle || media.title : media.title,
  );
  const expectedYear = Number.isFinite(Number(media.productionYear))
    ? Number(media.productionYear)
    : null;
  const matchingCandidates = candidates.filter((candidate) => {
    const candidateTitle = normalizeSearchText(candidate.title);
    const titleMatches =
      expectedTitle.length > 0 &&
      (candidateTitle.includes(expectedTitle) ||
        expectedTitle.includes(candidateTitle));
    const yearMatches =
      expectedYear === null ||
      candidate.year === null ||
      candidate.year === expectedYear;

    return titleMatches && yearMatches;
  });

  if (matchingCandidates.length === 1) {
    return matchingCandidates[0].movieMistakesTitleId;
  }

  if (!expectedYear && candidates.length === 1) {
    return candidates[0].movieMistakesTitleId;
  }

  return null;
}

function parseMovieMistakesTimecode(block) {
  const markerIndex = block.search(/\bentrytimecode\b/i);

  if (markerIndex < 0) {
    return null;
  }

  const match = block
    .slice(markerIndex)
    .match(/\((\d{1,2}):(\d{2}):(\d{2})\)<\/span>/i);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }

  return (hours * 60 * 60 + minutes * 60 + seconds) * 1000;
}

function parseMovieMistakesNetVotes(block) {
  const match = block.match(
    /id=["']netvotesentry\d+["'][^>]*>\s*(-?\d+)\s*</i,
  );

  if (!match) {
    return null;
  }

  const votes = Number(match[1]);

  return Number.isFinite(votes) ? Math.max(0, votes) : null;
}

function extractMovieMistakesEntryBlocks(html) {
  const blocks = [];
  const entryPattern =
    /<div class=["']entryboxwrapper["'][^>]*id=["']entryboxwrapper(\d+)["'][^>]*>([\s\S]*?)(?=<div class=["']entryboxwrapper["'][^>]*id=["']entryboxwrapper\d+["']|<nav[^>]+id=["']pagination|<\/article>\s*<\/main>|$)/gi;
  let match;

  while ((match = entryPattern.exec(html)) !== null) {
    blocks.push({
      entryId: match[1],
      block: match[0],
    });
  }

  return blocks;
}

function parseMovieMistakesPage(html, source, movieMistakesTitleId, sourceUrl) {
  const items = [];

  for (const { entryId, block } of extractMovieMistakesEntryBlocks(html)) {
    const textMatch = block.match(
      /<span[^>]+id=["']innerentrytext\d+["'][^>]*>([\s\S]*?)<\/span>/i,
    );

    if (!textMatch) {
      continue;
    }

    const text = stripHtml(textMatch[1]);
    const startMs = parseMovieMistakesTimecode(block);
    const netVotes = parseMovieMistakesNetVotes(block);
    const item = createTriviaItem({
      source,
      sourceTitleId: movieMistakesTitleId,
      rawText: text,
      rawChunk: block,
      startMsOverride: startMs,
      helpfulVotesOverride: netVotes,
      totalVotesOverride: null,
      sourceUrl: `${sourceUrl}#entryboxwrapper${entryId}`,
    });

    if (item) {
      items.push(item);
    }
  }

  return items;
}

async function fetchHtml(url, providerName = "MovieMistakes") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${providerName} gaf status ${response.status}.`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchHtmlResult(url) {
  try {
    return {
      url,
      html: await fetchHtml(url),
      error: null,
    };
  } catch (error) {
    return {
      url,
      html: null,
      error,
    };
  }
}

async function resolveMovieMistakesTitleId(media) {
  const cacheKey = `moviemistakes:${getMediaResolverCacheKey(media)}`;
  const cached = getCacheHit(resolvedTitleIdCache, cacheKey);

  if (cached) {
    return cached.value;
  }

  const query = getMovieMistakesSearchQuery(media);

  if (!query) {
    setCachedEntry(resolvedTitleIdCache, cacheKey, null, NOT_FOUND_CACHE_TTL_MS);
    return null;
  }

  const searchUrl = new URL("/search.php", MOVIEMISTAKES_BASE_URL);
  searchUrl.searchParams.set("text", query);

  try {
    const html = await fetchHtml(searchUrl.toString());
    const resolvedTitleId = parseMovieMistakesSearchResults(html, media);

    setCachedEntry(
      resolvedTitleIdCache,
      cacheKey,
      resolvedTitleId,
      resolvedTitleId ? RESOLVED_TITLE_CACHE_TTL_MS : NOT_FOUND_CACHE_TTL_MS,
    );
    return resolvedTitleId;
  } catch {
    setCachedEntry(resolvedTitleIdCache, cacheKey, null, NOT_FOUND_CACHE_TTL_MS);
    return null;
  }
}

async function fetchMovieMistakesTriviaPayload(movieMistakesTitleId) {
  const cacheKey = `moviemistakes:${movieMistakesTitleId}`;
  const cachedPayload = getCachedEntry(triviaPayloadCache, cacheKey);

  if (cachedPayload) {
    return cachedPayload;
  }

  const cachedNotFound = getCachedEntry(notFoundCache, cacheKey);

  if (cachedNotFound) {
    return [];
  }

  const pendingRequest = pendingTriviaRequests.get(cacheKey);

  if (pendingRequest) {
    return pendingRequest;
  }

  const requestPromise = (async () => {
    try {
      const sourceUrls = getMovieMistakesSourceUrls(movieMistakesTitleId);
      const [triviaResult, mistakesResult] = await Promise.all([
        fetchHtmlResult(sourceUrls.trivia),
        fetchHtmlResult(sourceUrls.title),
      ]);
      const successfulResults = [triviaResult, mistakesResult].filter(
        (result) => result.html,
      );

      if (successfulResults.length === 0) {
        throw triviaResult.error ?? mistakesResult.error;
      }

      const items = dedupeTriviaItems([
        ...(triviaResult.html
          ? parseMovieMistakesPage(
              triviaResult.html,
              "moviemistakes-trivia",
              movieMistakesTitleId,
              sourceUrls.trivia,
            )
          : []),
        ...(mistakesResult.html
          ? parseMovieMistakesPage(
              mistakesResult.html,
              "moviemistakes-goof",
              movieMistakesTitleId,
              sourceUrls.title,
            )
          : []),
      ])
        .sort((a, b) => b.score - a.score)
        .slice(0, 80);

      if (items.length === 0) {
        setCachedEntry(notFoundCache, cacheKey, true, NOT_FOUND_CACHE_TTL_MS);
      } else {
        setCachedEntry(
          triviaPayloadCache,
          cacheKey,
          items,
          TRIVIA_CACHE_TTL_MS,
        );
      }

      return items;
    } finally {
      pendingTriviaRequests.delete(cacheKey);
    }
  })();

  pendingTriviaRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

async function fetchJellyfinTriviaForMedia({ media, sessionKey }) {
  const mediaKey = getMediaKey(media ?? {});

  if (!isJellyfinVideoMedia(media)) {
    return {
      ok: true,
      eligible: false,
      mediaKey,
      sessionKey: sessionKey ?? null,
      sourceProvider: null,
      sourceTitleId: null,
      sourceUrls: [],
      errorCode: null,
      items: [],
      message: "Geen actieve Jellyfin video voor trivia.",
    };
  }

  const movieMistakesTitleId = await resolveMovieMistakesTitleId(media);

  if (!movieMistakesTitleId) {
    return {
      ok: true,
      eligible: true,
      mediaKey,
      sessionKey,
      sourceProvider: "moviemistakes",
      sourceTitleId: null,
      sourceUrls: [],
      errorCode: "moviemistakes-title-not-found",
      items: [],
      message: "Geen betrouwbare MovieMistakes match gevonden.",
    };
  }

  const sourceUrls = getMovieMistakesSourceUrls(movieMistakesTitleId);

  try {
    const items = await fetchMovieMistakesTriviaPayload(movieMistakesTitleId);

    return {
      ok: true,
      eligible: true,
      mediaKey,
      sessionKey,
      sourceProvider: "moviemistakes",
      sourceTitleId: movieMistakesTitleId,
      sourceUrls: Object.values(sourceUrls),
      errorCode: items.length > 0 ? null : "moviemistakes-no-items",
      items,
      message:
        items.length > 0
          ? null
          : "MovieMistakes had geen geschikte trivia of mistakes.",
    };
  } catch (error) {
    console.error("[jellyfin-trivia:moviemistakes:error]", {
      movieMistakesTitleId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: true,
      eligible: true,
      mediaKey,
      sessionKey,
      sourceProvider: "moviemistakes",
      sourceTitleId: movieMistakesTitleId,
      sourceUrls: Object.values(sourceUrls),
      errorCode: "moviemistakes-fetch-failed",
      items: [],
      message: "MovieMistakes trivia ophalen mislukt.",
    };
  }
}

module.exports = {
  fetchJellyfinTriviaForMedia,
  parseHelpfulVotes,
  parseMovieMistakesPage,
  parseMovieMistakesSearchResults,
  parseTimestampMs,
  resolveMovieMistakesTitleId,
};
