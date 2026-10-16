const SMART_MIRROR_YOUTUBE_ENDPOINT =
  'http://192.168.68.123:8787/media/youtube-heartbeat';
const SMART_MIRROR_HEARTBEAT_INTERVAL_MS = 5000;
const SMART_MIRROR_EVENT_HEARTBEAT_MIN_INTERVAL_MS = 1500;

let boundVideo = null;
let lastKnownVideoId = null;
let lastHeartbeatSentAt = 0;

function isValidYouTubeVideoId(value) {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value);
}

function getYouTubeVideoId() {
  const hrefMatch = String(window.location.href).match(
    /[?&]v=([\w-]{11})(?:[&#]|$)/,
  );

  if (hrefMatch) {
    return hrefMatch[1];
  }

  const sponsorBlockVideoId =
    window.sponsorblock && window.sponsorblock.videoID;

  return isValidYouTubeVideoId(sponsorBlockVideoId)
    ? sponsorBlockVideoId
    : null;
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

  const video = document.querySelector('video');
  const visible = document.visibilityState === 'visible';
  const onWatchPage = Boolean(videoId);

  let status = 'idle';

  if (onWatchPage && video && !video.ended) {
    status = video.paused ? 'paused' : 'playing';
  } else if (onWatchPage && video && video.ended) {
    status = 'ended';
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

function sendSmartMirrorHeartbeat(force = false) {
  const now = Date.now();

  if (
    !force &&
    now - lastHeartbeatSentAt < SMART_MIRROR_EVENT_HEARTBEAT_MIN_INTERVAL_MS
  ) {
    return;
  }

  const payload = getHeartbeatPayload();

  if (!payload) {
    return;
  }

  lastHeartbeatSentAt = now;

  fetch(SMART_MIRROR_YOUTUBE_ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    cache: 'no-store',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Smart Mirror being offline must never interfere with YouTube playback.
  });
}

function sendForcedHeartbeat() {
  sendSmartMirrorHeartbeat(true);
}

function sendPlaybackHeartbeat() {
  sendSmartMirrorHeartbeat(false);
}

function unbindVideo() {
  if (!boundVideo) {
    return;
  }

  boundVideo.removeEventListener('play', sendForcedHeartbeat);
  boundVideo.removeEventListener('playing', sendForcedHeartbeat);
  boundVideo.removeEventListener('pause', sendForcedHeartbeat);
  boundVideo.removeEventListener('seeked', sendForcedHeartbeat);
  boundVideo.removeEventListener('ended', sendForcedHeartbeat);
  boundVideo.removeEventListener('emptied', sendForcedHeartbeat);
  boundVideo.removeEventListener('loadedmetadata', sendForcedHeartbeat);
  boundVideo.removeEventListener('durationchange', sendForcedHeartbeat);
  boundVideo.removeEventListener('timeupdate', sendPlaybackHeartbeat);
  boundVideo = null;
}

function bindCurrentVideo() {
  const video = document.querySelector('video');

  if (video === boundVideo) {
    return;
  }

  unbindVideo();

  if (!video) {
    return;
  }

  boundVideo = video;
  boundVideo.addEventListener('play', sendForcedHeartbeat);
  boundVideo.addEventListener('playing', sendForcedHeartbeat);
  boundVideo.addEventListener('pause', sendForcedHeartbeat);
  boundVideo.addEventListener('seeked', sendForcedHeartbeat);
  boundVideo.addEventListener('ended', sendForcedHeartbeat);
  boundVideo.addEventListener('emptied', sendForcedHeartbeat);
  boundVideo.addEventListener('loadedmetadata', sendForcedHeartbeat);
  boundVideo.addEventListener('durationchange', sendForcedHeartbeat);
  boundVideo.addEventListener('timeupdate', sendPlaybackHeartbeat);
  sendForcedHeartbeat();
}

document.addEventListener('visibilitychange', sendForcedHeartbeat);

window.addEventListener('hashchange', () => {
  bindCurrentVideo();
  sendForcedHeartbeat();
});

const videoObserver = new MutationObserver(() => {
  if (
    !boundVideo ||
    !document.documentElement.contains(boundVideo)
  ) {
    bindCurrentVideo();
  }
});

videoObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Fallback only. Normal playback heartbeats are driven by video events so
// webOS timer throttling during YouTube navigation cannot create long gaps.
setInterval(bindCurrentVideo, 1000);
setInterval(sendForcedHeartbeat, SMART_MIRROR_HEARTBEAT_INTERVAL_MS);

bindCurrentVideo();
sendForcedHeartbeat();
