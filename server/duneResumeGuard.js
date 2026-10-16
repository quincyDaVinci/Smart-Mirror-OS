const { normalizeCheckpointMedia } = require("./duneJellyfinProgress");

const DUNE_RESUME_DIFFERENCE_MS = 4 * 60 * 1000;
const DUNE_RESUME_CONFIRM_PLAYBACK_MS = 3 * 60 * 1000;
const DUNE_RESUME_NOTICE_MS = 15 * 1000;
const SEEK_TOLERANCE_MS = 10 * 1000;
const SEEK_VERIFY_TOLERANCE_MS = 12 * 1000;
const SEEK_VERIFY_DEADLINE_MS = 20 * 1000;
const TRANSIENT_GAP_MS = 15 * 1000;

function getSessionKey(media) {
  return media?.source === "dune" &&
    (media.status === "playing" || media.status === "paused") &&
    typeof media.playSessionId === "string" &&
    media.playSessionId.length > 0
    ? media.playSessionId
    : null;
}

function createDuneResumeGuard({
  readPosition,
  seek,
  writeCheckpoint,
  now = Date.now,
  logger = console,
}) {
  let session = null;
  let queue = Promise.resolve();

  function createSession(key, media) {
    return {
      key,
      itemId: media.sourceItemId ?? null,
      initialized: false,
      approved: false,
      blocked: true,
      confirmRequired: false,
      watchedMs: 0,
      previousProgress: null,
      previousAt: null,
      previousStatus: null,
      trustedPosition: null,
      seekAttempted: false,
      seekTarget: null,
      seekIssuedAt: null,
      missingAt: null,
      notice: null,
    };
  }

  function setNotice(current, status, positionMs = null) {
    current.notice = {
      status,
      positionMs,
      expiresAt: now() + DUNE_RESUME_NOTICE_MS,
    };
  }

  async function writePermittedCheckpoint(checkpoint) {
    if (!session || session.blocked || !session.approved ||
        checkpoint.playSessionId !== session.key ||
        checkpoint.sourceItemId !== session.itemId) {
      return;
    }
    const result = await writeCheckpoint(checkpoint);
    if (result?.ok === true) {
      session.trustedPosition = checkpoint.progressMs;
    }
  }

  async function initialize(current, media) {
    current.itemId = media.sourceItemId ?? null;
    current.initialized = true;

    if (!current.itemId) {
      setNotice(current, "unmatched");
      return;
    }

    try {
      const savedMs = await readPosition(media);
      if (!Number.isFinite(savedMs) || savedMs < 0) {
        setNotice(current, "error");
        logger.warn("[dune-resume] Jellyfin resume lookup unavailable; no writes", {
          itemId: current.itemId,
        });
        return;
      }

      setNotice(current, savedMs > 0 ? "found" : "none", savedMs);
      current.trustedPosition = savedMs;
      const duneMs = Number(media.progressMs);
      if (!Number.isFinite(duneMs) || duneMs < 0) return;

      const difference = Math.abs(savedMs - duneMs);
      current.confirmRequired = difference > DUNE_RESUME_DIFFERENCE_MS;
      current.approved = !current.confirmRequired;
      current.blocked = false;
      current.previousProgress = duneMs;
      current.previousAt = now();
      current.previousStatus = media.status;

      // This is the ONLY automatic seek attempt for this Dune session.
      if (!current.seekAttempted && difference > SEEK_TOLERANCE_MS) {
        current.seekAttempted = true;
        const accepted = await seek(savedMs);
        if (accepted) {
          current.seekTarget = savedMs;
          current.seekIssuedAt = now();
          current.approved = false;
          current.blocked = true;
        } else {
          logger.warn("[dune-resume] Dune seek not accepted; guarding Jellyfin progress", {
            itemId: current.itemId,
          });
        }
      }
    } catch (error) {
      setNotice(current, "error");
      current.blocked = true;
      current.approved = false;
      logger.warn("[dune-resume] Resume check failed; Jellyfin progress protected", {
        itemId: current.itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function observeInternal(media, checkpoints = []) {
    const at = now();
    const key = getSessionKey(media);

    if (!key) {
      // Dune briefly reports no playback during some seeking/OSD transitions.
      // Keep the gate and its one-time seek flag until a distinct session starts.
      if (session) {
        for (const checkpoint of checkpoints) {
          await writePermittedCheckpoint(checkpoint);
        }
        if (session.missingAt === null) session.missingAt = at;
      }
      return;
    }

    const isNewSession = !session || session.key !== key ||
      (session.missingAt !== null && at - session.missingAt > TRANSIENT_GAP_MS);

    if (isNewSession) {
      if (session) {
        for (const checkpoint of checkpoints) {
          await writePermittedCheckpoint(checkpoint);
        }
      }
      session = createSession(key, media);
    } else {
      session.missingAt = null;
    }

    // A Jellyfin match may become available one poll after Dune playback starts.
    if (!session.initialized ||
        (!session.itemId && typeof media.sourceItemId === "string" && media.sourceItemId)) {
      await initialize(session, media);
    }
    if (!session.itemId || session.itemId !== media.sourceItemId) return;

    const position = Number(media.progressMs);
    const observedAt = now();
    if (!Number.isFinite(position) || position < 0) return;

    if (session.seekTarget !== null) {
      const reached = Math.abs(position - session.seekTarget) <= SEEK_VERIFY_TOLERANCE_MS;
      if (!reached && observedAt - session.seekIssuedAt < SEEK_VERIFY_DEADLINE_MS) {
        return;
      }

      if (reached) {
        logger.log("[dune-resume] Jellyfin resume position confirmed", {
          itemId: session.itemId,
        });
      } else {
        logger.warn("[dune-resume] Seek not verified; no further automatic seek", {
          itemId: session.itemId,
        });
      }

      session.seekTarget = null;
      session.seekIssuedAt = null;
      session.blocked = false;
      session.approved = !session.confirmRequired;
      session.watchedMs = 0;
      session.previousProgress = position;
      session.previousAt = observedAt;
      session.previousStatus = media.status;
      if (!reached) return;
    }

    const previousPosition = session.previousProgress;
    const elapsed = session.previousAt === null
      ? 0
      : Math.max(0, observedAt - session.previousAt);
    const change = previousPosition === null ? 0 : position - previousPosition;
    const discontinuity = previousPosition !== null &&
      (change < -5000 || change > elapsed + 5000);

    if (discontinuity) {
      session.watchedMs = 0;
      const trusted = session.trustedPosition;
      if (session.approved && trusted !== null &&
          Math.abs(position - trusted) > DUNE_RESUME_DIFFERENCE_MS) {
        session.confirmRequired = true;
        session.approved = false;
        logger.log("[dune-resume] Manual seek detected; protecting Jellyfin for three minutes", {
          itemId: session.itemId,
        });
      }
    } else if (!session.approved && session.confirmRequired &&
        session.previousStatus === "playing" && media.status === "playing") {
      session.watchedMs += Math.max(0, change);
    }

    session.previousProgress = position;
    session.previousAt = observedAt;
    session.previousStatus = media.status;

    if (session.confirmRequired && !session.approved &&
        session.watchedMs >= DUNE_RESUME_CONFIRM_PLAYBACK_MS) {
      session.approved = true;
      logger.log("[dune-resume] Three minutes of actual playback confirmed", {
        itemId: session.itemId,
      });
      const snapshot = normalizeCheckpointMedia(media);
      if (snapshot && !session.blocked) {
        await writePermittedCheckpoint({
          ...snapshot,
          reason: "resume-confirmed",
          observedAt,
        });
      }
    }

    for (const checkpoint of checkpoints) {
      await writePermittedCheckpoint(checkpoint);
    }
  }

  function observe(media, checkpoints = []) {
    queue = queue.then(() => observeInternal(media, checkpoints)).catch(error => {
      logger.error("[dune-resume] Guard failure; checkpoints discarded", error);
      if (session) {
        session.blocked = true;
        session.approved = false;
      }
    });
    return queue;
  }

  function getNotice(media, at = now()) {
    const key = getSessionKey(media);
    return key && session?.key === key &&
      session.notice && at < session.notice.expiresAt
      ? { ...session.notice }
      : null;
  }

  return { observe, getNotice };
}

module.exports = {
  DUNE_RESUME_DIFFERENCE_MS,
  DUNE_RESUME_CONFIRM_PLAYBACK_MS,
  DUNE_RESUME_NOTICE_MS,
  createDuneResumeGuard,
};
