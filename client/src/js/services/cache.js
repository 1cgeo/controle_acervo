const store = new Map();

const DEFAULT_TTL = 60 * 1000; // 1 minute

/**
 * Fetch data with caching. Returns cached data if available and not expired.
 * @param {string} key - Unique cache key
 * @param {Function} fetchFn - Async function that returns the data
 * @param {number} ttlMs - Time to live in milliseconds
 * @returns {Promise<any>}
 */
export async function cachedFetch(key, fetchFn, ttlMs = DEFAULT_TTL) {
  const cached = store.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }

  const data = await fetchFn();
  store.set(key, { data, timestamp: Date.now() });
  return data;
}

/**
 * Invalidate a specific cache key.
 */
export function invalidateCache(key) {
  store.delete(key);
}

/**
 * Clear all cached data.
 */
export function clearCache() {
  store.clear();
}
