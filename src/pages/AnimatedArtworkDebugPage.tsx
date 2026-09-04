import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaState } from "../types/media";
import "./AnimatedArtworkDebugPage.css";

type AnimatedArtworkDebugPageProps = {
  media: MediaState;
  apiBaseUrl: string;
};

type DebugResponse = {
  ok?: boolean;
  upstreamStatus?: number;
  httpStatus?: number;
  contentType?: string;
  query?: {
    artist?: string;
    album?: string;
    title?: string;
  };
  data?: unknown;
  rawResponse?: string;
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

type HlsInstance = {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  destroy: () => void;
  on: (event: string, callback: (_event: string, data: unknown) => void) => void;
};

type HlsConstructor = {
  new (): HlsInstance;
  isSupported: () => boolean;
  Events: {
    MANIFEST_PARSED: string;
    ERROR: string;
  };
};

declare global {
  interface Window {
    Hls?: HlsConstructor;
  }
}

function loadHlsJs(): Promise<HlsConstructor> {
  if (window.Hls) {
    return Promise.resolve(window.Hls);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-smart-mirror-hls="true"]',
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.Hls) {
          resolve(window.Hls);
        } else {
          reject(new Error("HLS.js script geladen, maar window.Hls ontbreekt."));
        }
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("HLS.js script kon niet geladen worden."));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
    script.async = true;
    script.dataset.smartMirrorHls = "true";

    script.addEventListener("load", () => {
      if (window.Hls) {
        resolve(window.Hls);
      } else {
        reject(new Error("HLS.js script geladen, maar window.Hls ontbreekt."));
      }
    });
    script.addEventListener("error", () => {
      reject(new Error("HLS.js script kon niet geladen worden."));
    });

    document.head.appendChild(script);
  });
}

function HlsPreview({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState("HLS initialiseren...");

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    let hls: HlsInstance | null = null;
    let cancelled = false;

    const nativeHlsSupport =
      video.canPlayType("application/vnd.apple.mpegurl") !== "";

    const handlePlaying = () => {
      setStatus(hls ? "HLS.js speelt" : "Native HLS speelt");
    };
    const handleLoadedData = () => {
      setStatus(hls ? "HLS.js video geladen" : "Native HLS video geladen");
    };
    const handleMediaError = () => {
      console.error("[animated-artwork:video-error]", video.error);
      setStatus("Video-element playback error — zie browserconsole.");
    };

    video.addEventListener("playing", handlePlaying);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("error", handleMediaError);

    void loadHlsJs()
      .then((Hls) => {
        if (cancelled) {
          return;
        }

        if (Hls.isSupported()) {
          setStatus("HLS.js initialiseren...");
          hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setStatus("HLS.js manifest geladen");
            video.muted = true;
            void video.play().catch(() => {
              setStatus("HLS.js geladen; klik op Play.");
            });
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            console.error("[animated-artwork:hls]", data);
            setStatus("HLS.js playback error — zie browserconsole.");
          });

          return;
        }

        if (nativeHlsSupport) {
          setStatus("HLS.js niet ondersteund; native HLS fallback.");
          video.src = url;
          video.muted = true;
          void video.play().catch(() => {
            setStatus("Native HLS geladen; klik op Play.");
          });
          return;
        }

        setStatus("Browser ondersteunt HLS.js noch native HLS.");
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "HLS.js laden mislukt.",
          );
        }
      });

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleMediaError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);

  return (
    <div>
      <p className="animated-artwork-debug__playback-status">{status}</p>
      <video
        ref={videoRef}
        className="animated-artwork-debug__video"
        autoPlay
        muted
        loop
        controls
        playsInline
      />
    </div>
  );
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

  const squareHlsUrl =
    result?.data &&
    typeof result.data === "object" &&
    "url" in result.data &&
    typeof (result.data as { url?: unknown }).url === "string"
      ? (result.data as { url: string }).url
      : null;
  const hlsUrl =
    squareHlsUrl ??
    urls.find((url) => /\.m3u8(?:$|\?)/i.test(url)) ??
    null;
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
      const rawResponse = await response.text();
      const contentType = response.headers.get("content-type") ?? "";

      let payload: DebugResponse;

      try {
        payload = JSON.parse(rawResponse) as DebugResponse;
      } catch {
        payload = {
          ok: false,
          httpStatus: response.status,
          contentType,
          rawResponse,
          error:
            "Backend gaf geen JSON terug. Controleer of de nieuwste backend draait.",
        };
      }

      setResult({
        ...payload,
        httpStatus: response.status,
        contentType,
      });
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

          <button
            type="button"
            onClick={() => {
              setArtist("Linkin Park");
              setAlbum("Living Things");
              setTitle("");
            }}
          >
            Test: Linkin Park — Living Things
          </button>

          <button
            type="button"
            onClick={() => {
              setArtist("Phoebe Bridgers");
              setAlbum("Punisher");
              setTitle("Kyoto");
            }}
          >
            Test: Phoebe Bridgers — Punisher
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
                <dt>Backend HTTP</dt>
                <dd>{result.httpStatus ?? "-"}</dd>
              </div>
              <div>
                <dt>Content-Type</dt>
                <dd>{result.contentType || "-"}</dd>
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

          {hlsUrl ? (
            <section className="animated-artwork-debug__panel">
              <h2>Square HLS motion preview</h2>
              <HlsPreview url={hlsUrl} />
            </section>
          ) : null}

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
            <h2>Ruwe response</h2>
            <pre>
              {result.rawResponse ?? JSON.stringify(result, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </main>
  );
}
