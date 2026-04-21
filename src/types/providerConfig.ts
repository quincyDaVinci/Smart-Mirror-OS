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
};