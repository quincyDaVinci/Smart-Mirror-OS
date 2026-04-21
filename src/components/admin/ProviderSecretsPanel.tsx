import { useState } from "react";
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

function StatusLine({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span>{label}</span>
      <strong style={{ color: active ? "#b8ffb8" : "#ffb3b3" }}>
        {active ? "aanwezig" : "ontbreekt"}
      </strong>
    </div>
  );
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

  const [isSavingJellyfin, setIsSavingJellyfin] = useState(false);
  const [isSavingSpotify, setIsSavingSpotify] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spotifyRedirectUri = `${apiBaseUrl}/auth/spotify/callback`;
  const canStartSpotifyLink =
    configStatus.spotify.hasClientId && configStatus.spotify.hasClientSecret;

  async function handleRefresh() {
    setError(null);
    setMessage(null);
    setIsRefreshing(true);

    try {
      await onRefreshStatus();
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
          redirectUri: spotifyRedirectUri,
        },
      });

      setSpotifyClientId("");
      setSpotifyClientSecret("");
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

  return (
    <section className="admin-card" style={{ maxWidth: 760 }}>
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
        Je kunt hier waarden toevoegen of overschrijven. Bestaande secrets worden
        nooit teruggestuurd naar de browser. Laat een veld leeg om de huidige
        opgeslagen waarde te behouden.
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
              href={canStartSpotifyLink ? `${apiBaseUrl}/auth/spotify/login` : "#"}
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
                readOnly
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 6,
                  opacity: 0.72,
                  cursor: "not-allowed",
                }}
              />
            </label>
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
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
    </section>
  );
}