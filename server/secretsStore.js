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
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(nextSecrets, null, 2), "utf-8");
  } catch (error) {
    console.error("failed to write secrets file", error);
  }
}

function getSpotifySecrets() {
  const fileSecrets = readSecretsFile();
  const spotify = fileSecrets.spotify ?? {};

  return {
    clientId: spotify.clientId ?? process.env.SPOTIFY_CLIENT_ID ?? null,
    clientSecret: spotify.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET ?? null,
    refreshToken: spotify.refreshToken ?? process.env.SPOTIFY_REFRESH_TOKEN ?? null,
    redirectUri:
      spotify.redirectUri ??
      process.env.SPOTIFY_REDIRECT_URI ??
      "http://127.0.0.1:8787/auth/spotify/callback",
  };
}

function saveSpotifySecrets(partialSpotifySecrets) {
  const currentSecrets = readSecretsFile();
  const currentSpotify = currentSecrets.spotify ?? {};

  const nextSpotify = {
    ...currentSpotify,
    ...Object.fromEntries(
      Object.entries(partialSpotifySecrets).filter(
        ([, value]) => typeof value === "string" && value.length > 0,
      ),
    ),
  };

  const nextSecrets = {
    ...currentSecrets,
    spotify: nextSpotify,
  };

  writeSecretsFile(nextSecrets);

  return nextSecrets.spotify;
}

function getRedactedSpotifySecrets() {
  const spotify = getSpotifySecrets();

  return {
    hasClientId: Boolean(spotify.clientId),
    hasClientSecret: Boolean(spotify.clientSecret),
    hasRefreshToken: Boolean(spotify.refreshToken),
    redirectUri: spotify.redirectUri,
  };
}

module.exports = {
  SECRETS_FILE,
  getSpotifySecrets,
  saveSpotifySecrets,
  getRedactedSpotifySecrets,
};