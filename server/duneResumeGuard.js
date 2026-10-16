const DUNE_RESUME_DIFFERENCE_MS = 4 * 60 * 1000;
const DUNE_RESUME_CONFIRM_PLAYBACK_MS = 3 * 60 * 1000;
const SEEK_TOLERANCE_MS = 10 * 1000;
const SEEK_VERIFY_TOLERANCE_MS = 12 * 1000;
const SEEK_VERIFY_DEADLINE_MS = 20 * 1000;

/**
 * Per-session safety gate for Dune -> Jellyfin writes. A Jellyfin read
 * must finish before any existing checkpoint can be sent. Seeking is
 * attempted only for a known, safe Jellyfin match with saved progress.
 */
function createDuneResumeGuard({ readPosition, seek, writeCheckpoint, now = Date.now, logger = console }) {
  let session = null;
  let queue = Promise.resolve();

  async function observeInternal(media, checkpoints = []) {
    const valid = media && media.source === "dune" &&
      (media.status === "playing" || media.status === "paused") &&
      typeof media.playSessionId === "string" && media.playSessionId &&
      typeof media.sourceItemId === "string" && media.sourceItemId;
    const key = valid ? media.playSessionId + ":" + media.sourceItemId : null;

    // On a file change, the checkpoint tracker emits the OLD session's
    // stop checkpoint alongside the NEW media. Handle it under the old gate.
    if (key && session && session.key !== key) {
      const oldCheckpoints = checkpoints.filter(checkpoint =>
        session.key === checkpoint.playSessionId + ":" + checkpoint.sourceItemId
      );
      if (!session.blocked && session.approved) {
        for (const checkpoint of oldCheckpoints) await writeCheckpoint(checkpoint);
      }
    }

    if (key && session?.key !== key) {
      session = {
        key, approved: false, blocked: true, initialized: false,
        confirmRequired: false, watchedMs: 0,
        previousProgress: null, previousAt: null,
        seekTarget: null, seekIssuedAt: null,
      };

      try {
        const savedMs = await readPosition(media);
        if (savedMs === null || !Number.isFinite(savedMs) || savedMs < 0) {
          logger.warn("[dune-resume] Jellyfin resume lookup unavailable; no writes", { itemId: media.sourceItemId });
        } else {
          const duneMs = Number(media.progressMs);
          if (Number.isFinite(duneMs) && duneMs >= 0) {
            const difference = Math.abs(savedMs - duneMs);
            session.confirmRequired = savedMs > 0 && difference > DUNE_RESUME_DIFFERENCE_MS;
            session.approved = !session.confirmRequired;
            session.blocked = false;
            if (savedMs >= 1000 && difference > SEEK_TOLERANCE_MS) {
              const accepted = await seek(savedMs);
              if (accepted) {
                session.seekTarget = savedMs;
                session.seekIssuedAt = now();
                session.approved = false;
                session.blocked = true;
              } else {
                logger.warn("[dune-resume] Dune seek not accepted; position guarded", { itemId: media.sourceItemId });
              }
            }
          }
        }
      } catch (error) {
        logger.warn("[dune-resume] Resume check failed; protect Jellyfin progress", {
          itemId: media.sourceItemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      session.initialized = true;
    }

    // A stop checkpoint belongs to the previous session. It may only
    // write if the previous observation already earned permission.
    if (!key) {
      const permitted = session && !session.blocked && session.approved;
      if (permitted) {
        for (const checkpoint of checkpoints) await writeCheckpoint(checkpoint);
      }
      session = null;
      return;
    }

    if (!session || session.key !== key || !session.initialized) return;

    const position = Number(media.progressMs);
    const at = now();

    if (session.seekTarget !== null) {
      const reached = Number.isFinite(position) &&
        Math.abs(position - session.seekTarget) <= SEEK_VERIFY_TOLERANCE_MS;
      if (reached) {
        session.seekTarget = null;
        session.seekIssuedAt = null;
        session.blocked = false;
        session.approved = !session.confirmRequired;
        session.watchedMs = 0;
        session.previousProgress = position;
        session.previousAt = at;
        logger.log("[dune-resume] Jellyfin resume position confirmed", { itemId: media.sourceItemId });
      } else if (at - session.seekIssuedAt < SEEK_VERIFY_DEADLINE_MS) {
        return;
      } else {
        logger.warn("[dune-resume] Seek could not be verified; protecting older Jellyfin progress");
        session.seekTarget = null;
        session.seekIssuedAt = null;
        session.blocked = false;
        session.approved = !session.confirmRequired;
        session.watchedMs = 0;
        session.previousProgress = position;
        session.previousAt = at;
      }
    }

    if (session.confirmRequired && !session.approved) {
      if (media.status === "playing" && Number.isFinite(position) &&
          Number.isFinite(session.previousProgress) && session.previousAt !== null) {
        const deltaProgress = position - session.previousProgress;
        const deltaWall = Math.max(0, at - session.previousAt);
        if (deltaProgress < -2000 || deltaProgress > deltaWall + 3000) {
          // User deliberately sought elsewhere. Restart confirmation.
          session.watchedMs = 0;
        } else {
          session.watchedMs += Math.max(0, deltaProgress);
        }
      }
      session.previousProgress = Number.isFinite(position) ? position : null;
      session.previousAt = at;
      if (session.watchedMs >= DUNE_RESUME_CONFIRM_PLAYBACK_MS) {
        session.approved = true;
        logger.log("[dune-resume] Three minutes of real playback confirmed", { itemId: media.sourceItemId });
      }
    }

    if (!session.blocked && session.approved) {
      for (const checkpoint of checkpoints.filter(checkpoint =>
        session.key === checkpoint.playSessionId + ":" + checkpoint.sourceItemId
      )) await writeCheckpoint(checkpoint);
    }
  }

  function observe(media, checkpoints = []) {
    queue = queue.then(() => observeInternal(media, checkpoints)).catch(error => {
      logger.error("[dune-resume] Guard failure; writes discarded", error);
      if (session) { session.blocked = true; session.approved = false; }
    });
    return queue;
  }

  return { observe };
}

module.exports = {
  DUNE_RESUME_DIFFERENCE_MS,
  DUNE_RESUME_CONFIRM_PLAYBACK_MS,
  createDuneResumeGuard,
};
