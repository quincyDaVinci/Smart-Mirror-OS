import { useEffect, useState, type CSSProperties } from "react";
import { dashboardData } from "../data/mockDashboard";
import type { LayoutItem } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";
import type { MediaState } from "../types/media";
import { MirrorMediaDock } from "../components/mirror/MirrorMediaDock";

type MirrorPageProps = {
  layout: LayoutItem[];
  settings: MirrorSettings;
  presence: PresenceState;
  display: DisplayState;
  media: MediaState;
};

export function MirrorPage({
  layout,
  settings,
  presence,
  display,
  media,
}: MirrorPageProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const mirrorStyle = {
    "--mirror-padding": `${settings.layoutPaddingPx}px`,
    "--mirror-gap": `${settings.widgetGapPx}px`,
    "--mirror-scale": `${settings.zoomPercent / 100}`,
  } as CSSProperties;

  const enabledWidgetIds = new Set(
    layout.filter((item) => item.enabled).map((item) => item.id),
  );

  const showWeather = enabledWidgetIds.has("weather");
  const showClock = enabledWidgetIds.has("clock");
  const showCalendar = enabledWidgetIds.has("calendar");
  const showMedia = enabledWidgetIds.has("media");

  return (
    <main
      className={`mirror-page mirror-page--mode-${settings.mirrorMode} mirror-page--${presence.mode} mirror-page--display-${display.mode}`}
      style={mirrorStyle}
    >
      {settings.showStatusBar ? (
        <div className="mirror-status">
          Presence: {presence.mode} · Display: {display.mode} · Reason:{" "}
          {display.reason}
        </div>
      ) : null}

      <div className="mirror-shell">
        <header className="mirror-shell__top">
          <div className="mirror-shell__weather-slot">
            {showWeather ? (
              <section className="mirror-weather-hero">
                <div className="mirror-weather-hero__icon">◔</div>
                <div>
                  <div className="mirror-weather-hero__temp">
                    {dashboardData.weather.temperature}
                  </div>
                  <div className="mirror-weather-hero__location">
                    {dashboardData.weather.location}
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          <div className="mirror-shell__clock-slot">
            {showClock ? (
              <section className="mirror-clock-hero">
                <p className="mirror-clock-hero__time">
                  {currentTime.toLocaleTimeString("nl-NL", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: settings.showSeconds ? "2-digit" : undefined,
                  })}
                </p>

                <p className="mirror-clock-hero__date">
                  {currentTime.toLocaleDateString("nl-NL", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </p>
              </section>
            ) : null}
          </div>

          <div className="mirror-shell__meta-slot">
            {showMedia && media.source ? (
              <div className="mirror-shell__live-meta">
                <span className="mirror-pill">{media.source}</span>
                <span className="mirror-shell__live-status">{media.status}</span>
              </div>
            ) : null}
          </div>
        </header>

        <div className="mirror-shell__spacer" />

        <footer className="mirror-shell__bottom">
          <div className="mirror-shell__agenda-slot">
            {showCalendar ? (
              <section className="mirror-agenda-hero">
                <p className="mirror-agenda-hero__label">Volgende afspraak</p>
                <p className="mirror-agenda-hero__time">
                  {dashboardData.calendar.time}
                </p>
                <p className="mirror-agenda-hero__title">
                  {dashboardData.calendar.title}
                </p>
              </section>
            ) : null}
          </div>

          <div className="mirror-shell__media-slot">
            {showMedia ? <MirrorMediaDock media={media} /> : null}
          </div>
        </footer>
      </div>
    </main>
  );
}