export type WeatherIconKey =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy-day"
  | "partly-cloudy-night"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing-rain"
  | "snow"
  | "thunderstorm"
  | "hail";

export type WeatherForecastItem = {
  day: string;
  iconKey: WeatherIconKey;
  iconUrl?: string;
  highTemperature: string;
  lowTemperature: string;
};

export type WeatherHourlyTrendItem = {
  time: string;
  iconKey: WeatherIconKey;
  iconUrl?: string;
  temperature: string;
  precipitationChance: string;
};

export type WeatherData = {
  temperature: string;
  location: string;
  locationSubtitle?: string;
  condition: string;
  iconKey: WeatherIconKey;
  iconUrl?: string;
  highTemperature: string;
  lowTemperature: string;
  detailLine: string;
  windSpeed: string;
  forecast: WeatherForecastItem[];
  hourlyTrend: WeatherHourlyTrendItem[];
};

export type CalendarItem = {
  date?: string;
  time: string;
  endTime?: string;
  title: string;
  startsAt?: number;
  endsAt?: number;
};

export type CalendarData = {
  items: CalendarItem[];
};

export type DashboardData = {
  weather: WeatherData;
  calendar: CalendarData;
};
