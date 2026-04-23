export type ProviderSecretFieldStatus = {
  label: string;
  hasValue: boolean;
  updatedAt: number | null;
};

export type ProviderSecretFieldInput = {
  label?: string;
  value?: string;
};

export type CalendarSecretEntryStatus = {
  id: string;
  label: string;
  hasValue: boolean;
  updatedAt: number | null;
};

export type CalendarSecretsInput = {
  addEntry?: {
    label?: string;
    value: string;
  };
  updateEntry?: {
    id: string;
    label?: string;
    value?: string;
  };
  removeEntryId?: string;
};

export type ProviderConfigStatus = {
  jellyfin: {
    baseUrl: ProviderSecretFieldStatus;
    apiKey: ProviderSecretFieldStatus;
    userName: ProviderSecretFieldStatus;
    deviceName: ProviderSecretFieldStatus;
  };
  spotify: {
    clientId: ProviderSecretFieldStatus;
    clientSecret: ProviderSecretFieldStatus;
    refreshToken: ProviderSecretFieldStatus;
    redirectUri: ProviderSecretFieldStatus;
  };
  weather: {
    locationQuery: ProviderSecretFieldStatus;
    countryCode: ProviderSecretFieldStatus;
    apiKey: ProviderSecretFieldStatus;
    latitude: ProviderSecretFieldStatus;
    longitude: ProviderSecretFieldStatus;
  };
  calendar: {
    entries: CalendarSecretEntryStatus[];
  };
};

export type ProviderSecretsInput = {
  jellyfin?: {
    baseUrl?: ProviderSecretFieldInput | string;
    apiKey?: ProviderSecretFieldInput | string;
    userName?: ProviderSecretFieldInput | string;
    deviceName?: ProviderSecretFieldInput | string;
  };
  spotify?: {
    clientId?: ProviderSecretFieldInput | string;
    clientSecret?: ProviderSecretFieldInput | string;
    refreshToken?: ProviderSecretFieldInput | string;
    redirectUri?: ProviderSecretFieldInput | string;
  };
  weather?: {
    locationQuery?: ProviderSecretFieldInput | string;
    countryCode?: ProviderSecretFieldInput | string;
    apiKey?: ProviderSecretFieldInput | string;
    latitude?: ProviderSecretFieldInput | string;
    longitude?: ProviderSecretFieldInput | string;
  };
  calendar?: {
    addEntry?: CalendarSecretsInput["addEntry"];
    updateEntry?: CalendarSecretsInput["updateEntry"];
    removeEntryId?: string;
  };
};

function createDefaultField(label: string): ProviderSecretFieldStatus {
  return {
    label,
    hasValue: false,
    updatedAt: null,
  };
}

export const defaultProviderConfigStatus: ProviderConfigStatus = {
  jellyfin: {
    baseUrl: createDefaultField("Jellyfin Base URL"),
    apiKey: createDefaultField("Jellyfin API Key"),
    userName: createDefaultField("Preferred Jellyfin User"),
    deviceName: createDefaultField("Preferred Jellyfin Device"),
  },
  spotify: {
    clientId: createDefaultField("Spotify Client ID"),
    clientSecret: createDefaultField("Spotify Client Secret"),
    refreshToken: createDefaultField("Spotify Refresh Token"),
    redirectUri: createDefaultField("Spotify Redirect URI"),
  },
  weather: {
    locationQuery: createDefaultField("Weather Location Query"),
    countryCode: createDefaultField("Weather Country Code"),
    apiKey: createDefaultField("WeatherAPI Key"),
    latitude: createDefaultField("Weather Latitude"),
    longitude: createDefaultField("Weather Longitude"),
  },
  calendar: {
    entries: [],
  },
};