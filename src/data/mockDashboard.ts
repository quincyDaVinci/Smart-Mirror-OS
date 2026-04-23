import type { DashboardData } from "../types/dashboard";

export const dashboardData: DashboardData = {
  weather: {
    temperature: "11°C",
    location: "Den Haag",
    condition: "Licht bewolkt",
    iconKey: "cloudy",
    highTemperature: "14°",
    lowTemperature: "8°",
    detailLine: "Voelt als 9°",
    windSpeed: "6.4 m/s",
    forecast: [
      {
        day: "Mon",
        iconKey: "cloudy",
        highTemperature: "8",
        lowTemperature: "0",
      },
      {
        day: "Tue",
        iconKey: "rain",
        highTemperature: "-2",
        lowTemperature: "-4",
      },
      {
        day: "Wed",
        iconKey: "cloudy",
        highTemperature: "-3",
        lowTemperature: "-9",
      },
    ],
  },
  calendar: {
    items: [
      {
        time: "09:00",
        title: "Stand-up",
      },
      {
        time: "13:30",
        title: "Design review",
      },
    ],
  },
};