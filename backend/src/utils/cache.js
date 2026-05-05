// Simple in-memory TTL cache for suggestions
class TTLCache {
  constructor() {
    this.map = new Map();
  }

  set(key, value, ttl = 1000 * 60) {
    const expires = Date.now() + ttl;
    this.map.set(key, { value, expires });
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }
}

module.exports = new TTLCache();
