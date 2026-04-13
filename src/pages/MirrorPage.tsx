import { ClockWidget } from "../components/widgets/ClockWidget";
import { WeatherWidget } from "../components/widgets/WeatherWidget";
import { MediaWidget } from "../components/widgets/MediaWidget";
import { CalendarWidget } from "../components/widgets/CalendarWidget";
import { dashboardData } from "../data/mockDashboard";
import type { LayoutItem, WidgetId } from "../types/layout";
import type { MirrorSettings } from "../types/settings";
import type { PresenceState } from "../types/presence";
import type { DisplayState } from "../types/display";
import type { MediaState } from "../types/media";

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
  function renderWidget(widgetId: WidgetId) {
    switch (widgetId) {
      case "clock":
        return <ClockWidget showSeconds={settings.showSeconds} />;

      case "weather":
        return (
          <WeatherWidget
            temperature={dashboardData.weather.temperature}
            location={dashboardData.weather.location}
          />
        );

      case "media":
        return (
          <MediaWidget
            media={media}
          />
        );

      case "calendar":
        return (
          <CalendarWidget
            time={dashboardData.calendar.time}
            title={dashboardData.calendar.title}
          />
        );

      default:
        return null;
    }
  }

  return (
    <main
      className={`mirror-page mirror-page--${presence.mode} mirror-page--display-${display.mode}`}
    >
      <div className="mirror-status">
        Presence: {presence.mode} · Display: {display.mode} · Reason:{" "}
        {display.reason}
      </div>
      {layout
        .filter((item) => item.enabled)
        .map((item) => (
          <div key={item.id}>{renderWidget(item.id)}</div>
        ))}
    </main>
  );
}
