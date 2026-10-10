// Coalesce concurrent reads, expire stale data and discard failed results.
export function readCache({ ttlMs = 60_000, capacity = 100 } = {}) {
  const entries = new Map();
  return {
    read(service, page, load) {
      const key = `${service}:${page}`;
      const hit = entries.get(key);
      if (hit && hit.expires > Date.now()) return hit.promise;
      if (entries.size >= capacity) entries.delete(entries.keys().next().value);
      const entry = { expires: Date.now() + ttlMs };
      const discard = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      entry.promise = Promise.resolve().then(load).then(result => {
        if (!result.ok) discard();
        return result;
      }, error => {
        discard();
        throw error;
      });
      entries.set(key, entry);
      return entry.promise;
    },
    invalidate(service) {
      for (const key of entries.keys()) if (key.startsWith(service + ':')) entries.delete(key);
    }
  };
}
