import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaState } from "../../types/media";
import { AnimatedAlbumArtwork } from "../media/AnimatedAlbumArtwork";
import { getWebSocketUrl } from "../../utils/getWebSocketUrl";
import "./MirrorMediaDock.css";

type MirrorMediaDockProps = {
  media: MediaState;
  showLyrics?: boolean;
  lyricsUpdateIntervalMs?: number;
  showJellyfinTrivia?: boolean;
  jellyfinTriviaSessionKey?: string | null;
  variant?: "compact" | "focus";
};

type DetailIconName = "calendar" | "clock" | "film" | "genre" | "star";

type DetailPill = {
  icon: DetailIconName;
  label: string;
};

type LyricsPayload = {
  trackName: string;
  artistName: string;
  albumName: string;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

type LyricsState =
  | { status: "idle"; lyrics: null; message: null }
  | { status: "loading"; lyrics: null; message: null }
  | { status: "ready"; lyrics: LyricsPayload | null; message: string | null }
  | { status: "error"; lyrics: null; message: string };

type JellyfinTriviaItem = {
  id: string;
  source: "moviemistakes-trivia" | "moviemistakes-goof";
  sourceTitleId: string;
  sourceUrl: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
  helpfulVotes: number | null;
  totalVotes: number | null;
  score: number;
  spoilerLevel: "none" | "mild" | "high";
  kind:
    | "scene"
    | "actor"
    | "director"
    | "cameo"
    | "improvisation"
    | "practical-effect"
    | "hidden-detail"
    | "blooper"
    | "behind-scenes"
    | "general";
};

type JellyfinTriviaState =
  | { status: "idle"; items: JellyfinTriviaItem[]; message: null }
  | { status: "loading"; items: JellyfinTriviaItem[]; message: null }
  | { status: "ready"; items: JellyfinTriviaItem[]; message: string | null }
  | { status: "error"; items: JellyfinTriviaItem[]; message: string };

type ActiveTriviaPopup = {
  item: JellyfinTriviaItem;
  hideAt: number;
};

type LyricLine = {
  text: string;
  startMs: number | null;
  weight: number;
};

type ProgressAnchor = {
  key: string;
  progressMs: number | null;
  capturedAt: number;
  status: string;
};

const PAUSED_RECENTLY_PLAYED_AFTER_MS = 45 * 1000;
const LYRICS_AUTO_HIDE_AFTER_MS = 3500;
const TRIVIA_TIMED_EARLY_WINDOW_MS = 10000;
const TRIVIA_TIMED_LATE_WINDOW_MS = 12000;
const TRIVIA_UNTIMED_EDGE_MARGIN_MS = 3 * 60 * 1000;

const DEBUG_LYRICS_PERF = false;

function sendLyricsPerf(label: string, data: Record<string, unknown>) {
  if (!DEBUG_LYRICS_PERF) {
    return;
  }

  const payload = {
    label,
    at: Math.round(performance.now()),
    ...data,
  };

  fetch(`${getApiBaseUrl()}/debug/perf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Debug logging mag de mirror nooit breken.
  });
}

function useFpsPerfLogger(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let animationFrameId = 0;
    let lastFrameAt = performance.now();
    let windowStartedAt = performance.now();

    let frameCount = 0;
    let maxFrameGapMs = 0;
    let over50ms = 0;
    let over100ms = 0;

    function tick(now: number) {
      const gap = now - lastFrameAt;

      frameCount += 1;
      maxFrameGapMs = Math.max(maxFrameGapMs, gap);

      if (gap > 50) over50ms += 1;
      if (gap > 100) over100ms += 1;

      lastFrameAt = now;

      const elapsed = now - windowStartedAt;

      if (elapsed >= 5000) {
        sendLyricsPerf("fps-window", {
          fps: Number(((frameCount / elapsed) * 1000).toFixed(1)),
          maxFrameGapMs: Number(maxFrameGapMs.toFixed(1)),
          over50ms,
          over100ms,
        });

        windowStartedAt = now;
        frameCount = 0;
        maxFrameGapMs = 0;
        over50ms = 0;
        over100ms = 0;
      }

      animationFrameId = requestAnimationFrame(tick);
    }

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [enabled]);
}

function getApiBaseUrl() {
  const url = new URL(getWebSocketUrl());
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

function formatTime(ms: number | null) {
  if (ms === null || Number.isNaN(ms)) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function getLiveProgressMs(media: MediaState, nowMs: number) {
  if (media.progressMs === null) {
    return null;
  }

  if (media.status !== "playing" || media.lastUpdatedAt === null) {
    return media.progressMs;
  }

  const elapsedMs = Math.max(0, nowMs - media.lastUpdatedAt);
  const nextProgressMs = media.progressMs + elapsedMs;

  if (media.durationMs !== null) {
    return Math.min(nextProgressMs, media.durationMs);
  }

  return nextProgressMs;
}

function getAnchoredProgressMs(
  anchor: { progressMs: number | null; capturedAt: number; status: string },
  durationMs: number | null,
  nowMs: number,
) {
  if (anchor.progressMs === null) {
    return null;
  }

  if (anchor.status !== "playing") {
    return anchor.progressMs;
  }

  const elapsedMs = Math.max(0, nowMs - anchor.capturedAt);
  const nextProgressMs = anchor.progressMs + elapsedMs;

  return durationMs !== null
    ? Math.min(nextProgressMs, durationMs)
    : nextProgressMs;
}

function formatClockTime(timestampMs: number) {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestampMs));
}

function parseSyncedLyrics(value: string) {
  const lines: LyricLine[] = [];

  for (const rawLine of value.split("\n")) {
    const match = rawLine.match(
      /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/,
    );

    if (!match) {
      continue;
    }

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const milliseconds = Number((match[3] ?? "0").padEnd(3, "0"));

    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(milliseconds)
    ) {
      continue;
    }

    lines.push({
      text: match[4]?.trim() ?? "",
      startMs: minutes * 60 * 1000 + seconds * 1000 + milliseconds,
      weight: 1,
    });
  }

  return lines.filter((line) => line.text.length > 0);
}

function parsePlainLyrics(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const text = line.trim();

      return {
        text,
        startMs: null,
        weight: getPlainLyricLineWeight(text),
      };
    })
    .filter((line) => line.text.length > 0);
}

function getPlainLyricLineWeight(text: string) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return Math.min(2.4, Math.max(0.85, wordCount / 5));
}

function parseLyrics(lyrics: LyricsPayload | null) {
  if (!lyrics || lyrics.instrumental) {
    return [];
  }

  if (lyrics.syncedLyrics) {
    const syncedLines = parseSyncedLyrics(lyrics.syncedLyrics);

    if (syncedLines.length > 0) {
      return syncedLines;
    }
  }

  if (lyrics.plainLyrics) {
    return parsePlainLyrics(lyrics.plainLyrics);
  }

  return [];
}

function hasSyncedLyricTiming(lines: LyricLine[]) {
  return lines.some((line) => line.startMs !== null);
}

function getEstimatedPlainLyricIndex(
  lines: LyricLine[],
  progressMs: number | null,
  durationMs: number | null,
) {
  if (lines.length === 0 || progressMs === null) {
    return -1;
  }

  const fallbackDurationMs = Math.max(lines.length * 3600, 90 * 1000);
  const trackDurationMs =
    durationMs !== null && durationMs > 0 ? durationMs : fallbackDurationMs;
  const introMs = Math.min(12 * 1000, trackDurationMs * 0.08);
  const outroMs = Math.min(8 * 1000, trackDurationMs * 0.05);
  const lyricDurationMs = Math.max(
    trackDurationMs - introMs - outroMs,
    lines.length * 1400,
  );
  const lyricProgress = Math.min(
    0.999,
    Math.max(0, (progressMs - introMs) / lyricDurationMs),
  );
  const totalWeight = lines.reduce((sum, line) => sum + line.weight, 0);
  const targetWeight = lyricProgress * totalWeight;
  let cumulativeWeight = 0;

  for (let index = 0; index < lines.length; index += 1) {
    cumulativeWeight += lines[index]?.weight ?? 1;

    if (cumulativeWeight > targetWeight) {
      return index;
    }
  }

  return lines.length - 1;
}

function getActiveLyricIndex(
  lines: LyricLine[],
  progressMs: number | null,
  durationMs: number | null,
) {
  if (progressMs === null) {
    return -1;
  }

  if (!hasSyncedLyricTiming(lines)) {
    return getEstimatedPlainLyricIndex(lines, progressMs, durationMs);
  }

  let activeIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const startMs = lines[index]?.startMs;

    if (startMs === null || startMs === undefined) {
      return -1;
    }

    if (startMs > progressMs) {
      break;
    }

    activeIndex = index;
  }

  return activeIndex;
}

function getTriviaPopupDurationMs(text: string) {
  return Math.min(30000, Math.max(15000, 15000 + text.length * 45));
}

function getTriviaBudget(
  kind: MediaState["kind"],
  durationMs: number | null,
  strongUntimedItemCount: number,
) {
  if (durationMs === null || durationMs <= 0) {
    return kind === "movie" ? 5 : 1;
  }

  const durationMinutes = durationMs / 60000;

  if (kind === "episode") {
    if (durationMinutes <= 25) {
      return strongUntimedItemCount >= 2 && durationMinutes >= 22 ? 2 : 1;
    }

    if (durationMinutes <= 44) return 2;
    if (durationMinutes <= 64) return 3;
    return 4;
  }

  if (durationMinutes <= 99) return 5;
  if (durationMinutes <= 129) return 6;
  if (durationMinutes <= 159) return 7;
  return 8;
}

function getDeterministicJitterMs(value: string, maxJitterMs: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return Math.round((hash / 0xffffffff - 0.5) * maxJitterMs * 2);
}

function getUntimedTriviaWindow(durationMs: number | null) {
  if (durationMs === null || durationMs <= TRIVIA_UNTIMED_EDGE_MARGIN_MS * 2) {
    return null;
  }

  const startMs = Math.max(durationMs * 0.1, TRIVIA_UNTIMED_EDGE_MARGIN_MS);
  const endMs = Math.min(
    durationMs * 0.9,
    durationMs - TRIVIA_UNTIMED_EDGE_MARGIN_MS,
  );

  return endMs > startMs ? { startMs, endMs } : null;
}

function buildUntimedTriviaSlots(
  items: JellyfinTriviaItem[],
  durationMs: number | null,
  kind: MediaState["kind"],
) {
  const window = getUntimedTriviaWindow(durationMs);

  if (!window) {
    return [];
  }

  const untimedItems = items
    .filter((item) => item.startMs === null)
    .sort((a, b) => b.score - a.score);
  const budget = getTriviaBudget(kind, durationMs, untimedItems.length);
  const selectedItems = untimedItems.slice(0, budget);

  if (selectedItems.length === 0) {
    return [];
  }

  const spacing = (window.endMs - window.startMs) / (selectedItems.length + 1);

  return selectedItems.map((item, index) => {
    const baseStartMs = window.startMs + spacing * (index + 1);
    const jitterMs = getDeterministicJitterMs(
      item.id,
      Math.min(45000, spacing * 0.28),
    );
    const startMs = Math.min(
      window.endMs,
      Math.max(window.startMs, Math.round(baseStartMs + jitterMs)),
    );

    return { itemId: item.id, startMs };
  });
}

function getTriviaMediaKey(media: MediaState) {
  return [
    media.sourceItemId ?? "",
    media.title,
    media.subtitle,
    media.artworkUrl ?? "",
    media.durationMs ?? "",
    media.seasonNumber ?? "",
    media.episodeNumber ?? "",
  ].join("\n");
}

function getTriviaSourceLabel(source: JellyfinTriviaItem["source"]) {
  return source === "moviemistakes-goof" ? "Goof" : "Trivia";
}

function getProviderMessage(media: MediaState, source: MediaState["source"]) {
  if (source === "spotify") {
    return media.sourceState.spotify.message;
  }

  if (source === "jellyfin") {
    return media.sourceState.jellyfin.message;
  }

  return null;
}

function DetailIcon({ name }: { name: DetailIconName }) {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v5l3.5 2" />
        </svg>
      );
    case "film":
      return (
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M5 5h14v14H5zM8 5v14M16 5v14M5 9h3M5 15h3M16 9h3M16 15h3" />
        </svg>
      );
    case "genre":
      return (
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M4 7h10M4 12h16M4 17h12" />
          <circle cx="18" cy="7" r="2" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="m12 4 2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.8L12 4Z" />
        </svg>
      );
    default:
      return null;
  }
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M12 20.4 4.6 13C2.5 10.9 2.5 7.5 4.6 5.4a5.1 5.1 0 0 1 7.2 0l.2.2.2-.2a5.1 5.1 0 0 1 7.2 7.2L12 20.4Z" />
    </svg>
  );
}

function ArtistIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function AlbumIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="0.6" />
    </svg>
  );
}

function ScrollingMetadataText({ text }: { text: string }) {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const contentRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    const content = contentRef.current;

    if (!viewport || !measure || !content) {
      return;
    }

    const updateOverflowState = () => {
      const styles = window.getComputedStyle(measure);
      const fontSize = Number.parseFloat(styles.fontSize) || 16;
      const parsedLineHeight = Number.parseFloat(styles.lineHeight);
      const lineHeight = Number.isFinite(parsedLineHeight)
        ? parsedLineHeight
        : fontSize * 1.2;
      const exceedsTwoLines = measure.scrollHeight > lineHeight * 2 + 2;

      viewport.classList.toggle(
        "mirror-main-media__metadata-scroll--overflowing",
        exceedsTwoLines,
      );

      const scrollDistance = exceedsTwoLines
        ? Math.max(0, content.scrollWidth - viewport.clientWidth)
        : 0;

      viewport.style.setProperty(
        "--metadata-scroll-distance",
        `${scrollDistance}px`,
      );
    };

    updateOverflowState();

    const resizeObserver = new ResizeObserver(updateOverflowState);
    resizeObserver.observe(viewport);
    resizeObserver.observe(measure);
    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, [text]);

  return (
    <span className="mirror-main-media__metadata-scroll" ref={viewportRef}>
      <span
        className="mirror-main-media__metadata-scroll-measure"
        ref={measureRef}
        aria-hidden
      >
        {text}
      </span>

      <span className="mirror-main-media__metadata-scroll-static">{text}</span>

      <span
        className="mirror-main-media__metadata-scroll-content"
        ref={contentRef}
        aria-hidden
      >
        {text}
      </span>
    </span>
  );
}

export function MirrorMediaDock({
  media,
  showLyrics = false,
  lyricsUpdateIntervalMs = 1000,
  showJellyfinTrivia = false,
  jellyfinTriviaSessionKey = null,
  variant = "compact",
}: MirrorMediaDockProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lyricsState, setLyricsState] = useState<LyricsState>({
    status: "idle",
    lyrics: null,
    message: null,
  });
  const [lyricsSuppressedKey, setLyricsSuppressedKey] = useState<string | null>(
    null,
  );
  const [jellyfinTriviaState, setJellyfinTriviaState] =
    useState<JellyfinTriviaState>({
      status: "idle",
      items: [],
      message: null,
    });
  const [jellyfinTriviaLoadedKey, setJellyfinTriviaLoadedKey] = useState<
    string | null
  >(null);
  const [shownTriviaIds, setShownTriviaIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeTriviaPopup, setActiveTriviaPopup] =
    useState<ActiveTriviaPopup | null>(null);
  const [progressAnchor, setProgressAnchor] = useState<ProgressAnchor | null>(
    null,
  );
  const [visibleLyricCenterIndex, setVisibleLyricCenterIndex] = useState<
    number | null
  >(null);
  const lyricViewportRef = useRef<HTMLDivElement | null>(null);
  const lyricLineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  const previousActiveLyricIndexRef = useRef<number | null>(null);
  const previousTriviaProgressRef = useRef<number | null>(null);

  const hasLiveMedia =
    media.source !== null &&
    (media.status === "playing" || media.status === "paused");

  const currentMedia = {
    source: media.source,
    kind: media.kind,
    title: media.title,
    subtitle: media.subtitle,
    secondaryText: media.secondaryText,
    sourceItemId: media.sourceItemId,
    playSessionId: media.playSessionId,
    seriesTitle: media.seriesTitle,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    providerIds: media.providerIds,
    productionYear: media.productionYear,
    genres: media.genres,
    communityRating: media.communityRating,
    artworkUrl: media.artworkUrl,
    durationMs: media.durationMs,
    deviceName: media.deviceName,
    userName: media.userName,
    isLiked: media.isLiked,
    capturedAt: media.lastUpdatedAt ?? nowMs,
  };

  const displayMedia = hasLiveMedia
    ? currentMedia
    : (media.lastPlayed ?? currentMedia);
  const mediaProgressKey = [
    displayMedia.source,
    displayMedia.kind,
    displayMedia.sourceItemId,
    displayMedia.playSessionId,
    displayMedia.title,
    displayMedia.subtitle,
    displayMedia.durationMs ?? "",
    displayMedia.seasonNumber ?? "",
    displayMedia.episodeNumber ?? "",
  ].join("\n");

  const pausedDurationMs =
    media.status === "paused" && media.statusChangedAt !== null
      ? Math.max(0, nowMs - media.statusChangedAt)
      : 0;
  const isPausedRecentlyPlayed =
    variant === "compact" &&
    media.status === "paused" &&
    pausedDurationMs >= PAUSED_RECENTLY_PLAYED_AFTER_MS;
  const isStoredLastPlayed = !hasLiveMedia && media.lastPlayed !== null;
  const isStaleLastPlayed = isStoredLastPlayed || isPausedRecentlyPlayed;

  useEffect(() => {
    const incomingProgressMs = media.progressMs;
    const now = Date.now();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgressAnchor((previousAnchor) => {
      const previousProgressMs = previousAnchor
        ? getAnchoredProgressMs(previousAnchor, media.durationMs, now)
        : null;

      if (!hasLiveMedia || incomingProgressMs === null) {
        return {
          key: mediaProgressKey,
          progressMs: incomingProgressMs,
          capturedAt: media.lastUpdatedAt ?? now,
          status: media.status,
        };
      }

      const isSameMedia = previousAnchor?.key === mediaProgressKey;
      const shouldKeepPredictedProgress =
        isSameMedia &&
        media.status === "playing" &&
        previousProgressMs !== null &&
        incomingProgressMs < previousProgressMs &&
        previousProgressMs - incomingProgressMs < 4500;

      return {
        key: mediaProgressKey,
        progressMs: shouldKeepPredictedProgress
          ? previousProgressMs
          : incomingProgressMs,
        capturedAt: shouldKeepPredictedProgress
          ? now
          : (media.lastUpdatedAt ?? now),
        status: media.status,
      };
    });
  }, [
    hasLiveMedia,
    media.progressMs,
    media.lastUpdatedAt,
    media.status,
    media.durationMs,
    mediaProgressKey,
  ]);

  const liveProgressMs = useMemo(() => {
    if (!hasLiveMedia) {
      return null;
    }

    if (!progressAnchor) {
      return getLiveProgressMs(media, nowMs);
    }

    return getAnchoredProgressMs(progressAnchor, media.durationMs, nowMs);
  }, [hasLiveMedia, media, nowMs, progressAnchor]);

  const progressPercentage =
    liveProgressMs !== null &&
    displayMedia.durationMs !== null &&
    displayMedia.durationMs > 0
      ? Math.min(
          100,
          Math.max(0, (liveProgressMs / displayMedia.durationMs) * 100),
        )
      : 0;

  const progressLabel =
    liveProgressMs !== null && displayMedia.durationMs !== null
      ? `${formatTime(liveProgressMs)} / ${formatTime(displayMedia.durationMs)}`
      : null;

  const stateLabel = isStaleLastPlayed
    ? "Recently played"
    : media.status === "playing"
      ? "Now playing"
      : media.status === "paused"
        ? "Paused"
        : null;

  const providerMessage = getProviderMessage(media, displayMedia.source);

  const isIdle =
    !hasLiveMedia &&
    !media.lastPlayed &&
    (!displayMedia.title || displayMedia.title === "Geen media actief");

  const showProgress = !isStaleLastPlayed && progressLabel !== null;
  const isPosterArtwork =
    displayMedia.source === "jellyfin" &&
    (displayMedia.kind === "movie" || displayMedia.kind === "episode");
  const isVideo =
    displayMedia.kind === "movie" || displayMedia.kind === "episode";
  const finishTimeLabel =
    isVideo &&
    liveProgressMs !== null &&
    displayMedia.durationMs !== null &&
    displayMedia.durationMs > liveProgressMs
      ? `Eindigt ${formatClockTime(nowMs + displayMedia.durationMs - liveProgressMs)}`
      : null;

  const videoDetailPillCandidates: Array<DetailPill | null> = [
    displayMedia.productionYear
      ? {
          icon: "calendar" as const,
          label: String(displayMedia.productionYear),
        }
      : null,
    displayMedia.genres.length > 0
      ? {
          icon: "genre" as const,
          label: displayMedia.genres.slice(0, 2).join(", "),
        }
      : null,
    displayMedia.communityRating !== null
      ? {
          icon: "star" as const,
          label: displayMedia.communityRating.toFixed(1),
        }
      : null,
  ];
  const videoDetailPills = videoDetailPillCandidates.filter(
    (detail): detail is DetailPill => detail !== null,
  );
  const detailPills = isVideo ? videoDetailPills : [];
  const showStatusRow = variant !== "focus" && stateLabel !== null;
  const requestedLyricsEnabled =
    variant === "focus" &&
    showLyrics &&
    displayMedia.kind === "track" &&
    !isIdle;
  const lyricsQueryKey = [
    displayMedia.title,
    displayMedia.subtitle,
    displayMedia.secondaryText,
    displayMedia.durationMs ?? "",
  ].join("\n");
  const lyricsEnabled =
    requestedLyricsEnabled && lyricsSuppressedKey !== lyricsQueryKey;

  useEffect(() => {
    if (!hasLiveMedia) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());

    const tickIntervalMs = lyricsEnabled ? lyricsUpdateIntervalMs : 1000;
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, tickIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    hasLiveMedia,
    lyricsEnabled,
    lyricsUpdateIntervalMs,
    media.progressMs,
    media.lastUpdatedAt,
    media.status,
  ]);
  const showSpotifyLikedIcon =
    displayMedia.source === "spotify" && displayMedia.kind === "track";
  const requestedJellyfinTriviaEnabled =
    variant === "focus" &&
    showJellyfinTrivia &&
    jellyfinTriviaSessionKey !== null &&
    hasLiveMedia &&
    media.source === "jellyfin" &&
    (media.kind === "movie" || media.kind === "episode") &&
    (media.status === "playing" || media.status === "paused");
  const jellyfinTriviaMediaKey = getTriviaMediaKey(media);
  const jellyfinTriviaEnabled = requestedJellyfinTriviaEnabled;
  const scheduledTriviaSlots = useMemo(
    () =>
      buildUntimedTriviaSlots(
        jellyfinTriviaState.items,
        media.durationMs,
        media.kind,
      ),
    [jellyfinTriviaState.items, media.durationMs, media.kind],
  );

  useEffect(() => {
    if (!requestedLyricsEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLyricsSuppressedKey(null);
      return;
    }

    setLyricsSuppressedKey((currentKey) =>
      currentKey !== null && currentKey !== lyricsQueryKey ? null : currentKey,
    );
  }, [requestedLyricsEnabled, lyricsQueryKey]);

  useEffect(() => {
    if (!jellyfinTriviaEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJellyfinTriviaState({ status: "idle", items: [], message: null });
      setJellyfinTriviaLoadedKey(null);
      setShownTriviaIds(new Set());
      setActiveTriviaPopup(null);
      return;
    }

    setJellyfinTriviaLoadedKey(null);
    setShownTriviaIds(new Set());
    setActiveTriviaPopup(null);
  }, [jellyfinTriviaEnabled, jellyfinTriviaMediaKey, jellyfinTriviaSessionKey]);

  useEffect(() => {
    if (!jellyfinTriviaEnabled || jellyfinTriviaSessionKey === null) {
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      sessionKey: jellyfinTriviaSessionKey,
      title: media.title,
    });

    if (media.sourceItemId) {
      query.set("itemId", media.sourceItemId);
    }

    if (media.durationMs !== null) {
      query.set("durationMs", String(media.durationMs));
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJellyfinTriviaState({ status: "loading", items: [], message: null });
    setJellyfinTriviaLoadedKey(null);

    fetch(`${getApiBaseUrl()}/media/jellyfin-trivia?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: unknown;
          items?: unknown;
          message?: unknown;
          error?: unknown;
        };

        if (!response.ok || payload.ok !== true) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : `HTTP ${response.status}`,
          );
        }

        const items = Array.isArray(payload.items)
          ? payload.items.filter(
              (item): item is JellyfinTriviaItem =>
                item !== null &&
                typeof item === "object" &&
                typeof (item as JellyfinTriviaItem).id === "string" &&
                typeof (item as JellyfinTriviaItem).text === "string",
            )
          : [];

        setJellyfinTriviaState({
          status: "ready",
          items,
          message: typeof payload.message === "string" ? payload.message : null,
        });
        setJellyfinTriviaLoadedKey(jellyfinTriviaMediaKey);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setJellyfinTriviaState({
          status: "error",
          items: [],
          message:
            error instanceof Error
              ? error.message
              : "Jellyfin trivia ophalen mislukt.",
        });
        setJellyfinTriviaLoadedKey(jellyfinTriviaMediaKey);
      });

    return () => {
      controller.abort();
    };
  }, [
    jellyfinTriviaEnabled,
    jellyfinTriviaMediaKey,
    jellyfinTriviaSessionKey,
    media.title,
    media.sourceItemId,
    media.durationMs,
  ]);

  useEffect(() => {
    if (!lyricsEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLyricsState({ status: "idle", lyrics: null, message: null });
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({
      trackName: displayMedia.title,
      artistName: displayMedia.subtitle,
    });

    if (displayMedia.secondaryText) {
      query.set("albumName", displayMedia.secondaryText);
    }

    if (displayMedia.durationMs !== null) {
      query.set("durationMs", String(displayMedia.durationMs));
    }

    setLyricsState({ status: "loading", lyrics: null, message: null });

    fetch(`${getApiBaseUrl()}/media/lyrics?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: unknown;
          lyrics?: unknown;
          message?: unknown;
          error?: unknown;
        };

        if (!response.ok || payload.ok !== true) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : `HTTP ${response.status}`,
          );
        }

        const lyrics =
          payload.lyrics && typeof payload.lyrics === "object"
            ? (payload.lyrics as LyricsPayload)
            : null;

        setLyricsState({
          status: "ready",
          lyrics,
          message: typeof payload.message === "string" ? payload.message : null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setLyricsState({
          status: "error",
          lyrics: null,
          message:
            error instanceof Error ? error.message : "Lyrics ophalen mislukt.",
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    lyricsEnabled,
    lyricsQueryKey,
    displayMedia.title,
    displayMedia.subtitle,
    displayMedia.secondaryText,
    displayMedia.durationMs,
  ]);

  const lyricLines = useMemo(
    () => parseLyrics(lyricsState.lyrics),
    [lyricsState.lyrics],
  );

  const activeLyricIndex = useMemo(() => {
    return getActiveLyricIndex(
      lyricLines,
      liveProgressMs,
      displayMedia.durationMs,
    );
  }, [lyricLines, liveProgressMs, displayMedia.durationMs]);

  const lyricsAreSynced = useMemo(
    () => hasSyncedLyricTiming(lyricLines),
    [lyricLines],
  );
  const hasLyricLines = lyricLines.length > 0;

  const visibleLyricLines = useMemo(() => {
    if (!hasLyricLines || activeLyricIndex < 0) {
      return lyricLines.map((line, index) => ({ line, index }));
    }

    const windowSize = 1;
    const centerIndex = visibleLyricCenterIndex ?? activeLyricIndex;
    const startIndex = Math.max(0, centerIndex - windowSize);
    const endIndex = Math.min(
      lyricLines.length,
      centerIndex + windowSize + 1,
    );

    return lyricLines.slice(startIndex, endIndex).map((line, offset) => ({
      line,
      index: startIndex + offset,
    }));
  }, [
    hasLyricLines,
    lyricLines,
    activeLyricIndex,
    visibleLyricCenterIndex,
  ]);

  useEffect(() => {
    if (!lyricsEnabled || activeLyricIndex < 0) {
      return;
    }

    if (visibleLyricCenterIndex === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibleLyricCenterIndex(activeLyricIndex);
      return;
    }

    if (visibleLyricCenterIndex === activeLyricIndex) {
      return;
    }

    const distance = Math.abs(activeLyricIndex - visibleLyricCenterIndex);

    if (distance > 1) {
      // Seek/jump: keep the active line visible immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisibleLyricCenterIndex(activeLyricIndex);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setVisibleLyricCenterIndex(activeLyricIndex);
    }, 110);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lyricsEnabled, activeLyricIndex, visibleLyricCenterIndex]);

  useFpsPerfLogger(lyricsEnabled);

  useEffect(() => {
    if (!lyricsEnabled || activeLyricIndex < 0) {
      return;
    }

    const previousIndex = previousActiveLyricIndexRef.current;

    if (previousIndex === activeLyricIndex) {
      return;
    }

    previousActiveLyricIndexRef.current = activeLyricIndex;

    sendLyricsPerf("active-line-change", {
      from: previousIndex,
      to: activeLyricIndex,
      lineCount: lyricLines.length,
      progressMs: liveProgressMs,
    });
  }, [lyricsEnabled, activeLyricIndex, lyricLines.length, liveProgressMs]);

  useEffect(() => {
    lyricLineRefs.current.length = lyricLines.length;
  }, [lyricLines.length]);

  useEffect(() => {
    // Tijdelijke performance-test:
    // scrollTo staat uit, omdat we nu alleen een klein lyrics-window renderen.
    // const startedAt = performance.now();
    // const viewport = lyricViewportRef.current;
    // const activeLine =
    //   activeLyricIndex >= 0 ? lyricLineRefs.current[activeLyricIndex] : null;
    // if (!viewport || !activeLine) {
    //   return;
    // }
    // const beforeMeasure = performance.now();
    // const activeOffsetTop = activeLine.offsetTop;
    // const viewportHeight = viewport.clientHeight;
    // const activeLineHeight = activeLine.clientHeight;
    // const afterMeasure = performance.now();
    // const nextScrollTop =
    //   activeOffsetTop - viewportHeight / 2 + activeLineHeight / 2;
    // viewport.scrollTo({
    //   top: Math.max(0, nextScrollTop),
    //   behavior: "auto",
    // });
    // const finishedAt = performance.now();
    // sendLyricsPerf("lyrics-scroll", {
    //   activeLyricIndex,
    //   lineCount: lyricLines.length,
    //   measureMs: Number((afterMeasure - beforeMeasure).toFixed(2)),
    //   totalMs: Number((finishedAt - startedAt).toFixed(2)),
    //   nextScrollTop: Math.round(nextScrollTop),
    // });
  }, [activeLyricIndex, lyricLines.length]);

  useEffect(() => {
    if (!requestedLyricsEnabled || !lyricsEnabled) {
      return;
    }

    const lyricsUnavailable =
      lyricsState.status === "error" ||
      (lyricsState.status === "ready" &&
        (lyricsState.lyrics?.instrumental === true || !hasLyricLines));

    if (!lyricsUnavailable) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLyricsSuppressedKey(lyricsQueryKey);
    }, LYRICS_AUTO_HIDE_AFTER_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    requestedLyricsEnabled,
    lyricsEnabled,
    lyricsQueryKey,
    lyricsState.status,
    lyricsState.lyrics,
    hasLyricLines,
  ]);

  useEffect(() => {
    if (!activeTriviaPopup) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        setActiveTriviaPopup(null);
      },
      Math.max(0, activeTriviaPopup.hideAt - Date.now()),
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeTriviaPopup]);

  useEffect(() => {
    const previousProgressMs = previousTriviaProgressRef.current;
    previousTriviaProgressRef.current = liveProgressMs;

    if (liveProgressMs === null || previousProgressMs === null) {
      return;
    }

    const progressDeltaMs = liveProgressMs - previousProgressMs;
    const didSeek = progressDeltaMs < -5000 || progressDeltaMs > 12000;

    if (didSeek) {
      setActiveTriviaPopup(null);

      // Belangrijk voor testen/rewatch:
      // na seek mogen timed trivia opnieuw triggeren.
      setShownTriviaIds(new Set());
      return;
    }

    if (!activeTriviaPopup) {
      return;
    }

    const timedPopupIsNoLongerRelevant =
      activeTriviaPopup.item.startMs !== null &&
      (liveProgressMs <
        activeTriviaPopup.item.startMs - TRIVIA_TIMED_EARLY_WINDOW_MS ||
        liveProgressMs >
          activeTriviaPopup.item.startMs + TRIVIA_TIMED_LATE_WINDOW_MS + 5000);

    if (timedPopupIsNoLongerRelevant) {
      setActiveTriviaPopup(null);
    }
  }, [activeTriviaPopup, liveProgressMs]);

  useEffect(() => {
    if (
      !jellyfinTriviaEnabled ||
      jellyfinTriviaState.status !== "ready" ||
      jellyfinTriviaLoadedKey !== jellyfinTriviaMediaKey ||
      activeTriviaPopup ||
      liveProgressMs === null ||
      media.status !== "playing"
    ) {
      return;
    }

    const timedCandidate =
      jellyfinTriviaState.items
        .filter(
          (item) =>
            item.startMs !== null &&
            !shownTriviaIds.has(item.id) &&
            liveProgressMs >= item.startMs - TRIVIA_TIMED_EARLY_WINDOW_MS &&
            liveProgressMs <= item.startMs + TRIVIA_TIMED_LATE_WINDOW_MS,
        )
        .sort((a, b) => {
          const aDistance = Math.abs((a.startMs ?? 0) - liveProgressMs);
          const bDistance = Math.abs((b.startMs ?? 0) - liveProgressMs);

          return aDistance - bDistance;
        })[0] ?? null;

    const dueUntimedSlots = scheduledTriviaSlots.filter(
      (slot) => liveProgressMs >= slot.startMs,
    );

    let dueSlot: { itemId: string; startMs: number } | null = null;

    for (const slot of dueUntimedSlots) {
      if (!shownTriviaIds.has(slot.itemId)) {
        dueSlot = slot;
      }
    }

    const untimedCandidate = dueSlot
      ? (jellyfinTriviaState.items.find((item) => item.id === dueSlot.itemId) ??
        null)
      : null;

    const nextTrivia = timedCandidate ?? untimedCandidate;
    const consumedUntimedSlotIds =
      !timedCandidate && dueSlot
        ? dueUntimedSlots.map((slot) => slot.itemId)
        : [];

    if (!nextTrivia) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShownTriviaIds((previousIds) => {
      const nextIds = new Set(previousIds);

      for (const itemId of consumedUntimedSlotIds) {
        nextIds.add(itemId);
      }

      nextIds.add(nextTrivia.id);
      return nextIds;
    });
    setActiveTriviaPopup({
      item: nextTrivia,
      hideAt: Date.now() + getTriviaPopupDurationMs(nextTrivia.text),
    });
  }, [
    jellyfinTriviaEnabled,
    jellyfinTriviaState.status,
    jellyfinTriviaState.items,
    jellyfinTriviaLoadedKey,
    jellyfinTriviaMediaKey,
    activeTriviaPopup,
    liveProgressMs,
    media.status,
    scheduledTriviaSlots,
    shownTriviaIds,
  ]);

  const className = [
    "mirror-main-media",
    `mirror-main-media--${variant}`,
    displayMedia.source === "spotify"
      ? "mirror-main-media--spotify"
      : displayMedia.source === "jellyfin"
        ? "mirror-main-media--jellyfin"
        : "",
    isPosterArtwork ? "mirror-main-media--poster" : "mirror-main-media--cover",
    isVideo ? "mirror-main-media--video" : "",
    lyricsEnabled ? "mirror-main-media--lyrics" : "",
    jellyfinTriviaEnabled ? "mirror-main-media--trivia" : "",
    isIdle ? "mirror-main-media--idle" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const progressBlock = showProgress ? (
    <div className="mirror-main-media__progress">
      <div className="mirror-main-media__progress-track">
        <div
          className="mirror-main-media__progress-fill"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      <div className="mirror-main-media__progress-label">
        <span>{progressLabel}</span>
      </div>
    </div>
  ) : null;

  const artworkBlock = (
    <div className="mirror-main-media__art">
      {displayMedia.artworkUrl ? (
        <AnimatedAlbumArtwork
          kind={displayMedia.kind}
          artist={displayMedia.subtitle}
          album={displayMedia.secondaryText}
          artworkUrl={displayMedia.artworkUrl}
          alt={displayMedia.title}
          className="mirror-main-media__art-image"
        />
      ) : (
        <div className="mirror-main-media__art-fallback">♪</div>
      )}
    </div>
  );

  const progressWithArtwork =
    variant === "focus" &&
    displayMedia.source === "spotify" &&
    displayMedia.kind === "track" &&
    !isVideo;

  return (
    <section className={className}>
      <div className="mirror-main-media__content-stack">
        {progressWithArtwork ? (
          <div className="mirror-main-media__visual">
            {artworkBlock}
            {progressBlock}
          </div>
        ) : (
          artworkBlock
        )}

        <div className="mirror-main-media__meta">
        {variant === "focus" && !progressWithArtwork ? progressBlock : null}

        {showStatusRow ? (
          <div className="mirror-main-media__status-row">
            <span
              className={`mirror-main-media__status-pill ${
                isStaleLastPlayed
                  ? "mirror-main-media__status-pill--stale"
                  : media.status === "playing"
                    ? "mirror-main-media__status-pill--live"
                    : "mirror-main-media__status-pill--paused"
              }`}
            >
              {stateLabel}
            </span>
          </div>
        ) : null}

        <div className="mirror-main-media__title-row">
          <h2 className="mirror-main-media__title">{displayMedia.title}</h2>

          {showSpotifyLikedIcon ? (
            <span
              className={[
                "mirror-main-media__liked",
                displayMedia.isLiked === true
                  ? "mirror-main-media__liked--filled"
                  : "mirror-main-media__liked--outline",
              ].join(" ")}
              aria-label={displayMedia.isLiked ? "Geliked" : "Niet geliked"}
              title={displayMedia.isLiked ? "Geliked" : "Niet geliked"}
            >
              <HeartIcon />
            </span>
          ) : null}
        </div>

        <p className="mirror-main-media__artist mirror-main-media__metadata-line">
          <span className="mirror-main-media__metadata-icon">
            <ArtistIcon />
          </span>
          <ScrollingMetadataText text={displayMedia.subtitle} />
        </p>

        {displayMedia.secondaryText ? (
          <p className="mirror-main-media__album mirror-main-media__metadata-line">
            <span className="mirror-main-media__metadata-icon">
              <AlbumIcon />
            </span>
            <span>{displayMedia.secondaryText}</span>
          </p>
        ) : null}

        {variant === "focus" && detailPills.length > 0 ? (
          <div className="mirror-main-media__detail-row">
            {detailPills.map((detail, index) => (
              <span
                className="mirror-main-media__detail-pill"
                key={`${detail.icon}-${detail.label}-${index}`}
              >
                <span className="mirror-main-media__detail-icon">
                  <DetailIcon name={detail.icon} />
                </span>
                <span>{detail.label}</span>
              </span>
            ))}
          </div>
        ) : null}

        {variant === "focus" && finishTimeLabel ? (
          <p className="mirror-main-media__finish-time">{finishTimeLabel}</p>
        ) : null}

        {variant !== "focus" ? progressBlock : null}

        {isStoredLastPlayed && providerMessage ? (
          <p className="mirror-main-media__message">{providerMessage}</p>
        ) : null}
        </div>
      </div>

      {lyricsEnabled ? (
        <aside
          className={`mirror-main-media__lyrics ${
            lyricsAreSynced ? "" : "mirror-main-media__lyrics--estimated"
          }`}
          aria-live="polite"
        >
          {lyricsState.status === "loading" ? (
            <p className="mirror-main-media__lyrics-message">Lyrics laden</p>
          ) : null}

          {lyricsState.status === "error" ? (
            <p className="mirror-main-media__lyrics-message">
              {lyricsState.message}
            </p>
          ) : null}

          {lyricsState.status === "ready" &&
          lyricsState.lyrics?.instrumental ? (
            <p className="mirror-main-media__lyrics-message">Instrumental</p>
          ) : null}

          {lyricsState.status === "ready" &&
          !lyricsState.lyrics?.instrumental &&
          !hasLyricLines ? (
            <p className="mirror-main-media__lyrics-message">
              {lyricsState.message ?? "Geen lyrics gevonden"}
            </p>
          ) : null}

          {hasLyricLines ? (
            <div
              className="mirror-main-media__lyrics-viewport"
              ref={lyricViewportRef}
            >
              <div className="mirror-main-media__lyrics-lines">
                {visibleLyricLines.map(({ line, index }) => {
                  const distance =
                    activeLyricIndex >= 0
                      ? Math.abs(index - activeLyricIndex)
                      : index;

                  return (
                    <p
                      className={[
                        "mirror-main-media__lyrics-line",
                        index === activeLyricIndex
                          ? "mirror-main-media__lyrics-line--active"
                          : "",
                        index < activeLyricIndex
                          ? "mirror-main-media__lyrics-line--past"
                          : "",
                        distance === 1
                          ? "mirror-main-media__lyrics-line--near"
                          : "",
                        distance === 2
                          ? "mirror-main-media__lyrics-line--edge"
                          : "",
                        distance > 2
                          ? "mirror-main-media__lyrics-line--far"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={`${index}-${line.text}`}
                      ref={(element) => {
                        lyricLineRefs.current[index] = element;
                      }}
                    >
                      {line.text}
                    </p>
                  );
                })}
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}

      {jellyfinTriviaEnabled && activeTriviaPopup ? (
        <aside className="mirror-main-media__trivia" aria-live="polite">
          <p className="mirror-main-media__trivia-label">
            {getTriviaSourceLabel(activeTriviaPopup.item.source)}
          </p>
          <p className="mirror-main-media__trivia-text">
            {activeTriviaPopup.item.text}
          </p>
        </aside>
      ) : null}
    </section>
  );
}
