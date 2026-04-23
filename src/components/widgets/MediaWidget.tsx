import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MediaState } from "../../types/media";

type MediaWidgetProps = {
  media: MediaState;
  variant?: "edge" | "focus";
  preferLastPlayed?: boolean;
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

function DeviceIcon() {
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
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
      </svg>
    </IconBase>
  );
}

function UserIcon() {
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
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
      </svg>
    </IconBase>
  );
}

function PlayIcon() {
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
        <path d="M10 8.5v7l5-3.5-5-3.5Z" fill="currentColor" stroke="none" />
      </svg>
    </IconBase>
  );
}

function PauseIcon() {
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
        <path d="M10 8v8M14 8v8" />
      </svg>
    </IconBase>
  );
}

function HistoryIcon() {
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
        <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
        <path d="M3.5 4.5v4h4" />
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

export function MediaWidget({
  media,
  variant = "edge",
  preferLastPlayed = false,
}: MediaWidgetProps) {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (media.status !== "playing" || media.progressMs === null) {
      return;
    }

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

  const isShowingLastPlayed =
    preferLastPlayed &&
    media.lastPlayed !== null &&
    media.status !== "playing" &&
    media.status !== "paused";

  const contextLabel = isShowingLastPlayed
    ? "Laatst afgespeeld"
    : media.status === "playing"
      ? "Nu actief"
      : media.status === "paused"
        ? "Gepauzeerd"
        : "Media";

  const contextIcon = isShowingLastPlayed ? (
    <HistoryIcon />
  ) : media.status === "playing" ? (
    <PlayIcon />
  ) : media.status === "paused" ? (
    <PauseIcon />
  ) : (
    <TagIcon />
  );

  const artworkColumn = variant === "focus" ? "minmax(200px, 28vw) 1fr" : "96px 1fr";
  const titleSize = variant === "focus" ? 44 : 24;
  const subtitleSize = variant === "focus" ? 22 : 16;
  const detailSize = variant === "focus" ? 17 : 14;
  const artworkPadding = variant === "focus" ? (isVideo ? 12 : 8) : isVideo ? 8 : 4;
  const progressHeight = variant === "focus" ? 8 : 6;

  return (
    <section
      className={`widget media-widget media-widget--${variant}`}
      style={{
        display: "grid",
        gridTemplateColumns: artworkColumn,
        gap: variant === "focus" ? "24px" : "16px",
        alignItems: "stretch",
        width: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          width: "100%",
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
        className="media-widget-artwork"
      >
        {media.artworkUrl ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              padding: artworkPadding,
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
            {isShowingLastPlayed
              ? "Geen cover van laatste item"
              : isVideo
                ? "Geen poster"
                : "Geen cover"}
          </div>
        )}
      </div>

      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: variant === "focus" ? 14 : 8,
          justifyContent: "center",
        }}
        className="media-widget-body"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            fontSize: variant === "focus" ? 13 : 12,
            opacity: 0.8,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <MetaChip icon={contextIcon}>{contextLabel}</MetaChip>
          {media.source ? <span>{media.source}</span> : null}
          {media.kind !== "unknown" ? <span>{media.kind}</span> : null}
        </div>

        <h2
          style={{
            margin: 0,
            fontSize: titleSize,
            lineHeight: 1.1,
          }}
        >
          {media.title}
        </h2>

        <p
          style={{
            margin: 0,
            fontSize: subtitleSize,
            opacity: 0.9,
          }}
        >
          {media.subtitle}
        </p>

        {media.secondaryText ? (
          <p
            style={{
              margin: 0,
              fontSize: detailSize,
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
              fontSize: detailSize,
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

        {media.deviceName || media.userName ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {media.deviceName ? (
              <MetaChip icon={<DeviceIcon />}>{media.deviceName}</MetaChip>
            ) : null}

            {media.userName ? (
              <MetaChip icon={<UserIcon />}>{media.userName}</MetaChip>
            ) : null}
          </div>
        ) : null}

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
                height: progressHeight,
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
                fontSize: variant === "focus" ? 15 : 13,
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
