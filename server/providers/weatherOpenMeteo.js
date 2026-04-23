const { getWeatherConfig } = require("../secretsStore");

const WEATHER_API_URL = "https://api.weatherapi.com/v1/forecast.json";

function normalizeIconUrl(iconPath) {
  if (typeof iconPath !== "string" || iconPath.trim().length === 0) {
    return undefined;
  }

  if (iconPath.startsWith("//")) {
    return `https:${iconPath}`;
  }

  return iconPath;
}

function mapWeatherApiCodeToIconKey(code, isDay) {
  const dayValue = Boolean(isDay);

  if (code === 1000) {
    return dayValue ? "clear-day" : "clear-night";
  }

  if ([1003].includes(code)) {
    return dayValue ? "partly-cloudy-day" : "partly-cloudy-night";
  }

  if ([1006, 1009].includes(code)) {
    return "cloudy";
  }

  if ([1030, 1135, 1147].includes(code)) {
    return "fog";
  }

  if ([1063, 1150, 1153, 1168, 1171].includes(code)) {
    return "drizzle";
  }

  if (
    [
      1180, 1183, 1186, 1189, 1192, 1195, 1240, 1243, 1246,
    ].includes(code)
  ) {
    return "rain";
  }

  if ([1198, 1201, 1249, 1252].includes(code)) {
    return "freezing-rain";
  }

  if (
    [
      1066, 1069, 1072, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222,
      1225, 1237, 1255, 1258, 1261, 1264,
    ].includes(code)
  ) {
    return "snow";
  }

  if ([1273, 1276, 1279, 1282].includes(code)) {
    return "thunderstorm";
  }

  return "cloudy";
}

function buildLocationDisplay(locationPayload, configuredQuery, hasCoordinates) {
  const city = typeof locationPayload?.name === "string" ? locationPayload.name : "";
  const region =
    typeof locationPayload?.region === "string" &&
    locationPayload.region.trim().length > 0
      ? locationPayload.region
      : "";
  const country =
    typeof locationPayload?.country === "string" &&
    locationPayload.country.trim().length > 0
      ? locationPayload.country
      : "";

  const pieces = [city, region, country].filter((piece, index, self) => {
    if (!piece) {
      return false;
    }

    return self.indexOf(piece) === index;
  });

  const location = pieces.length > 0 ? pieces.join(", ") : configuredQuery;

  return {
    location: location || "Onbekende locatie",
    locationSubtitle: hasCoordinates ? "huidige locatie" : undefined,
  };
}

function formatWeekdayLabel(dateString) {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function formatHourLabel(localDateTime) {
  const parsed = new Date(localDateTime);

  if (Number.isNaN(parsed.getTime())) {
    return localDateTime;
  }

  return parsed.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function roundTemperature(value) {
  return `${Math.round(Number(value))}°`;
}

async function fetchMirrorWeather() {
  const { locationQuery, countryCode, latitude, longitude, apiKey } =
    getWeatherConfig();

  if (!apiKey) {
    throw new Error(
      "WeatherAPI key ontbreekt. Voeg WEATHER_API_KEY toe in provider secrets.",
    );
  }

  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const queryValue = hasCoordinates
    ? `${latitude},${longitude}`
    : [locationQuery, countryCode].filter(Boolean).join(", ");

  if (!queryValue || queryValue.trim().length === 0) {
    throw new Error("Geen weather locatie beschikbaar.");
  }

  const url = new URL(WEATHER_API_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", queryValue);
  url.searchParams.set("days", "4");
  url.searchParams.set("aqi", "no");
  url.searchParams.set("alerts", "no");
  url.searchParams.set("lang", "nl");

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WeatherAPI gaf status ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const current = payload.current;
  const locationPayload = payload.location;
  const forecastDays = Array.isArray(payload?.forecast?.forecastday)
    ? payload.forecast.forecastday
    : [];

  if (!current || forecastDays.length === 0) {
    throw new Error("WeatherAPI antwoord mist current of forecast data.");
  }

  const today = forecastDays[0];
  const nowEpochSeconds = Number(current.last_updated_epoch ?? Date.now() / 1000);
  const futureHours = Array.isArray(today.hour)
    ? today.hour
        .filter((hourItem) => Number(hourItem?.time_epoch) >= nowEpochSeconds)
        .slice(0, 8)
    : [];

  const weatherPresentationKey = mapWeatherApiCodeToIconKey(
    Number(current.condition?.code ?? 1006),
    Number(current.is_day) === 1,
  );

  const locationDisplay = buildLocationDisplay(
    locationPayload,
    locationQuery,
    hasCoordinates,
  );

  return {
    weather: {
      temperature: `${Math.round(Number(current.temp_c))}°C`,
      location: locationDisplay.location,
      locationSubtitle: locationDisplay.locationSubtitle,
      condition: current.condition?.text ?? "Onbekend",
      iconKey: weatherPresentationKey,
      iconUrl: normalizeIconUrl(current.condition?.icon),
      highTemperature: roundTemperature(today.day?.maxtemp_c),
      lowTemperature: roundTemperature(today.day?.mintemp_c),
      detailLine: `Voelt als ${Math.round(Number(current.feelslike_c))}° · regenkans ${Math.round(Number(today.day?.daily_chance_of_rain ?? 0))}%`,
      windSpeed: `${Math.round(Number(current.wind_kph))} km/h`,
      hourlyTrend: futureHours.map((hourItem) => ({
        time: formatHourLabel(hourItem.time),
        iconKey: mapWeatherApiCodeToIconKey(
          Number(hourItem?.condition?.code ?? 1006),
          Number(hourItem?.is_day) === 1,
        ),
        iconUrl: normalizeIconUrl(hourItem?.condition?.icon),
        temperature: `${Math.round(Number(hourItem?.temp_c ?? 0))}°`,
        precipitationChance: `${Math.round(Number(hourItem?.chance_of_rain ?? 0))}%`,
      })),
      forecast: forecastDays.slice(1, 4).map((dayPayload) => ({
        day: formatWeekdayLabel(dayPayload.date),
        iconKey: mapWeatherApiCodeToIconKey(
          Number(dayPayload?.day?.condition?.code ?? 1006),
          true,
        ),
        iconUrl: normalizeIconUrl(dayPayload?.day?.condition?.icon),
        highTemperature: String(Math.round(Number(dayPayload?.day?.maxtemp_c ?? 0))),
        lowTemperature: String(Math.round(Number(dayPayload?.day?.mintemp_c ?? 0))),
      })),
    },
  };
}

module.exports = {
  fetchMirrorWeather,
};
