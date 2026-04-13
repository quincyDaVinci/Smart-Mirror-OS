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

  const progressPercentage =
    liveProgressMs !== null && media.durationMs !== null && media.durationMs > 0
      ? Math.min(100, Math.max(0, (liveProgressMs / media.durationMs) * 100))
      : 0;

  const isVideo = media.kind === "movie" || media.kind === "episode";

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "96px 1fr",
        gap: 16,
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          width: "96px",
          aspectRatio: isVideo ? "2 / 3" : "1 / 1",
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255, 255, 255, 0.08)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {media.artworkUrl ? (
          <img
            src={media.artworkUrl}
            alt={media.title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              padding: 12,
              textAlign: "center",
              fontSize: 12,
              opacity: 0.7,
              lineHeight: 1.3,
            }}
          >
            {isVideo ? "Geen poster" : "Geen cover"}
          </div>
        )}
      </div>

      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            fontSize: 12,
            opacity: 0.8,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <span>Now Playing</span>
          {media.source ? <span>{media.source}</span> : null}
          <span>{media.kind}</span>
        </div>

        <h2
          style={{
            margin: 0,
            fontSize: 24,
            lineHeight: 1.1,
          }}
        >
          {media.title}
        </h2>

        <p
          style={{
            margin: 0,
            fontSize: 16,
            opacity: 0.9,
          }}
        >
          {media.subtitle}
        </p>

        {media.secondaryText ? (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              opacity: 0.7,
            }}
          >
            {media.secondaryText}
          </p>
        ) : null}

        <div
          style={{
            fontSize: 13,
            opacity: 0.75,
          }}
        >
          <span>Status: {media.status}</span>
          {media.deviceName ? <span> · Device: {media.deviceName}</span> : null}
          {media.userName ? <span> · User: {media.userName}</span> : null}
        </div>

        {progressText ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                height: 6,
                width: "100%",
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.14)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercentage}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "rgba(255, 255, 255, 0.92)",
                }}
              />
            </div>

            <p
              style={{
                margin: 0,
                fontSize: 13,
                opacity: 0.8,
              }}
            >
              {progressText}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
