export type ProviderConfigStatus = {
  jellyfin: {
    hasBaseUrl: boolean;
    hasApiKey: boolean;
    hasUserName: boolean;
    hasDeviceName: boolean;
  };
  spotify: {
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasRefreshToken: boolean;
    hasRedirectUri: boolean;
  };
  weather: {
    hasLocationQuery: boolean;
    hasCountryCode: boolean;
    hasLatitude: boolean;
    hasLongitude: boolean;
  };
  calendar: {
    hasFeedUrls: boolean;
  };
};

export type ProviderSecretsInput = {
  jellyfin?: {
    baseUrl?: string;
    apiKey?: string;
    userName?: string;
    deviceName?: string;
  };
  spotify?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    redirectUri?: string;
  };
  weather?: {
    locationQuery?: string;
    countryCode?: string;
    latitude?: string;
    longitude?: string;
  };
  calendar?: {
    feedUrlsText?: string;
  };
};

export const defaultProviderConfigStatus: ProviderConfigStatus = {
  jellyfin: {
    hasBaseUrl: false,
    hasApiKey: false,
    hasUserName: false,
    hasDeviceName: false,
  },
  spotify: {
    hasClientId: false,
    hasClientSecret: false,
    hasRefreshToken: false,
    hasRedirectUri: false,
  },
  weather: {
    hasLocationQuery: false,
    hasCountryCode: false,
    hasLatitude: false,
    hasLongitude: false,
  },
  calendar: {
    hasFeedUrls: false,
  },
};