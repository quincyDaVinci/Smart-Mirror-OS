import { useEffect, useMemo, useState } from "react";
import type { MediaState } from "../../types/media";

type MirrorMediaDockProps = {
  media: MediaState;
};

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

function isSameTrackAsCurrent(media: MediaState) {
  if (!media.lastPlayed) {
    return media.source !== null;
  }

  return (
    media.lastPlayed.title === media.title &&
    media.lastPlayed.subtitle === media.subtitle &&
    media.lastPlayed.artworkUrl === media.artworkUrl
  );
}

export function MirrorMediaDock({ media }: MirrorMediaDockProps) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!isSameTrackAsCurrent(media) || media.progressMs === null) {
      return;
    }

    setNowMs(Date.now());

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [media]);

  const displayMedia = media.lastPlayed ?? {
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
    capturedAt: Date.now(),
  };

  const liveProgressMs = useMemo(() => {
    return isSameTrackAsCurrent(media) ? getLiveProgressMs(media, nowMs) : null;
  }, [media, nowMs]);

  const progressPercentage =
    liveProgressMs !== null &&
    displayMedia.durationMs !== null &&
    displayMedia.durationMs > 0
      ? Math.min(100, Math.max(0, (liveProgressMs / displayMedia.durationMs) * 100))
      : 0;

  const progressLabel =
    liveProgressMs !== null && displayMedia.durationMs !== null
      ? `${formatTime(liveProgressMs)} / ${formatTime(displayMedia.durationMs)}`
      : null;

  const isIdle =
    !displayMedia.title || displayMedia.title === "Geen media actief";

  return (
    <section className={`mirror-main-media ${isIdle ? "mirror-main-media--idle" : ""}`}>
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
        <div className="mirror-main-media__title-row">
          <h2 className="mirror-main-media__title">{displayMedia.title}</h2>

          {displayMedia.isLiked !== null ? (
            <span
              className={`mirror-main-media__liked ${
                displayMedia.isLiked ? "mirror-main-media__liked--active" : ""
              }`}
              aria-label={displayMedia.isLiked ? "Geliked" : "Niet geliked"}
              title={displayMedia.isLiked ? "Geliked" : "Niet geliked"}
            >
              {displayMedia.isLiked ? "♥" : "♡"}
            </span>
          ) : null}
        </div>

        <p className="mirror-main-media__artist">{displayMedia.subtitle}</p>

        {displayMedia.secondaryText ? (
          <p className="mirror-main-media__album">{displayMedia.secondaryText}</p>
        ) : null}

        <div className="mirror-main-media__progress">
          <div className="mirror-main-media__progress-track">
            <div
              className="mirror-main-media__progress-fill"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>

          {progressLabel ? (
            <div className="mirror-main-media__progress-label">{progressLabel}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}