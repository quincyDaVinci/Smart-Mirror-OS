const { getWeatherConfig } = require("../secretsStore");

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

function roundTemperature(value) {
  return `${Math.round(value)}°`;
}

function getWeatherPresentation(code) {
  if (code === 0) {
    return { iconKey: "sunny", condition: "Zonnig" };
  }

  if (code === 1 || code === 2) {
    return { iconKey: "partly-cloudy", condition: "Licht bewolkt" };
  }

  if (code === 3 || code === 45 || code === 48) {
    return { iconKey: "cloudy", condition: "Bewolkt" };
  }

  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return { iconKey: "rain", condition: "Regen" };
  }

  return { iconKey: "cloudy", condition: "Onbekend" };
}

function formatWeekdayLabel(dateString) {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

async function fetchLocation() {
  const { locationQuery, countryCode, latitude, longitude } =
    getWeatherConfig();

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      name: locationQuery || "Configured location",
      latitude,
      longitude,
    };
  }

  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", locationQuery);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  if (countryCode) {
    url.searchParams.set("countryCode", countryCode);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Geocoding gaf status ${response.status}`);
  }

  const payload = await response.json();
  const location = payload.results?.[0];

  if (!location) {
    throw new Error(
      `Geen weather-locatie gevonden voor "${locationQuery}" (${countryCode ?? "geen countryCode"})`,
    );
  }

  return location;
}

async function fetchMirrorWeather() {
  const location = await fetchLocation();

  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min",
  );
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Forecast gaf status ${response.status}`);
  }

  const payload = await response.json();

  const current = payload.current;
  const daily = payload.daily;

  const weatherPresentation = getWeatherPresentation(current.weather_code);

  return {
    weather: {
      temperature: `${Math.round(current.temperature_2m)}°C`,
      location: location.name,
      condition: weatherPresentation.condition,
      iconKey: weatherPresentation.iconKey,
      highTemperature: roundTemperature(daily.temperature_2m_max[0]),
      lowTemperature: roundTemperature(daily.temperature_2m_min[0]),
      detailLine: `Voelt als ${Math.round(
        current.temperature_2m,
      )}° · kans op regen onbekend`,
      windSpeed: `${Math.round(current.wind_speed_10m)} km/h`,
      forecast: daily.time.slice(1, 4).map((dateString, index) => {
        const presentation = getWeatherPresentation(
          daily.weather_code[index + 1],
        );

        return {
          day: formatWeekdayLabel(dateString),
          iconKey: presentation.iconKey,
          highTemperature: String(
            Math.round(daily.temperature_2m_max[index + 1]),
          ),
          lowTemperature: String(
            Math.round(daily.temperature_2m_min[index + 1]),
          ),
        };
      }),
    },
  };
}

module.exports = {
  fetchMirrorWeather,
};
