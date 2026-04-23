import type { DashboardData } from "../types/dashboard";

export const dashboardData: DashboardData = {
  weather: {
    temperature: "11°C",
    location: "Den Haag",
    locationSubtitle: "huidige locatie",
    condition: "Licht bewolkt",
    iconKey: "partly-cloudy-day",
    iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/116.png",
    highTemperature: "14°",
    lowTemperature: "8°",
    detailLine: "Voelt als 9° · regenkans 25%",
    windSpeed: "6.4 m/s",
    forecast: [
      {
        day: "Mon",
        iconKey: "partly-cloudy-day",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/116.png",
        highTemperature: "8",
        lowTemperature: "0",
      },
      {
        day: "Tue",
        iconKey: "rain",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/308.png",
        highTemperature: "-2",
        lowTemperature: "-4",
      },
      {
        day: "Wed",
        iconKey: "clear-day",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/113.png",
        highTemperature: "-3",
        lowTemperature: "-9",
      },
    ],
    hourlyTrend: [
      {
        time: "10:00",
        iconKey: "partly-cloudy-day",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/116.png",
        temperature: "11°",
        precipitationChance: "20%",
      },
      {
        time: "13:00",
        iconKey: "rain",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/308.png",
        temperature: "12°",
        precipitationChance: "55%",
      },
      {
        time: "16:00",
        iconKey: "cloudy",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/day/119.png",
        temperature: "10°",
        precipitationChance: "40%",
      },
      {
        time: "19:00",
        iconKey: "clear-night",
        iconUrl: "https://cdn.weatherapi.com/weather/64x64/night/113.png",
        temperature: "8°",
        precipitationChance: "10%",
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