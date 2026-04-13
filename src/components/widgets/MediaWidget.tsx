import { useEffect, useMemo, useState } from "react";
import type { MediaState } from "../../types/media";

type MediaWidgetProps = {
  media: MediaState;
};

function formatTime(ms: number | null) {
  if (ms === null || Number.isNaN(ms)) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

export function MediaWidget({ media }: MediaWidgetProps) {
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
  }, [
    media.status,
    media.progressMs,
    media.lastUpdatedAt,
    media.title,
    media.source,
  ]);

  const liveProgressMs = useMemo(() => {
    return getLiveProgressMs(media, nowMs);
  }, [media, nowMs]);

  const progressText =
    liveProgressMs !== null && media.durationMs !== null
      ? `${formatTime(liveProgressMs)} / ${formatTime(media.durationMs)}`
      : null;

  return (
    <section>
      <div>
        <span>Now Playing</span>
        {media.source ? <span>{media.source.toUpperCase()}</span> : null}
      </div>

      <h2>{media.title}</h2>
      <p>{media.subtitle}</p>

      {media.secondaryText ? <p>{media.secondaryText}</p> : null}

      <div>
        <span>Status: {media.status}</span>
        {media.deviceName ? <span> · Device: {media.deviceName}</span> : null}
        {media.userName ? <span> · User: {media.userName}</span> : null}
      </div>

      {progressText ? <p>{progressText}</p> : null}
    </section>
  );
}
