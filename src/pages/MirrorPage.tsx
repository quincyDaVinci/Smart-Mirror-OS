import { useEffect, useState, type CSSProperties } from "react";
import { useMirrorDashboard } from "../hooks/useMirrorDashboard";
import type { CalendarItem, WeatherIconKey } from "../types/dashboard";
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
    case "clear-day":
      return "☀";
    case "clear-night":
      return "🌙";
    case "partly-cloudy-day":
      return "⛅";
    case "partly-cloudy-night":
      return "☁";
    case "fog":
      return "🌫";
    case "drizzle":
      return "🌦";
    case "rain":
      return "🌧";
    case "freezing-rain":
      return "🌨";
    case "snow":
      return "❄";
    case "thunderstorm":
      return "⛈";
    case "hail":
      return "🧊";
    case "cloudy":
    default:
      return "☁";
  }
}

function getMeteoconIconName(iconKey: WeatherIconKey) {
  switch (iconKey) {
    case "clear-day":
      return "clear-day";
    case "clear-night":
      return "clear-night";
    case "partly-cloudy-day":
      return "partly-cloudy-day";
    case "partly-cloudy-night":
      return "partly-cloudy-night";
    case "fog":
      return "fog";
    case "drizzle":
      return "drizzle";
    case "rain":
      return "rain";
    case "freezing-rain":
      return "sleet";
    case "snow":
      return "snow";
    case "thunderstorm":
      return "thunderstorms-rain";
    case "hail":
      return "hail";
    case "cloudy":
    default:
      return "overcast";
  }
}

function renderWeatherIcon(iconKey: WeatherIconKey, iconUrl?: string) {
  const iconName = getMeteoconIconName(iconKey);

  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/basmilius/weather-icons@2.0.0/production/fill/all/${iconName}.svg`}
      alt=""
      aria-hidden
      width={64}
      height={64}
      decoding="async"
      data-weather-api-icon={iconUrl ? "available" : "missing"}
      data-fallback={getWeatherGlyph(iconKey)}
    />
  );
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

function formatDegreeLabel(value: string) {
  if (/[\u00b0\u2103]/.test(value)) {
    return value;
  }

  return `${value}\u00b0`;
}

function getAgendaTimeLabel(item: { time: string; endTime?: string }) {
  const startTime = formatAgendaTime(item.time);

  if (!item.endTime) {
    return startTime;
  }

  return `${startTime} - ${formatAgendaTime(item.endTime)}`;
}

function getCalendarSortValue(item: CalendarItem, fallbackIndex: number) {
  if (typeof item.startsAt === "number" && Number.isFinite(item.startsAt)) {
    return item.startsAt;
  }

  const timeParts = item.time.split(":").map(Number);
  const hour = timeParts[0];
  const minute = timeParts[1];
  const minutesOfDay =
    typeof hour === "number" &&
    typeof minute === "number" &&
    Number.isFinite(hour) &&
    Number.isFinite(minute)
      ? hour * 60 + minute
      : fallbackIndex;

  const dateRank =
    item.date === "Vandaag" ? 0 : item.date === "Morgen" ? 1 : 2;

  return dateRank * 24 * 60 + minutesOfDay;
}

function sortCalendarItems(items: CalendarItem[]) {
  return [...items].sort((a, b) => {
    const startDelta =
      getCalendarSortValue(a, 0) - getCalendarSortValue(b, 0);

    if (startDelta !== 0) {
      return startDelta;
    }

    return a.title.localeCompare(b.title, "nl-NL");
  });
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
  const isMediaFocused = showMedia && display.focusedWidgetId === "media";

  const upcomingItems = sortCalendarItems(dashboardData.calendar.items).slice(
    0,
    3,
  );
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

      <div
        className={`mirror-portrait-shell ${
          isMediaFocused ? "mirror-portrait-shell--media-focus" : ""
        }`}
      >
        <div className="mirror-edge-indicator">{screenLabel}</div>

        {showWeather && !isMediaFocused ? (
          <section className="mirror-compact-weather">
            <p className="mirror-compact-weather__location">
              {dashboardData.weather.location}
            </p>
            {dashboardData.weather.locationSubtitle ? (
              <p className="mirror-compact-weather__location-subtitle">
                {dashboardData.weather.locationSubtitle}
              </p>
            ) : null}

            <section className="mirror-compact-weather__today">
              <p className="mirror-compact-weather__section-label">Vandaag</p>

              <div className="mirror-compact-weather__hero">
                <div className="mirror-compact-weather__icon">
                  {renderWeatherIcon(
                    dashboardData.weather.iconKey,
                    dashboardData.weather.iconUrl,
                  )}
                </div>

                <div className="mirror-compact-weather__hero-right">
                  <div className="mirror-compact-weather__temp">
                    {dashboardData.weather.temperature}
                  </div>
                  <p className="mirror-compact-weather__condition">
                    {dashboardData.weather.condition}
                  </p>
                </div>
              </div>

              <p className="mirror-compact-weather__detail">
                {dashboardData.weather.detailLine}
              </p>

              <div className="mirror-compact-weather__stats">
                <span>Wind: {dashboardData.weather.windSpeed}</span>
                <span>Max: {dashboardData.weather.highTemperature}</span>
                <span>Min: {dashboardData.weather.lowTemperature}</span>
              </div>

              <div className="mirror-compact-weather__table-head mirror-compact-weather__table-head--hourly">
                <span className="mirror-compact-weather__section-label">
                  Aankomende uren
                </span>
                <span className="mirror-compact-weather__table-label">
                  Temp {"\u00b0"}C
                </span>
                <span className="mirror-compact-weather__table-label">
                  Regen
                </span>
              </div>

              <div className="mirror-compact-weather__hourly">
                {dashboardData.weather.hourlyTrend.map((item) => (
                  <div
                    key={`${item.time}-${item.temperature}-${item.precipitationChance}`}
                    className="mirror-compact-weather__hourly-row"
                  >
                    <span className="mirror-compact-weather__hourly-time">
                      {item.time}
                    </span>
                    <span className="mirror-compact-weather__hourly-icon">
                      {renderWeatherIcon(item.iconKey, item.iconUrl)}
                    </span>
                    <span className="mirror-compact-weather__hourly-temp">
                      {item.temperature}
                    </span>
                    <span className="mirror-compact-weather__hourly-rain">
                      {item.precipitationChance}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <hr className="mirror-compact-weather__divider" />

            <section className="mirror-compact-weather__upcoming">
              <div className="mirror-compact-weather__table-head mirror-compact-weather__table-head--forecast">
                <span className="mirror-compact-weather__section-label">
                  Komende dagen
                </span>
                <span className="mirror-compact-weather__table-label">
                  Max {"\u00b0"}C
                </span>
                <span className="mirror-compact-weather__table-label">
                  Min {"\u00b0"}C
                </span>
              </div>

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
                      {renderWeatherIcon(item.iconKey, item.iconUrl)}
                    </span>
                    <span className="mirror-compact-weather__forecast-high">
                      {formatDegreeLabel(item.highTemperature)}
                    </span>
                    <span className="mirror-compact-weather__forecast-low">
                      {formatDegreeLabel(item.lowTemperature)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </section>
        ) : null}

        {(showClock || showCalendar || showMedia) && !isMediaFocused ? (
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
                    key={`${item.date ?? "today"}-${item.time}-${item.title}`}
                    className="mirror-compact-agenda__item"
                  >
                    {item.date ? (
                      <span className="mirror-compact-agenda__date">
                        {item.date}
                      </span>
                    ) : null}
                    <span className="mirror-compact-agenda__time">
                      {getAgendaTimeLabel(item)}
                    </span>
                    <span className="mirror-compact-agenda__title">
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {showMedia ? (
              <div className="mirror-compact-media-card">
                <MirrorMediaDock media={media} />
              </div>
            ) : null}
          </section>
        ) : null}

        {showMedia ? (
          isMediaFocused ? (
            <div className="mirror-media-focus-zone">
              <MirrorMediaDock
                media={media}
                showLyrics={display.mediaLyricsVisible}
                variant="focus"
              />
            </div>
          ) : null
        ) : null}
      </div>
    </main>
  );
}
