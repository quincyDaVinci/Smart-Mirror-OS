import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaState } from "../../types/media";
import { getWebSocketUrl } from "../../utils/getWebSocketUrl";

type MirrorMediaDockProps = {
  media: MediaState;
  showLyrics?: boolean;
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

  return durationMs !== null ? Math.min(nextProgressMs, durationMs) : nextProgressMs;
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
    const match = rawLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);

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

function getProviderMessage(media: MediaState, source: MediaState["source"]) {
  if (source === "spotify") {
    return media.sourceState.spotify.message;
  }

  if (source === "jellyfin") {
    return media.sourceState.jellyfin.message;
  }

  return null;
}

function getKindLabel(kind: MediaState["kind"]) {
  switch (kind) {
    case "movie":
      return "Film";
    case "episode":
      return "Aflevering";
    case "track":
      return "Track";
    case "podcast":
      return "Podcast";
    default:
      return null;
  }
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
      <path
        d="M12 20.4 4.6 13C2.5 10.9 2.5 7.5 4.6 5.4a5.1 5.1 0 0 1 7.2 0l.2.2.2-.2a5.1 5.1 0 0 1 7.2 7.2L12 20.4Z"
      />
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

export function MirrorMediaDock({
  media,
  showLyrics = false,
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
  const [progressAnchor, setProgressAnchor] = useState<ProgressAnchor | null>(
    null,
  );
  const lyricViewportRef = useRef<HTMLDivElement | null>(null);
  const lyricLineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  const hasLiveMedia =
    media.source !== null &&
    (media.status === "playing" || media.status === "paused");

  const currentMedia = {
    source: media.source,
    kind: media.kind,
    title: media.title,
    subtitle: media.subtitle,
    secondaryText: media.secondaryText,
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
    displayMedia.title,
    displayMedia.subtitle,
    displayMedia.durationMs ?? "",
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
    if (!hasLiveMedia) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasLiveMedia, media.progressMs, media.lastUpdatedAt, media.status]);

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
  const kindLabel = getKindLabel(displayMedia.kind);

  const videoDetailPillCandidates: Array<DetailPill | null> = [
    kindLabel ? { icon: "film" as const, label: kindLabel } : null,
    displayMedia.productionYear
      ? { icon: "calendar" as const, label: String(displayMedia.productionYear) }
      : null,
    displayMedia.genres.length > 0
      ? {
          icon: "genre" as const,
          label: displayMedia.genres.slice(0, 2).join(", "),
        }
      : null,
    displayMedia.communityRating !== null
      ? { icon: "star" as const, label: displayMedia.communityRating.toFixed(1) }
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
  const showSpotifyLikedIcon =
    displayMedia.source === "spotify" && displayMedia.kind === "track";
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
          message:
            typeof payload.message === "string" ? payload.message : null,
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
  const activeLyricIndex = useMemo(
    () =>
      getActiveLyricIndex(lyricLines, liveProgressMs, displayMedia.durationMs),
    [lyricLines, liveProgressMs, displayMedia.durationMs],
  );
  const lyricsAreSynced = useMemo(
    () => hasSyncedLyricTiming(lyricLines),
    [lyricLines],
  );
  const hasLyricLines = lyricLines.length > 0;

  useEffect(() => {
    lyricLineRefs.current.length = lyricLines.length;
  }, [lyricLines.length]);

  useEffect(() => {
    const viewport = lyricViewportRef.current;
    const activeLine =
      activeLyricIndex >= 0 ? lyricLineRefs.current[activeLyricIndex] : null;

    if (!viewport || !activeLine) {
      return;
    }

    const nextScrollTop =
      activeLine.offsetTop - viewport.clientHeight / 2 + activeLine.clientHeight / 2;

    viewport.scrollTo({
      top: Math.max(0, nextScrollTop),
      behavior: "smooth",
    });
  }, [activeLyricIndex, lyricLines.length]);

  useEffect(() => {
    if (!requestedLyricsEnabled || !lyricsEnabled) {
      return;
    }

    const lyricsUnavailable =
      lyricsState.status === "error" ||
      (lyricsState.status === "ready" &&
        (lyricsState.lyrics?.instrumental === true ||
          !hasLyricLines));

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

  const className = [
    "mirror-main-media",
    `mirror-main-media--${variant}`,
    isPosterArtwork ? "mirror-main-media--poster" : "mirror-main-media--cover",
    isVideo ? "mirror-main-media--video" : "",
    lyricsEnabled ? "mirror-main-media--lyrics" : "",
    isIdle ? "mirror-main-media--idle" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className}>
      <div className="mirror-main-media__art">
        {displayMedia.artworkUrl ? (
          <img
            src={displayMedia.artworkUrl}
            alt={displayMedia.title}
            className="mirror-main-media__art-image"
          />
        ) : (
          <div className="mirror-main-media__art-fallback">♪</div>
        )}
      </div>

      <div className="mirror-main-media__meta">
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
        </div>

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

        <p className="mirror-main-media__artist mirror-main-media__metadata-line">
          <span className="mirror-main-media__metadata-icon">
            <ArtistIcon />
          </span>
          <span>{displayMedia.subtitle}</span>
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

        {showProgress ? (
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
        ) : null}

        {isStoredLastPlayed && providerMessage ? (
          <p className="mirror-main-media__message">{providerMessage}</p>
        ) : null}
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
                {lyricLines.map((line, index) => {
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
    </section>
  );
}
