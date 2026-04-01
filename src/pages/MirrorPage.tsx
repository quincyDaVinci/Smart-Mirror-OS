import { ClockWidget } from "../components/widgets/ClockWidget";
import { WeatherWidget } from "../components/widgets/WeatherWidget";
import { MediaWidget } from "../components/widgets/MediaWidget";
import { CalendarWidget } from "../components/widgets/CalendarWidget";
import { dashboardData } from "../data/mockDashboard";
import type { LayoutItem, WidgetId } from "../types/layout";

type MirrorPageProps = {
  layout: LayoutItem[];
};

export function MirrorPage({ layout }: MirrorPageProps) {
  function renderWidget(widgetId: WidgetId) {
    switch (widgetId) {
      case "clock":
        return <ClockWidget />;

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
            title={dashboardData.media.title}
            artist={dashboardData.media.artist}
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
    <main className="mirror">
      {layout
        .filter((item) => item.enabled)
        .map((item) => (
          <div key={item.id}>{renderWidget(item.id)}</div>
        ))}
    </main>
  );
}