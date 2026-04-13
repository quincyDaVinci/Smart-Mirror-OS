import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MediaState } from "../../types/media";

type MediaWidgetProps = {
  media: MediaState;
};

type MetaChipProps = {
  icon: ReactNode;
  children: ReactNode;
};

function MetaChip({ icon, children }: MetaChipProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: "rgba(255, 255, 255, 0.08)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        fontSize: 12,
        lineHeight: 1,
        opacity: 0.92,
      }}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function StarIcon() {
  return (
    <IconBase>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />
      </svg>
    </IconBase>
  );
}

function ClockIcon() {
  return (
    <IconBase>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6l4 2" />
      </svg>
    </IconBase>
  );
}

function CalendarIcon() {
  return (
    <IconBase>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
    </IconBase>
  );
}

function TagIcon() {
  return (
    <IconBase>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M20 10 10 20 3 13V4h9l8 6Z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </svg>
    </IconBase>
  );
}

function formatTime(ms: number | null, forceHours = false) {
  if (ms === null || Number.isNaN(ms)) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (forceHours || hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  return `${totalMinutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatRemainingTime(ms: number | null) {
  if (ms === null) {
    return null;
  }

  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} h ${minutes} min`;
  }

  if (hours > 0) {
    return `${hours} h`;
  }

  return `${minutes} min`;
}

function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

  const shouldShowHours =
    media.durationMs !== null && media.durationMs >= 60 * 60 * 1000;

  const progressText =
    liveProgressMs !== null && media.durationMs !== null
      ? `${formatTime(liveProgressMs, shouldShowHours)} / ${formatTime(
          media.durationMs,
          shouldShowHours,
        )}`
      : null;

  const progressPercentage =
    liveProgressMs !== null && media.durationMs !== null && media.durationMs > 0
      ? Math.min(100, Math.max(0, (liveProgressMs / media.durationMs) * 100))
      : 0;

  const isVideo = media.kind === "movie" || media.kind === "episode";

  const remainingMs =
    isVideo && liveProgressMs !== null && media.durationMs !== null
      ? Math.max(media.durationMs - liveProgressMs, 0)
      : null;

  const endTimeText =
    remainingMs !== null && media.status === "playing"
      ? formatClockTime(new Date(nowMs + remainingMs))
      : null;

  const videoMetadataBits = [
    media.productionYear ? String(media.productionYear) : null,
    media.genres.length > 0 ? media.genres.slice(0, 3).join(", ") : null,
    media.communityRating !== null
      ? `Rating ${media.communityRating.toFixed(1)}`
      : null,
  ].filter(Boolean);

  const yearText =
    isVideo && media.productionYear ? String(media.productionYear) : null;

  const genresText =
    isVideo && media.genres.length > 0
      ? media.genres.slice(0, 2).join(", ")
      : null;

  const ratingText =
    isVideo && media.communityRating !== null
      ? media.communityRating.toFixed(1)
      : null;

  const remainingText =
    isVideo && remainingMs !== null ? formatRemainingTime(remainingMs) : null;

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
          <div
            style={{
              width: "100%",
              height: "100%",
              padding: isVideo ? 8 : 4,
              boxSizing: "border-box",
            }}
          >
            <img
              src={media.artworkUrl}
              alt={media.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "center",
                display: "block",
              }}
            />
          </div>
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

        {isVideo && videoMetadataBits.length > 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              opacity: 0.78,
            }}
          >
            {videoMetadataBits.join(" · ")}
          </p>
        ) : null}

        {yearText || genresText || ratingText ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {yearText ? (
              <MetaChip icon={<CalendarIcon />}>{yearText}</MetaChip>
            ) : null}

            {genresText ? (
              <MetaChip icon={<TagIcon />}>{genresText}</MetaChip>
            ) : null}

            {ratingText ? (
              <MetaChip icon={<StarIcon />}>{ratingText}</MetaChip>
            ) : null}
          </div>
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
            {isVideo && (remainingText || endTimeText) ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {remainingText ? (
                  <MetaChip icon={<ClockIcon />}>
                    Resterend {remainingText}
                  </MetaChip>
                ) : null}

                {endTimeText ? (
                  <MetaChip icon={<ClockIcon />}>
                    Eindigt {endTimeText}
                  </MetaChip>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
