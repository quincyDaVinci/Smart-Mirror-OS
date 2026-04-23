import { useEffect, useState, type CSSProperties } from "react";
import { useMirrorDashboard } from "../hooks/useMirrorDashboard";
import type { WeatherIconKey } from "../types/dashboard";
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

function getWeatherGlyph(iconKey: WeatherIconKey) {
  switch (iconKey) {
    case "sunny":
      return "☀";
    case "partly-cloudy":
      return "⛅";
    case "rain":
      return "☂";
    case "cloudy":
    default:
      return "☁";
  }
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatMeridiemTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const time = parts
    .filter(
      (part) =>
        part.type === "hour" ||
        part.type === "minute" ||
        part.type === "literal",
    )
    .map((part) => part.value)
    .join("")
    .trim();

  const meridiem =
    parts.find((part) => part.type === "dayPeriod")?.value.toLowerCase() ?? "";

  return { time, meridiem };
}

function formatAgendaTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }

  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  const formatted = formatMeridiemTime(date);
  return `${formatted.time} ${formatted.meridiem}`;
}

function getScreenLabel(display: DisplayState) {
  switch (display.focusedWidgetId) {
    case "media":
      return "MEDIA";
    case "calendar":
      return "AGENDA";
    case "weather":
      return "WEATHER";
    case "clock":
      return "CLOCK";
    default:
      return "MAIN";
  }
}

export function MirrorPage({
  layout,
  settings,
  presence,
  display,
  media,
}: MirrorPageProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const dashboardData = useMirrorDashboard();

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

  const upcomingItems = dashboardData.calendar.items.slice(0, 2);
  const screenLabel = getScreenLabel(display);

  const formattedTime = formatMeridiemTime(currentTime);
  const weekdayLabel = currentTime.toLocaleDateString("en-US", {
    weekday: "long",
  });
  const fullDateLabel = formatShortDate(currentTime);

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

      <div className="mirror-portrait-shell">
        <div className="mirror-edge-indicator">{screenLabel}</div>

        {showWeather ? (
          <section className="mirror-compact-weather">
            <p className="mirror-compact-weather__location">
              {dashboardData.weather.location}
            </p>

            <div className="mirror-compact-weather__hero">
              <div className="mirror-compact-weather__icon">
                {getWeatherGlyph(dashboardData.weather.iconKey)}
              </div>

              <div className="mirror-compact-weather__hero-right">
                <div className="mirror-compact-weather__temp">
                  {dashboardData.weather.temperature}
                </div>

                <div className="mirror-compact-weather__condition">
                  {dashboardData.weather.condition}
                </div>
              </div>
            </div>

            <div className="mirror-compact-weather__stats">
              <span>Wind: {dashboardData.weather.windSpeed}</span>
              <span>Max: {dashboardData.weather.highTemperature}</span>
              <span>Min: {dashboardData.weather.lowTemperature}</span>
            </div>

            <p className="mirror-compact-weather__detail">
              {dashboardData.weather.detailLine}
            </p>

            <div className="mirror-compact-weather__forecast">
              {dashboardData.weather.forecast.map((item) => (
                <div
                  key={`${item.day}-${item.highTemperature}-${item.lowTemperature}`}
                  className="mirror-compact-weather__forecast-row"
                >
                  <span className="mirror-compact-weather__forecast-day">
                    {item.day}
                  </span>
                  <span className="mirror-compact-weather__forecast-icon">
                    {getWeatherGlyph(item.iconKey)}
                  </span>
                  <span className="mirror-compact-weather__forecast-high">
                    {item.highTemperature}
                  </span>
                  <span className="mirror-compact-weather__forecast-low">
                    {item.lowTemperature}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {showClock || showCalendar ? (
          <section className="mirror-compact-time-stack">
            {showClock ? (
              <div className="mirror-compact-time">
                <p className="mirror-compact-time__weekday">{weekdayLabel}</p>
                <p className="mirror-compact-time__date">{fullDateLabel}</p>

                <p className="mirror-compact-time__value">
                  <span className="mirror-compact-time__digits">
                    {formattedTime.time}
                  </span>
                  <span className="mirror-compact-time__meridiem">
                    {formattedTime.meridiem}
                  </span>
                </p>
              </div>
            ) : null}

            {showCalendar && upcomingItems.length > 0 ? (
              <div className="mirror-compact-agenda">
                {upcomingItems.map((item) => (
                  <div
                    key={`${item.time}-${item.title}`}
                    className="mirror-compact-agenda__item"
                  >
                    <span className="mirror-compact-agenda__time">
                      {formatAgendaTime(item.time)}
                    </span>
                    <span className="mirror-compact-agenda__title">
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {showMedia ? (
          <div className="mirror-portrait-media-zone">
            <MirrorMediaDock media={media} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
