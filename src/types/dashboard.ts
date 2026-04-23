export type WeatherIconKey =
  | "sunny"
  | "partly-cloudy"
  | "cloudy"
  | "rain";

export type WeatherForecastItem = {
  day: string;
  iconKey: WeatherIconKey;
  highTemperature: string;
  lowTemperature: string;
};

export type WeatherData = {
  temperature: string;
  location: string;
  condition: string;
  iconKey: WeatherIconKey;
  highTemperature: string;
  lowTemperature: string;
  detailLine: string;
  windSpeed: string;
  forecast: WeatherForecastItem[];
};

export type MediaData = {
  title: string;
  artist: string;
};

export type CalendarItem = {
  time: string;
  title: string;
};

export type CalendarData = {
  items: CalendarItem[];
};

export type DashboardData = {
  weather: WeatherData;
  media: MediaData;
  calendar: CalendarData;
};