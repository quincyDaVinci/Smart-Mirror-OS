import { useMemo, useState } from "react";
import type { MediaState } from "../types/media";
import "./AnimatedArtworkDebugPage.css";

type AnimatedArtworkDebugPageProps = {
  media: MediaState;
  apiBaseUrl: string;
};

type DebugResponse = {
  ok?: boolean;
  upstreamStatus?: number;
  query?: {
    artist?: string;
    album?: string;
    title?: string;
  };
  data?: unknown;
  error?: string;
};

function collectUrls(value: unknown, urls = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      urls.add(value);
    }

    return urls;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
    return urls;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectUrls(item, urls));
  }

  return urls;
}

function getUrlKind(url: string) {
  if (/\.m3u8(?:$|\?)/i.test(url)) {
    return "HLS";
  }

  if (/\.mp4(?:$|\?)/i.test(url)) {
    return "MP4";
  }

  if (/\.webp(?:$|\?)/i.test(url)) {
    return "WebP";
  }

  if (/\.(?:jpe?g|png)(?:$|\?)/i.test(url)) {
    return "Image";
  }

  return "URL";
}

export function AnimatedArtworkDebugPage({
  media,
  apiBaseUrl,
}: AnimatedArtworkDebugPageProps) {
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<DebugResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const urls = useMemo(
    () => Array.from(collectUrls(result?.data)).sort(),
    [result],
  );

  const mp4Url = urls.find((url) => /\.mp4(?:$|\?)/i.test(url)) ?? null;

  function fillCurrentSpotifyMedia() {
    if (media.source !== "spotify" || media.kind !== "track") {
      return;
    }

    setArtist(media.subtitle);
    setAlbum(media.secondaryText);
    setTitle(media.title);
  }

  async function runLookup() {
    const query = new URLSearchParams({
      artist: artist.trim(),
      album: album.trim(),
    });

    if (title.trim()) {
      query.set("title", title.trim());
    }

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch(
        `${apiBaseUrl}/debug/apple-motion-artwork?${query.toString()}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as DebugResponse;

      setResult(payload);
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error ? error.message : "Lookup request mislukt.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const canUseCurrentSpotify =
    media.source === "spotify" && media.kind === "track";

  return (
    <main className="animated-artwork-debug">
      <header className="animated-artwork-debug__header">
        <div>
          <p className="animated-artwork-debug__eyebrow">Temporary debug page</p>
          <h1>Apple Music Motion Artwork Test</h1>
          <p>
            Test alleen de lookup. Deze pagina verandert niets aan de echte
            mirrorcover.
          </p>
        </div>

        <a href="/">Terug naar mirror</a>
      </header>

      <section className="animated-artwork-debug__panel">
        <div className="animated-artwork-debug__actions">
          <button
            type="button"
            onClick={fillCurrentSpotifyMedia}
            disabled={!canUseCurrentSpotify}
          >
            Vul huidige Spotify track
          </button>
        </div>

        <label>
          Artist
          <input
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            placeholder="bijv. Gorillaz"
          />
        </label>

        <label>
          Album
          <input
            value={album}
            onChange={(event) => setAlbum(event.target.value)}
            placeholder="bijv. Plastic Beach"
          />
        </label>

        <label>
          Song title (optioneel)
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="bijv. On Melancholy Hill"
          />
        </label>

        <button
          type="button"
          className="animated-artwork-debug__lookup"
          disabled={!artist.trim() || !album.trim() || isLoading}
          onClick={() => void runLookup()}
        >
          {isLoading ? "Zoeken..." : "Zoek motion artwork"}
        </button>
      </section>

      {result ? (
        <>
          <section className="animated-artwork-debug__panel">
            <h2>Resultaat</h2>
            <dl className="animated-artwork-debug__status">
              <div>
                <dt>OK</dt>
                <dd>{String(result.ok === true)}</dd>
              </div>
              <div>
                <dt>Upstream status</dt>
                <dd>{result.upstreamStatus ?? "-"}</dd>
              </div>
              <div>
                <dt>Media URL's gevonden</dt>
                <dd>{urls.length}</dd>
              </div>
            </dl>

            {result.error ? (
              <p className="animated-artwork-debug__error">{result.error}</p>
            ) : null}
          </section>

          {mp4Url ? (
            <section className="animated-artwork-debug__panel">
              <h2>MP4 preview</h2>
              <video
                className="animated-artwork-debug__video"
                src={mp4Url}
                autoPlay
                muted
                loop
                controls
                playsInline
              />
            </section>
          ) : null}

          <section className="animated-artwork-debug__panel">
            <h2>Gevonden URL's</h2>
            {urls.length > 0 ? (
              <ul className="animated-artwork-debug__urls">
                {urls.map((url) => (
                  <li key={url}>
                    <strong>{getUrlKind(url)}</strong>
                    <a href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Geen URL's gevonden in de response.</p>
            )}
          </section>

          <section className="animated-artwork-debug__panel">
            <h2>Ruwe JSON</h2>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </section>
        </>
      ) : null}
    </main>
  );
}
