import { useEffect, useState } from "react";
import type {
  ProviderConfigStatus,
  ProviderSecretsInput,
} from "../../types/providerConfig";

type ProviderSecretsPanelProps = {
  configStatus: ProviderConfigStatus;
  apiBaseUrl: string;
  onRefreshStatus: () => Promise<void>;
  onSaveSecrets: (nextSecrets: ProviderSecretsInput) => Promise<void>;
};

type EditableProviderConfig = {
  weather: {
    locationQuery: string;
    countryCode: string;
    latitude: string;
    longitude: string;
  };
  calendar: {
    feedUrlsText: string;
  };
};

function StatusLine({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span>{label}</span>
      <strong style={{ color: active ? "#b8ffb8" : "#ffb3b3" }}>
        {active ? "aanwezig" : "ontbreekt"}
      </strong>
    </div>
  );
}

async function fetchEditableProviderConfig(
  apiBaseUrl: string,
): Promise<EditableProviderConfig> {
  const response = await fetch(`${apiBaseUrl}/config/providers/editable`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (
    !payload ||
    typeof payload !== "object" ||
    !("editable" in payload) ||
    !payload.editable ||
    typeof payload.editable !== "object"
  ) {
    throw new Error(
      "Editable provider config antwoord heeft ongeldig formaat.",
    );
  }

  const editable = payload.editable as EditableProviderConfig;

  return {
    weather: {
      locationQuery: editable.weather?.locationQuery ?? "",
      countryCode: editable.weather?.countryCode ?? "",
      latitude: editable.weather?.latitude ?? "",
      longitude: editable.weather?.longitude ?? "",
    },
    calendar: {
      feedUrlsText: editable.calendar?.feedUrlsText ?? "",
    },
  };
}

export function ProviderSecretsPanel({
  configStatus,
  apiBaseUrl,
  onRefreshStatus,
  onSaveSecrets,
}: ProviderSecretsPanelProps) {
  const [jellyfinBaseUrl, setJellyfinBaseUrl] = useState("");
  const [jellyfinApiKey, setJellyfinApiKey] = useState("");
  const [jellyfinUserName, setJellyfinUserName] = useState("");
  const [jellyfinDeviceName, setJellyfinDeviceName] = useState("");

  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyClientSecret, setSpotifyClientSecret] = useState("");
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState("");

  const [isSavingJellyfin, setIsSavingJellyfin] = useState(false);
  const [isSavingSpotify, setIsSavingSpotify] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [weatherLocationQuery, setWeatherLocationQuery] = useState("");
  const [weatherCountryCode, setWeatherCountryCode] = useState("");
  const [weatherLatitude, setWeatherLatitude] = useState("");
  const [weatherLongitude, setWeatherLongitude] = useState("");

  const [calendarFeedUrlsText, setCalendarFeedUrlsText] = useState("");

  const [isSavingWeather, setIsSavingWeather] = useState(false);
  const [isSavingCalendar, setIsSavingCalendar] = useState(false);

  const effectiveSpotifyRedirectUri =
    spotifyRedirectUri.trim() || "http://127.0.0.1:8787/auth/spotify/callback";
  const canStartSpotifyLink =
    configStatus.spotify.hasClientId && configStatus.spotify.hasClientSecret;

  async function loadEditableConfig() {
    const editable = await fetchEditableProviderConfig(apiBaseUrl);

    setWeatherLocationQuery(editable.weather.locationQuery);
    setWeatherCountryCode(editable.weather.countryCode);
    setWeatherLatitude(editable.weather.latitude);
    setWeatherLongitude(editable.weather.longitude);
    setCalendarFeedUrlsText(editable.calendar.feedUrlsText);
  }

  useEffect(() => {
    void loadEditableConfig().catch((loadError) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Editable provider config laden mislukt.",
      );
    });
  }, []);

  async function handleRefresh() {
    setError(null);
    setMessage(null);
    setIsRefreshing(true);

    try {
      await onRefreshStatus();
      await loadEditableConfig();
      setMessage("Provider status vernieuwd.");
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Provider status verversen mislukt.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleSaveJellyfin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSavingJellyfin(true);

    try {
      await onSaveSecrets({
        jellyfin: {
          baseUrl: jellyfinBaseUrl,
          apiKey: jellyfinApiKey,
          userName: jellyfinUserName,
          deviceName: jellyfinDeviceName,
        },
      });

      setJellyfinBaseUrl("");
      setJellyfinApiKey("");
      setJellyfinUserName("");
      setJellyfinDeviceName("");
      setMessage("Jellyfin configuratie opgeslagen.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Jellyfin configuratie opslaan mislukt.",
      );
    } finally {
      setIsSavingJellyfin(false);
    }
  }

  async function handleSaveSpotify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSavingSpotify(true);

    try {
      await onSaveSecrets({
        spotify: {
          clientId: spotifyClientId,
          clientSecret: spotifyClientSecret,
          redirectUri: effectiveSpotifyRedirectUri,
        },
      });

      setSpotifyClientId("");
      setSpotifyClientSecret("");
      setSpotifyRedirectUri("");
      setMessage("Spotify app-config opgeslagen. Je kunt nu koppelen.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Spotify configuratie opslaan mislukt.",
      );
    } finally {
      setIsSavingSpotify(false);
    }
  }

  async function handleSaveWeather(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSavingWeather(true);

    try {
      await onSaveSecrets({
        weather: {
          locationQuery: weatherLocationQuery,
          countryCode: weatherCountryCode,
          latitude: weatherLatitude,
          longitude: weatherLongitude,
        },
      });

      await loadEditableConfig();
      setMessage("Weather configuratie opgeslagen.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Weather configuratie opslaan mislukt.",
      );
    } finally {
      setIsSavingWeather(false);
    }
  }

  async function handleSaveCalendar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSavingCalendar(true);

    try {
      await onSaveSecrets({
        calendar: {
          feedUrlsText: calendarFeedUrlsText,
        },
      });

      await loadEditableConfig();
      setMessage("Calendar feed configuratie opgeslagen.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Calendar configuratie opslaan mislukt.",
      );
    } finally {
      setIsSavingCalendar(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <h2 style={{ margin: 0 }}>Provider secrets</h2>

        <button type="button" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Verversen..." : "Ververs status"}
        </button>
      </div>

      <p style={{ opacity: 0.78 }}>
        Je kunt hier waarden toevoegen of overschrijven. Bestaande secrets
        worden nooit teruggestuurd naar de browser. Laat een veld leeg om de
        huidige opgeslagen waarde te behouden.
      </p>

      {message ? <p style={{ color: "#b8ffb8" }}>{message}</p> : null}
      {error ? <p style={{ color: "#ffb3b3" }}>{error}</p> : null}

      <div style={{ display: "grid", gap: 20 }}>
        <form
          onSubmit={handleSaveJellyfin}
          style={{
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Jellyfin</h3>

          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            <StatusLine
              label="Base URL"
              active={configStatus.jellyfin.hasBaseUrl}
            />
            <StatusLine
              label="API key"
              active={configStatus.jellyfin.hasApiKey}
            />
            <StatusLine
              label="Preferred user"
              active={configStatus.jellyfin.hasUserName}
            />
            <StatusLine
              label="Preferred device"
              active={configStatus.jellyfin.hasDeviceName}
            />
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <label>
              Base URL
              <input
                type="text"
                value={jellyfinBaseUrl}
                onChange={(event) => setJellyfinBaseUrl(event.target.value)}
                placeholder="http://192.168.x.x:8096/"
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              API key
              <input
                type="password"
                value={jellyfinApiKey}
                onChange={(event) => setJellyfinApiKey(event.target.value)}
                placeholder="Laat leeg om huidige waarde te behouden"
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              Preferred user
              <input
                type="text"
                value={jellyfinUserName}
                onChange={(event) => setJellyfinUserName(event.target.value)}
                placeholder="Bijvoorbeeld admin"
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              Preferred device
              <input
                type="text"
                value={jellyfinDeviceName}
                onChange={(event) => setJellyfinDeviceName(event.target.value)}
                placeholder="Bijvoorbeeld LG_C9_Quincy"
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={isSavingJellyfin}>
              {isSavingJellyfin ? "Opslaan..." : "Sla Jellyfin op"}
            </button>
          </div>
        </form>

        <form
          onSubmit={handleSaveSpotify}
          style={{
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0 }}>Spotify</h3>

            <a
              href={
                canStartSpotifyLink ? `${apiBaseUrl}/auth/spotify/login` : "#"
              }
              target={canStartSpotifyLink ? "_blank" : undefined}
              rel={canStartSpotifyLink ? "noreferrer" : undefined}
              className="admin-link"
              style={{
                padding: "8px 12px",
                opacity: canStartSpotifyLink ? 1 : 0.45,
                pointerEvents: canStartSpotifyLink ? "auto" : "none",
              }}
              aria-disabled={!canStartSpotifyLink}
            >
              Koppel Spotify
            </a>
          </div>

          <div style={{ display: "grid", gap: 8, margin: "16px 0" }}>
            <StatusLine
              label="Client ID"
              active={configStatus.spotify.hasClientId}
            />
            <StatusLine
              label="Client secret"
              active={configStatus.spotify.hasClientSecret}
            />
            <StatusLine
              label="Refresh token"
              active={configStatus.spotify.hasRefreshToken}
            />
            <StatusLine
              label="Redirect URI"
              active={configStatus.spotify.hasRedirectUri}
            />
          </div>

          <p style={{ opacity: 0.8, marginTop: 0 }}>
            Hier sla je alleen de Spotify app-config op. De refresh token wordt
            automatisch opgehaald via <strong>Koppel Spotify</strong>.
          </p>

          <div style={{ display: "grid", gap: 12 }}>
            <label>
              Client ID
              <input
                type="text"
                value={spotifyClientId}
                onChange={(event) => setSpotifyClientId(event.target.value)}
                placeholder="Laat leeg om huidige waarde te behouden"
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              Client secret
              <input
                type="password"
                value={spotifyClientSecret}
                onChange={(event) => setSpotifyClientSecret(event.target.value)}
                placeholder="Laat leeg om huidige waarde te behouden"
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>

            <label>
              Callback URL
              <input
                type="text"
                value={spotifyRedirectUri}
                onChange={(event) => setSpotifyRedirectUri(event.target.value)}
                placeholder="http://127.0.0.1:8787/auth/spotify/callback"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 6,
                }}
              />
              <p style={{ margin: "6px 0 0", opacity: 0.72, fontSize: 14 }}>
                Gebruik{" "}
                <strong>http://127.0.0.1:8787/auth/spotify/callback</strong> als
                je de koppeling uitvoert op dezelfde machine als de backend.
                Gebruik voor remote koppelen alleen een{" "}
                <strong>https://</strong> callback URL.
              </p>
            </label>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <button type="submit" disabled={isSavingSpotify}>
              {isSavingSpotify ? "Opslaan..." : "Sla Spotify app-config op"}
            </button>

            {!canStartSpotifyLink ? (
              <span style={{ opacity: 0.72, alignSelf: "center" }}>
                Sla eerst client ID en client secret op.
              </span>
            ) : null}
          </div>
        </form>
      </div>
      <form
        onSubmit={handleSaveWeather}
        style={{
          padding: 16,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Weather</h3>

        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          <StatusLine
            label="Location query"
            active={configStatus.weather.hasLocationQuery}
          />
          <StatusLine
            label="Country code"
            active={configStatus.weather.hasCountryCode}
          />
          <StatusLine
            label="Latitude"
            active={configStatus.weather.hasLatitude}
          />
          <StatusLine
            label="Longitude"
            active={configStatus.weather.hasLongitude}
          />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label>
            Location query
            <input
              type="text"
              value={weatherLocationQuery}
              onChange={(event) => setWeatherLocationQuery(event.target.value)}
              placeholder="Bijvoorbeeld Den Haag"
              style={{ display: "block", width: "100%", marginTop: 6 }}
            />
          </label>

          <label>
            Country code
            <input
              type="text"
              value={weatherCountryCode}
              onChange={(event) => setWeatherCountryCode(event.target.value)}
              placeholder="Bijvoorbeeld NL"
              style={{ display: "block", width: "100%", marginTop: 6 }}
            />
          </label>

          <label>
            Latitude
            <input
              type="text"
              value={weatherLatitude}
              onChange={(event) => setWeatherLatitude(event.target.value)}
              placeholder="Bijvoorbeeld 52.08"
              style={{ display: "block", width: "100%", marginTop: 6 }}
            />
          </label>

          <label>
            Longitude
            <input
              type="text"
              value={weatherLongitude}
              onChange={(event) => setWeatherLongitude(event.target.value)}
              placeholder="Bijvoorbeeld 4.31"
              style={{ display: "block", width: "100%", marginTop: 6 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={isSavingWeather}>
            {isSavingWeather ? "Opslaan..." : "Sla Weather op"}
          </button>
        </div>
      </form>

      <form
        onSubmit={handleSaveCalendar}
        style={{
          padding: 16,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Calendar feeds</h3>

        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          <StatusLine
            label="ICS feed URLs"
            active={configStatus.calendar.hasFeedUrls}
          />
        </div>

        <label>
          Feed URLs
          <textarea
            value={calendarFeedUrlsText}
            onChange={(event) => setCalendarFeedUrlsText(event.target.value)}
            placeholder={
              "Één ICS URL per regel\nhttps://...\nhttps://...\nhttps://..."
            }
            rows={6}
            style={{ display: "block", width: "100%", marginTop: 6 }}
          />
        </label>

        <p style={{ margin: "8px 0 0", opacity: 0.72, fontSize: 14 }}>
          Plak hier iCloud, Google, Outlook of Quinyx ICS feed URLs. Gebruik één
          feed per regel.
        </p>

        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={isSavingCalendar}>
            {isSavingCalendar ? "Opslaan..." : "Sla Calendar feeds op"}
          </button>
        </div>
      </form>
    </>
  );
}
