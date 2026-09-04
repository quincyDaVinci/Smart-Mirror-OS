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
  maxResolutionPx?: number;
  alt: string;
  className?: string;
  style?: CSSProperties;
};

type AnimatedArtworkResponse = {
  ok?: boolean;
  found?: boolean;
  url?: string | null;
};

type HlsLevel = {
  width?: number;
  height?: number;
  bitrate?: number;
  videoCodec?: string;
  codecSet?: string;
};

type HlsManifestParsedData = {
  levels?: HlsLevel[];
};

type HlsInstance = {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  destroy: () => void;
  autoLevelCapping: number;
  nextLoadLevel: number;
  on: (
    event: string,
    callback: (_event: string, data: unknown) => void,
  ) => void;
};

type HlsConstructor = {
  new (config?: Record<string, unknown>): HlsInstance;
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

function selectAnimatedArtworkLevel(
  levels: HlsLevel[],
  video: HTMLVideoElement,
  maxResolutionPx: number,
) {
  if (levels.length === 0) {
    return null;
  }

  const safeMaxResolutionPx = Number.isFinite(maxResolutionPx)
    ? Math.max(360, maxResolutionPx)
    : 640;
  const targetDimension =
    video.clientWidth <= 200
      ? Math.min(360, safeMaxResolutionPx)
      : safeMaxResolutionPx;
  const indexedLevels = levels.map((level, index) => ({
    level,
    index,
    dimension: Math.max(level.width ?? 0, level.height ?? 0),
    codec: `${level.videoCodec ?? ""} ${level.codecSet ?? ""}`.toLowerCase(),
  }));

  const h264Levels = indexedLevels.filter(({ codec }) =>
    codec.includes("avc1"),
  );
  const candidates = h264Levels.length > 0 ? h264Levels : indexedLevels;

  const withinTarget = candidates.filter(
    ({ dimension }) => dimension > 0 && dimension <= targetDimension,
  );

  if (withinTarget.length > 0) {
    return withinTarget.reduce((best, candidate) => {
      if (candidate.dimension !== best.dimension) {
        return candidate.dimension > best.dimension ? candidate : best;
      }

      return (candidate.level.bitrate ?? 0) > (best.level.bitrate ?? 0)
        ? candidate
        : best;
    }).index;
  }

  return candidates.reduce((best, candidate) => {
    const bestDimension =
      best.dimension > 0 ? best.dimension : Number.POSITIVE_INFINITY;
    const candidateDimension =
      candidate.dimension > 0
        ? candidate.dimension
        : Number.POSITIVE_INFINITY;

    if (candidateDimension !== bestDimension) {
      return candidateDimension < bestDimension ? candidate : best;
    }

    return (candidate.level.bitrate ?? Number.POSITIVE_INFINITY) <
      (best.level.bitrate ?? Number.POSITIVE_INFINITY)
      ? candidate
      : best;
  }).index;
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
  maxResolutionPx = 640,
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
          hls = new Hls({
            startLevel: 0,
            capLevelToPlayerSize: true,
            capLevelOnFPSDrop: true,
            fpsDroppedMonitoringPeriod: 2000,
            fpsDroppedMonitoringThreshold: 0.1,
          });
          hls.loadSource(animatedUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            const levels =
              typeof data === "object" &&
              data !== null &&
              "levels" in data &&
              Array.isArray((data as HlsManifestParsedData).levels)
                ? ((data as HlsManifestParsedData).levels ?? [])
                : [];
            const selectedLevel = selectAnimatedArtworkLevel(
              levels,
              video,
              maxResolutionPx,
            );

            if (selectedLevel !== null) {
              hls!.autoLevelCapping = selectedLevel;
              hls!.nextLoadLevel = selectedLevel;

              const selected = levels[selectedLevel];
              console.info("[animated-artwork:quality]", {
                width: selected?.width ?? null,
                height: selected?.height ?? null,
                bitrate: selected?.bitrate ?? null,
                codec: selected?.videoCodec ?? selected?.codecSet ?? null,
                maxResolutionPx,
              });
            }

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
  }, [animatedUrl, maxResolutionPx]);

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
