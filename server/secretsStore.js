const fs = require("fs");
const path = require("path");

const SECRETS_FILE = path.join(__dirname, "secrets.local.json");

function readSecretsFile() {
  try {
    if (!fs.existsSync(SECRETS_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(SECRETS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("failed to read secrets file", error);
    return {};
  }
}

function writeSecretsFile(nextSecrets) {
  try {
    fs.writeFileSync(
      SECRETS_FILE,
      JSON.stringify(nextSecrets, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("failed to write secrets file", error);
  }
}

function pickNonEmptyStringValues(input = {}) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(
        ([, value]) => typeof value === "string" && value.trim().length > 0,
      )
      .map(([key, value]) => [key, value.trim()]),
  );
}

function saveSection(sectionName, partialSection) {
  const currentSecrets = readSecretsFile();
  const currentSection = currentSecrets[sectionName] ?? {};

  const nextSection = {
    ...currentSection,
    ...pickNonEmptyStringValues(partialSection),
  };

  const nextSecrets = {
    ...currentSecrets,
    [sectionName]: nextSection,
  };

  writeSecretsFile(nextSecrets);

  return nextSection;
}

function getJellyfinSecrets() {
  const fileSecrets = readSecretsFile();
  const jellyfin = fileSecrets.jellyfin ?? {};

  return {
    baseUrl: jellyfin.baseUrl ?? process.env.JELLYFIN_BASE_URL ?? null,
    apiKey: jellyfin.apiKey ?? process.env.JELLYFIN_API_KEY ?? null,
    userName: jellyfin.userName ?? process.env.JELLYFIN_USER_NAME ?? null,
    deviceName: jellyfin.deviceName ?? process.env.JELLYFIN_DEVICE_NAME ?? null,
  };
}

function saveJellyfinSecrets(partialJellyfinSecrets) {
  return saveSection("jellyfin", partialJellyfinSecrets);
}

function getSpotifySecrets() {
  const fileSecrets = readSecretsFile();
  const spotify = fileSecrets.spotify ?? {};

  return {
    clientId: spotify.clientId ?? process.env.SPOTIFY_CLIENT_ID ?? null,
    clientSecret:
      spotify.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET ?? null,
    refreshToken:
      spotify.refreshToken ?? process.env.SPOTIFY_REFRESH_TOKEN ?? null,
    redirectUri:
      spotify.redirectUri ??
      process.env.SPOTIFY_REDIRECT_URI ??
      "http://127.0.0.1:8787/auth/spotify/callback",
  };
}

function saveSpotifySecrets(partialSpotifySecrets) {
  return saveSection("spotify", partialSpotifySecrets);
}

function getWeatherConfig() {
  const fileSecrets = readSecretsFile();
  const weather = fileSecrets.weather ?? {};

  return {
    locationQuery:
      weather.locationQuery ?? process.env.WEATHER_LOCATION_QUERY ?? "Den Haag",
    countryCode:
      weather.countryCode ?? process.env.WEATHER_COUNTRY_CODE ?? "NL",
    latitude:
      typeof weather.latitude === "string" && weather.latitude.length > 0
        ? Number(weather.latitude)
        : process.env.WEATHER_LATITUDE
          ? Number(process.env.WEATHER_LATITUDE)
          : null,
    longitude:
      typeof weather.longitude === "string" && weather.longitude.length > 0
        ? Number(weather.longitude)
        : process.env.WEATHER_LONGITUDE
          ? Number(process.env.WEATHER_LONGITUDE)
          : null,
  };
}

function saveWeatherConfig(partialWeatherConfig) {
  return saveSection("weather", partialWeatherConfig);
}

function getCalendarConfig() {
  const fileSecrets = readSecretsFile();
  const calendar = fileSecrets.calendar ?? {};

  const feedUrlsText =
    calendar.feedUrlsText ?? process.env.CALENDAR_FEED_URLS ?? "";

  const feedUrls = feedUrlsText
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    feedUrlsText,
    feedUrls,
  };
}

function getEditableProviderConfig() {
  const weather = getWeatherConfig();
  const calendar = getCalendarConfig();

  return {
    weather: {
      locationQuery: weather.locationQuery ?? "",
      countryCode: weather.countryCode ?? "",
      latitude:
        Number.isFinite(weather.latitude) ? String(weather.latitude) : "",
      longitude:
        Number.isFinite(weather.longitude) ? String(weather.longitude) : "",
    },
    calendar: {
      feedUrlsText: calendar.feedUrlsText ?? "",
    },
  };
}

function saveCalendarConfig(partialCalendarConfig) {
  return saveSection("calendar", partialCalendarConfig);
}

function getWeatherConfig() {
  const fileSecrets = readSecretsFile();
  const weather = fileSecrets.weather ?? {};

  return {
    locationQuery:
      weather.locationQuery ?? process.env.WEATHER_LOCATION_QUERY ?? "Den Haag",
    countryCode:
      weather.countryCode ?? process.env.WEATHER_COUNTRY_CODE ?? "NL",
    latitude:
      typeof weather.latitude === "number"
        ? weather.latitude
        : process.env.WEATHER_LATITUDE
          ? Number(process.env.WEATHER_LATITUDE)
          : null,
    longitude:
      typeof weather.longitude === "number"
        ? weather.longitude
        : process.env.WEATHER_LONGITUDE
          ? Number(process.env.WEATHER_LONGITUDE)
          : null,
  };
}

function getCalendarConfig() {
  const fileSecrets = readSecretsFile();
  const calendar = fileSecrets.calendar ?? {};

  const rawFeedUrls =
    calendar.feedUrlsText ?? process.env.CALENDAR_FEED_URLS ?? "";

  const feedUrls = rawFeedUrls
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    feedUrls,
  };
}

function getRedactedProviderSecrets() {
  const jellyfin = getJellyfinSecrets();
  const spotify = getSpotifySecrets();
  const weather = getWeatherConfig();
  const calendar = getCalendarConfig();

  return {
    jellyfin: {
      hasBaseUrl: Boolean(jellyfin.baseUrl),
      hasApiKey: Boolean(jellyfin.apiKey),
      hasUserName: Boolean(jellyfin.userName),
      hasDeviceName: Boolean(jellyfin.deviceName),
    },
    spotify: {
      hasClientId: Boolean(spotify.clientId),
      hasClientSecret: Boolean(spotify.clientSecret),
      hasRefreshToken: Boolean(spotify.refreshToken),
      hasRedirectUri: Boolean(spotify.redirectUri),
    },
    weather: {
      hasLocationQuery: Boolean(weather.locationQuery),
      hasCountryCode: Boolean(weather.countryCode),
      hasLatitude: Number.isFinite(weather.latitude),
      hasLongitude: Number.isFinite(weather.longitude),
    },
    calendar: {
      hasFeedUrls: calendar.feedUrls.length > 0,
    },
  };
}

module.exports = {
  SECRETS_FILE,
  getJellyfinSecrets,
  saveJellyfinSecrets,
  getSpotifySecrets,
  saveSpotifySecrets,
  getWeatherConfig,
  saveWeatherConfig,
  getCalendarConfig,
  saveCalendarConfig,
  getEditableProviderConfig,
  getRedactedProviderSecrets,
};