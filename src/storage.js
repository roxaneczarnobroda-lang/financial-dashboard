// Replaces the Claude.ai Artifacts `window.storage` API (not available outside
// that host) with the same shape backed by localStorage, so the rest of the
// component doesn't need to change.
export const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value === null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
};
