export type WeatherData = {
  temperature: string;
  location: string;
};

export type MediaData = {
  title: string;
  artist: string;
};

export type CalendarData = {
  time: string;
  title: string;
};

export type DashboardData = {
  weather: WeatherData;
  media: MediaData;
  calendar: CalendarData;
};