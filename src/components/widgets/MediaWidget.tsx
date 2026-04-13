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

export function MediaWidget({ media }: MediaWidgetProps) {
  const progressText =
    media.progressMs !== null && media.durationMs !== null
      ? `${formatTime(media.progressMs)} / ${formatTime(media.durationMs)}`
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