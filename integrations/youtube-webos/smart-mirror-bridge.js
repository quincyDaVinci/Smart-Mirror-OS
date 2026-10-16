const SMART_MIRROR_YOUTUBE_ENDPOINT =
  "http://192.168.68.123:8787/media/youtube-heartbeat";
const SMART_MIRROR_HEARTBEAT_INTERVAL_MS = 5000;

let boundVideo = null;
let lastKnownVideoId = null;

function getYouTubeVideoId() {
  const match = String(window.location.href).match(
    /[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/,
  );

  return match ? match[1] : null;
}

function getHeartbeatPayload() {
  const videoId = getYouTubeVideoId();

  if (videoId) {
    lastKnownVideoId = videoId;
  }

  const effectiveVideoId = videoId || lastKnownVideoId;

  if (!effectiveVideoId) {
    return null;
  }

  const video = document.querySelector("video");
  const visible = document.visibilityState === "visible";
  const onWatchPage = Boolean(videoId);

  let status = "idle";

  if (onWatchPage && video && !video.ended) {
    status = video.paused ? "paused" : "playing";
  } else if (onWatchPage && video && video.ended) {
    status = "ended";
  }

  return {
    videoId: effectiveVideoId,
    status,
    progressMs:
      video && Number.isFinite(video.currentTime)
        ? Math.max(0, Math.round(video.currentTime * 1000))
        : null,
    durationMs:
      video && Number.isFinite(video.duration)
        ? Math.max(0, Math.round(video.duration * 1000))
        : null,
    visible,
  };
}

function sendSmartMirrorHeartbeat() {
  const payload = getHeartbeatPayload();

  if (!payload) {
    return;
  }

  fetch(SMART_MIRROR_YOUTUBE_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Smart Mirror being offline must never interfere with YouTube playback.
  });
}

function unbindVideo() {
  if (!boundVideo) {
    return;
  }

  boundVideo.removeEventListener("playing", sendSmartMirrorHeartbeat);
  boundVideo.removeEventListener("pause", sendSmartMirrorHeartbeat);
  boundVideo.removeEventListener("seeked", sendSmartMirrorHeartbeat);
  boundVideo.removeEventListener("ended", sendSmartMirrorHeartbeat);
  boundVideo.removeEventListener("loadedmetadata", sendSmartMirrorHeartbeat);
  boundVideo.removeEventListener("durationchange", sendSmartMirrorHeartbeat);
  boundVideo = null;
}

function bindCurrentVideo() {
  const video = document.querySelector("video");

  if (video === boundVideo) {
    return;
  }

  unbindVideo();

  if (!video) {
    return;
  }

  boundVideo = video;
  boundVideo.addEventListener("playing", sendSmartMirrorHeartbeat);
  boundVideo.addEventListener("pause", sendSmartMirrorHeartbeat);
  boundVideo.addEventListener("seeked", sendSmartMirrorHeartbeat);
  boundVideo.addEventListener("ended", sendSmartMirrorHeartbeat);
  boundVideo.addEventListener("loadedmetadata", sendSmartMirrorHeartbeat);
  boundVideo.addEventListener("durationchange", sendSmartMirrorHeartbeat);
  sendSmartMirrorHeartbeat();
}

document.addEventListener("visibilitychange", sendSmartMirrorHeartbeat);
window.addEventListener("hashchange", () => {
  bindCurrentVideo();
  sendSmartMirrorHeartbeat();
});

setInterval(bindCurrentVideo, 1000);
setInterval(sendSmartMirrorHeartbeat, SMART_MIRROR_HEARTBEAT_INTERVAL_MS);

bindCurrentVideo();
sendSmartMirrorHeartbeat();
