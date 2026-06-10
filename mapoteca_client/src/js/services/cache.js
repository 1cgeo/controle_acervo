const store = new Map();

/** TTL for domain tables (rarely change): 30 minutes. */
export const TTL_DOMINIO = 30 * 60 * 1000;

/** TTL for entity lists/details: 5 minutes. */
export const TTL_LISTA = 5 * 60 * 1000;

/** TTL for dashboard analytics: 1 minute. */
export const TTL_DASHBOARD = 60 * 1000;

/**
 * Fetch data with caching. Returns cached data if available and not expired.
 * @param {string} key - Unique cache key (use prefixes like 'pedidos:list')
 * @param {Function} fetchFn - Async function that returns the data
 * @param {number} [ttlMs] - Time to live in milliseconds
 * @returns {Promise<any>}
 */
export async function cachedFetch(key, fetchFn, ttlMs = TTL_LISTA) {
  const cached = store.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }

  const data = await fetchFn();
  store.set(key, { data, timestamp: Date.now() });
  return data;
}

/**
 * Invalidate all cache entries whose key starts with the given prefix.
 * Called after mutations (e.g. invalidate('pedidos') after creating a pedido).
 * @param {string} prefix
 */
export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * Clear all cached data (e.g. on logout).
 */
export function clearCache() {
  store.clear();
}
