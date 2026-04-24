const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SECRETS_FILE = path.join(__dirname, "secrets.local.json");
const PROJECT_ENV_FILE = path.join(__dirname, "..", ".env.local");

const PROVIDER_FIELD_LABELS = {
  jellyfin: {
    baseUrl: "Jellyfin Base URL",
    apiKey: "Jellyfin API Key",
    userName: "Preferred Jellyfin User",
    deviceName: "Preferred Jellyfin Device",
  },
  spotify: {
    clientId: "Spotify Client ID",
    clientSecret: "Spotify Client Secret",
    refreshToken: "Spotify Refresh Token",
    redirectUri: "Spotify Redirect URI",
  },
  weather: {
    locationQuery: "Weather Location Query",
    countryCode: "Weather Country Code",
    apiKey: "WeatherAPI Key",
    latitude: "Weather Latitude",
    longitude: "Weather Longitude",
  },
};

const PROVIDER_ENV_KEYS = {
  jellyfin: {
    baseUrl: "JELLYFIN_BASE_URL",
    apiKey: "JELLYFIN_API_KEY",
    userName: "JELLYFIN_USER_NAME",
    deviceName: "JELLYFIN_DEVICE_NAME",
  },
  spotify: {
    clientId: "SPOTIFY_CLIENT_ID",
    clientSecret: "SPOTIFY_CLIENT_SECRET",
    refreshToken: "SPOTIFY_REFRESH_TOKEN",
    redirectUri: "SPOTIFY_REDIRECT_URI",
  },
  weather: {
    locationQuery: "WEATHER_LOCATION_QUERY",
    countryCode: "WEATHER_COUNTRY_CODE",
    apiKey: "WEATHER_API_KEY",
    latitude: "WEATHER_LATITUDE",
    longitude: "WEATHER_LONGITUDE",
  },
};

const FIXED_PROVIDERS = ["jellyfin", "spotify", "weather"];
const CALENDAR_DEFAULT_ENTRY_LABEL = "Calendar feed";

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

function stripEnvValueQuotes(value) {
  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function readProjectEnvFile() {
  try {
    if (!fs.existsSync(PROJECT_ENV_FILE)) {
      return {};
    }

    const entries = {};
    const raw = fs.readFileSync(PROJECT_ENV_FILE, "utf-8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const powershellMatch = trimmedLine.match(
        /^\$env:([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
      );
      const dotenvMatch = trimmedLine.match(
        /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
      );
      const match = powershellMatch ?? dotenvMatch;

      if (!match) {
        continue;
      }

      entries[match[1]] = stripEnvValueQuotes(match[2]);
    }

    return entries;
  } catch (error) {
    console.error("failed to read project env file", error);
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

function normalizeStoredField(storedValue, fallbackValue, defaultLabel) {
  if (
    storedValue &&
    typeof storedValue === "object" &&
    !Array.isArray(storedValue)
  ) {
    const label =
      typeof storedValue.label === "string" &&
      storedValue.label.trim().length > 0
        ? storedValue.label.trim()
        : defaultLabel;

    const value =
      typeof storedValue.value === "string" &&
      storedValue.value.trim().length > 0
        ? storedValue.value.trim()
        : typeof fallbackValue === "string" && fallbackValue.trim().length > 0
          ? fallbackValue.trim()
          : "";

    const updatedAt = Number.isFinite(Number(storedValue.updatedAt))
      ? Number(storedValue.updatedAt)
      : null;

    return {
      label,
      value,
      updatedAt,
    };
  }

  if (typeof storedValue === "string" && storedValue.trim().length > 0) {
    return {
      label: defaultLabel,
      value: storedValue.trim(),
      updatedAt: null,
    };
  }

  if (typeof fallbackValue === "string" && fallbackValue.trim().length > 0) {
    return {
      label: defaultLabel,
      value: fallbackValue.trim(),
      updatedAt: null,
    };
  }

  return {
    label: defaultLabel,
    value: "",
    updatedAt: null,
  };
}

function getProviderSectionState(sectionName) {
  if (!FIXED_PROVIDERS.includes(sectionName)) {
    throw new Error(`Unsupported provider section: ${sectionName}`);
  }

  const fileSecrets = readSecretsFile();
  const localEnv = readProjectEnvFile();
  const storedSection = fileSecrets[sectionName] ?? {};
  const fieldLabels = PROVIDER_FIELD_LABELS[sectionName];
  const envKeys = PROVIDER_ENV_KEYS[sectionName];

  return Object.fromEntries(
    Object.entries(fieldLabels).map(([fieldKey, defaultLabel]) => {
      const envKey = envKeys[fieldKey];
      const fallbackValue =
        typeof envKey === "string"
          ? (process.env[envKey] ?? localEnv[envKey] ?? "")
          : "";

      return [
        fieldKey,
        normalizeStoredField(
          storedSection[fieldKey],
          fallbackValue,
          defaultLabel,
        ),
      ];
    }),
  );
}

function saveProviderSection(sectionName, partialSection) {
  if (!FIXED_PROVIDERS.includes(sectionName)) {
    throw new Error(`Unsupported provider section: ${sectionName}`);
  }

  const currentSecrets = readSecretsFile();
  const currentSection = currentSecrets[sectionName] ?? {};
  const currentState = getProviderSectionState(sectionName);
  const fieldLabels = PROVIDER_FIELD_LABELS[sectionName];

  const nextSection = { ...currentSection };
  const now = Date.now();

  for (const fieldKey of Object.keys(fieldLabels)) {
    const incomingValue = partialSection?.[fieldKey];

    if (incomingValue === undefined) {
      continue;
    }

    const currentField = currentState[fieldKey];

    if (typeof incomingValue === "string") {
      const trimmedValue = incomingValue.trim();

      nextSection[fieldKey] = {
        label: currentField.label,
        value: trimmedValue.length > 0 ? trimmedValue : currentField.value,
        updatedAt: now,
      };

      continue;
    }

    if (
      incomingValue &&
      typeof incomingValue === "object" &&
      !Array.isArray(incomingValue)
    ) {
      const nextLabel =
        typeof incomingValue.label === "string" &&
        incomingValue.label.trim().length > 0
          ? incomingValue.label.trim()
          : currentField.label;

      const nextRawValue =
        typeof incomingValue.value === "string"
          ? incomingValue.value.trim()
          : "";

      nextSection[fieldKey] = {
        label: nextLabel,
        value: nextRawValue.length > 0 ? nextRawValue : currentField.value,
        updatedAt: now,
      };
    }
  }

  const nextSecrets = {
    ...currentSecrets,
    [sectionName]: nextSection,
  };

  writeSecretsFile(nextSecrets);

  return getProviderSectionState(sectionName);
}

function createCalendarEntryId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCalendarEntry(storedEntry, index) {
  if (!storedEntry || typeof storedEntry !== "object" || Array.isArray(storedEntry)) {
    return null;
  }

  const label =
    typeof storedEntry.label === "string" && storedEntry.label.trim().length > 0
      ? storedEntry.label.trim()
      : `${CALENDAR_DEFAULT_ENTRY_LABEL} ${index + 1}`;

  const value =
    typeof storedEntry.value === "string" && storedEntry.value.trim().length > 0
      ? storedEntry.value.trim()
      : "";

  const updatedAt = Number.isFinite(Number(storedEntry.updatedAt))
    ? Number(storedEntry.updatedAt)
    : null;

  const id =
    typeof storedEntry.id === "string" && storedEntry.id.trim().length > 0
      ? storedEntry.id.trim()
      : createCalendarEntryId();

  return {
    id,
    label,
    value,
    updatedAt,
  };
}

function getCalendarEntriesState() {
  const fileSecrets = readSecretsFile();
  const storedSection = fileSecrets.calendar ?? {};
  const storedEntries = Array.isArray(storedSection.entries)
    ? storedSection.entries
    : [];

  return storedEntries
    .map((entry, index) => normalizeCalendarEntry(entry, index))
    .filter(Boolean);
}

function toFieldSummary(fieldState) {
  return {
    label: fieldState.label,
    hasValue: fieldState.value.length > 0,
    updatedAt: fieldState.updatedAt,
  };
}

function getJellyfinSecrets() {
  const jellyfin = getProviderSectionState("jellyfin");

  return {
    baseUrl: jellyfin.baseUrl.value || null,
    apiKey: jellyfin.apiKey.value || null,
    userName: jellyfin.userName.value || null,
    deviceName: jellyfin.deviceName.value || null,
  };
}

function saveJellyfinSecrets(partialJellyfinSecrets) {
  return saveProviderSection("jellyfin", partialJellyfinSecrets);
}

function getSpotifySecrets() {
  const spotify = getProviderSectionState("spotify");

  return {
    clientId: spotify.clientId.value || null,
    clientSecret: spotify.clientSecret.value || null,
    refreshToken: spotify.refreshToken.value || null,
    redirectUri:
      spotify.redirectUri.value ||
      "http://127.0.0.1:8787/auth/spotify/callback",
  };
}

function saveSpotifySecrets(partialSpotifySecrets) {
  return saveProviderSection("spotify", partialSpotifySecrets);
}

function getWeatherConfig() {
  const weather = getProviderSectionState("weather");

  const latitude =
    weather.latitude.value.trim().length > 0
      ? Number(weather.latitude.value)
      : null;
  const longitude =
    weather.longitude.value.trim().length > 0
      ? Number(weather.longitude.value)
      : null;

  return {
    locationQuery: weather.locationQuery.value || "Den Haag",
    countryCode: weather.countryCode.value || "NL",
    apiKey: weather.apiKey.value || null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function saveWeatherConfig(partialWeatherConfig) {
  return saveProviderSection("weather", partialWeatherConfig);
}

function getCalendarConfig() {
  const calendarEntries = getCalendarEntriesState();
  const feedUrls = calendarEntries
    .map((entry) => entry.value.trim())
    .filter(Boolean);

  return {
    entries: calendarEntries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      updatedAt: entry.updatedAt,
    })),
    feedUrls,
  };
}

function saveCalendarConfig(partialCalendarConfig) {
  const currentSecrets = readSecretsFile();
  const currentEntries = getCalendarEntriesState();
  const now = Date.now();

  let nextEntries = [...currentEntries];

  const removeEntryId =
    typeof partialCalendarConfig?.removeEntryId === "string"
      ? partialCalendarConfig.removeEntryId.trim()
      : "";

  if (removeEntryId.length > 0) {
    nextEntries = nextEntries.filter((entry) => entry.id !== removeEntryId);
  }

  const addEntry = partialCalendarConfig?.addEntry;

  if (addEntry && typeof addEntry === "object" && !Array.isArray(addEntry)) {
    const nextValue =
      typeof addEntry.value === "string" ? addEntry.value.trim() : "";

    if (nextValue.length === 0) {
      throw new Error("Calendar feed URL is verplicht bij toevoegen.");
    }

    const nextLabel =
      typeof addEntry.label === "string" && addEntry.label.trim().length > 0
        ? addEntry.label.trim()
        : `${CALENDAR_DEFAULT_ENTRY_LABEL} ${nextEntries.length + 1}`;

    nextEntries.push({
      id: createCalendarEntryId(),
      label: nextLabel,
      value: nextValue,
      updatedAt: now,
    });
  }

  const updateEntry = partialCalendarConfig?.updateEntry;

  if (
    updateEntry &&
    typeof updateEntry === "object" &&
    !Array.isArray(updateEntry)
  ) {
    const targetId =
      typeof updateEntry.id === "string" ? updateEntry.id.trim() : "";

    if (targetId.length === 0) {
      throw new Error("Calendar entry id ontbreekt.");
    }

    const entryIndex = nextEntries.findIndex((entry) => entry.id === targetId);

    if (entryIndex === -1) {
      throw new Error("Calendar entry niet gevonden.");
    }

    const currentEntry = nextEntries[entryIndex];

    const nextLabel =
      typeof updateEntry.label === "string" && updateEntry.label.trim().length > 0
        ? updateEntry.label.trim()
        : currentEntry.label;

    const hasValueUpdate = typeof updateEntry.value === "string";
    const nextValue = hasValueUpdate
      ? updateEntry.value.trim()
      : currentEntry.value;

    nextEntries[entryIndex] = {
      ...currentEntry,
      label: nextLabel,
      value: nextValue.length > 0 ? nextValue : currentEntry.value,
      updatedAt: now,
    };
  }

  const nextSecrets = {
    ...currentSecrets,
    calendar: {
      entries: nextEntries,
    },
  };

  writeSecretsFile(nextSecrets);

  return getCalendarEntriesState();
}

function getEditableProviderConfig() {
  return {
    weather: {
      locationQuery: "",
      countryCode: "",
      apiKey: "",
      latitude: "",
      longitude: "",
    },
    calendar: {
      entries: [],
    },
  };
}

function getRedactedProviderSecrets() {
  const jellyfin = getProviderSectionState("jellyfin");
  const spotify = getProviderSectionState("spotify");
  const weather = getProviderSectionState("weather");
  const calendarEntries = getCalendarEntriesState();

  return {
    jellyfin: {
      baseUrl: toFieldSummary(jellyfin.baseUrl),
      apiKey: toFieldSummary(jellyfin.apiKey),
      userName: toFieldSummary(jellyfin.userName),
      deviceName: toFieldSummary(jellyfin.deviceName),
    },
    spotify: {
      clientId: toFieldSummary(spotify.clientId),
      clientSecret: toFieldSummary(spotify.clientSecret),
      refreshToken: toFieldSummary(spotify.refreshToken),
      redirectUri: toFieldSummary(spotify.redirectUri),
    },
    weather: {
      locationQuery: toFieldSummary(weather.locationQuery),
      countryCode: toFieldSummary(weather.countryCode),
      apiKey: toFieldSummary(weather.apiKey),
      latitude: toFieldSummary(weather.latitude),
      longitude: toFieldSummary(weather.longitude),
    },
    calendar: {
      entries: calendarEntries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        hasValue: entry.value.length > 0,
        updatedAt: entry.updatedAt,
      })),
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
