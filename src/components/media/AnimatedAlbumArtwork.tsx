import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getWebSocketUrl } from "../../utils/getWebSocketUrl";

type AnimatedAlbumArtworkProps = {
  kind: string | null;
  artist: string | null | undefined;
  album: string | null | undefined;
  artworkUrl: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
};

type AnimatedArtworkResponse = {
  ok?: boolean;
  found?: boolean;
  url?: string | null;
};

type HlsInstance = {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  destroy: () => void;
  on: (
    event: string,
    callback: (_event: string, data: unknown) => void,
  ) => void;
};

type HlsConstructor = {
  new (): HlsInstance;
  isSupported: () => boolean;
  Events: {
    MANIFEST_PARSED: string;
    ERROR: string;
  };
};

const animatedArtworkCache = new Map<string, string | null>();
const animatedArtworkPending = new Map<string, Promise<string | null>>();
let hlsScriptPromise: Promise<HlsConstructor> | null = null;

function getApiBaseUrl() {
  const url = new URL(getWebSocketUrl());
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getLookupKey(
  kind: string | null,
  artist: string | null | undefined,
  album: string | null | undefined,
) {
  if (kind !== "track" || !artist?.trim() || !album?.trim()) {
    return null;
  }

  return `${normalizeKeyPart(artist)}::${normalizeKeyPart(album)}`;
}

function getWindowHls() {
  return (window as Window & { Hls?: HlsConstructor }).Hls;
}

function loadHlsJs(): Promise<HlsConstructor> {
  const existingHls = getWindowHls();

  if (existingHls) {
    return Promise.resolve(existingHls);
  }

  if (hlsScriptPromise) {
    return hlsScriptPromise;
  }

  hlsScriptPromise = new Promise<HlsConstructor>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-smart-mirror-hls="true"]',
    );

    const resolveLoadedScript = () => {
      const Hls = getWindowHls();

      if (Hls) {
        resolve(Hls);
      } else {
        reject(new Error("HLS.js geladen, maar window.Hls ontbreekt."));
      }
    };

    if (existingScript) {
      existingScript.addEventListener("load", resolveLoadedScript, {
        once: true,
      });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("HLS.js script kon niet geladen worden.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
    script.async = true;
    script.dataset.smartMirrorHls = "true";
    script.addEventListener("load", resolveLoadedScript, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("HLS.js script kon niet geladen worden.")),
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    hlsScriptPromise = null;
    throw error;
  });

  return hlsScriptPromise;
}

async function lookupAnimatedArtwork({
  key,
  artist,
  album,
}: {
  key: string;
  artist: string;
  album: string;
}) {
  if (animatedArtworkCache.has(key)) {
    return animatedArtworkCache.get(key) ?? null;
  }

  const pendingRequest = animatedArtworkPending.get(key);

  if (pendingRequest) {
    return pendingRequest;
  }

  const request = (async () => {
    const query = new URLSearchParams({
      artist: artist.trim(),
      album: album.trim(),
    });


    const response = await fetch(
      `${getApiBaseUrl()}/media/animated-artwork?${query.toString()}`,
      { cache: "no-store" },
    );

    const payload = (await response.json()) as AnimatedArtworkResponse;

    if (!response.ok || payload.ok === false) {
      throw new Error("Animated artwork lookup mislukt.");
    }

    const url =
      payload.found === true && typeof payload.url === "string"
        ? payload.url
        : null;

    animatedArtworkCache.set(key, url);
    return url;
  })();

  animatedArtworkPending.set(key, request);

  try {
    return await request;
  } finally {
    animatedArtworkPending.delete(key);
  }
}

export function AnimatedAlbumArtwork({
  kind,
  artist,
  album,
  artworkUrl,
  alt,
  className,
  style,
}: AnimatedAlbumArtworkProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lookupKey = getLookupKey(kind, artist, album);
  const [resolvedArtwork, setResolvedArtwork] = useState<{
    key: string;
    url: string | null;
  } | null>(null);
  const [failedPlaybackUrl, setFailedPlaybackUrl] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!lookupKey || !artist?.trim() || !album?.trim()) {
      return;
    }

    let cancelled = false;

    void lookupAnimatedArtwork({
      key: lookupKey,
      artist,
      album,
    })
      .then((url) => {
        if (!cancelled) {
          setResolvedArtwork({ key: lookupKey, url });
        }
      })
      .catch(() => {
        // Provider/network failures must never replace or break static artwork.
        if (!cancelled) {
          setResolvedArtwork({ key: lookupKey, url: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lookupKey, artist, album]);

  const cachedUrl =
    lookupKey && animatedArtworkCache.has(lookupKey)
      ? animatedArtworkCache.get(lookupKey) ?? null
      : null;
  const resolvedUrl =
    lookupKey && resolvedArtwork?.key === lookupKey
      ? resolvedArtwork.url
      : cachedUrl;
  const animatedUrl =
    resolvedUrl && failedPlaybackUrl !== resolvedUrl ? resolvedUrl : null;

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !animatedUrl) {
      return;
    }

    let cancelled = false;
    let hls: HlsInstance | null = null;

    const failPlayback = () => {
      if (!cancelled) {
        setFailedPlaybackUrl(animatedUrl);
      }
    };

    const handleVideoError = () => {
      console.error("[animated-artwork:video-error]", video.error);
      failPlayback();
    };

    video.addEventListener("error", handleVideoError);

    void loadHlsJs()
      .then((Hls) => {
        if (cancelled) {
          return;
        }

        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(animatedUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.muted = true;
            void video.play().catch(failPlayback);
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            const isFatal =
              typeof data === "object" &&
              data !== null &&
              "fatal" in data &&
              (data as { fatal?: unknown }).fatal === true;

            if (isFatal) {
              console.error("[animated-artwork:hls-fatal]", data);
              failPlayback();
            }
          });

          return;
        }

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = animatedUrl;
          video.muted = true;
          void video.play().catch(failPlayback);
          return;
        }

        failPlayback();
      })
      .catch(failPlayback);

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeEventListener("error", handleVideoError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [animatedUrl]);

  if (!animatedUrl) {
    return (
      <img
        src={artworkUrl}
        alt={alt}
        className={className}
        style={style}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      className={className}
      style={style}
      poster={artworkUrl}
      aria-label={alt}
      autoPlay
      muted
      loop
      playsInline
    />
  );
}
