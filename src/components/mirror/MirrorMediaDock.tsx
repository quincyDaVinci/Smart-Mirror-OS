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

export function MirrorMediaDock({ media }: MirrorMediaDockProps) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (media.status !== "playing" || media.progressMs === null) {
      return;
    }

    setNowMs(Date.now());

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [media.status, media.progressMs, media.lastUpdatedAt, media.title]);

  const liveProgressMs = useMemo(() => {
    return getLiveProgressMs(media, nowMs);
  }, [media, nowMs]);

  const progressPercentage =
    liveProgressMs !== null && media.durationMs !== null && media.durationMs > 0
      ? Math.min(100, Math.max(0, (liveProgressMs / media.durationMs) * 100))
      : 0;

  const progressText =
    liveProgressMs !== null && media.durationMs !== null
      ? `${formatTime(liveProgressMs)} / ${formatTime(media.durationMs)}`
      : null;

  const isIdle = media.status === "idle" || media.source === null;

  return (
    <section className={`mirror-dock ${isIdle ? "mirror-dock--idle" : ""}`}>
      <div className="mirror-dock__art">
        {media.artworkUrl ? (
          <img
            src={media.artworkUrl}
            alt={media.title}
            className="mirror-dock__art-image"
          />
        ) : (
          <div className="mirror-dock__art-fallback">♪</div>
        )}
      </div>

      <div className="mirror-dock__body">
        <div className="mirror-dock__eyebrow">
          <span>Now playing</span>
          {media.source ? (
            <span className="mirror-pill">{media.source}</span>
          ) : null}
        </div>

        <h2 className="mirror-dock__title">{media.title}</h2>

        <p className="mirror-dock__subtitle">{media.subtitle}</p>

        {media.secondaryText ? (
          <p className="mirror-dock__secondary">{media.secondaryText}</p>
        ) : null}

        <div className="mirror-dock__progress">
          <div className="mirror-dock__progress-track">
            <div
              className="mirror-dock__progress-fill"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>

          <div className="mirror-dock__progress-meta">
            <span>{progressText ?? media.status}</span>
            <span>
              {media.deviceName ?? media.userName ?? ""}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}