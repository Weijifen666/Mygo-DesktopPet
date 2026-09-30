const STABLE_MS = 2 * 60 * 1000;
const COOLDOWN_MS = 10 * 60 * 1000;

class AwarenessPolicy {
  constructor({ stableMs = STABLE_MS, cooldownMs = COOLDOWN_MS } = {}) {
    this.stableMs = stableMs;
    this.cooldownMs = cooldownMs;
    this.reset();
  }

  reset() {
    this.application = '';
    this.observedSince = 0;
    this.lastReactionAt = 0;
  }

  observe(application, now = Date.now()) {
    const nextApplication = String(application || '').trim().slice(0, 80);
    if (!nextApplication) {
      this.application = '';
      this.observedSince = 0;
      return false;
    }
    if (nextApplication !== this.application) {
      this.application = nextApplication;
      this.observedSince = now;
      return false;
    }
    return now - this.observedSince >= this.stableMs &&
      (!this.lastReactionAt || now - this.lastReactionAt >= this.cooldownMs);
  }

  markReaction(now = Date.now()) {
    this.lastReactionAt = now;
  }
}

module.exports = { AwarenessPolicy, STABLE_MS, COOLDOWN_MS };
