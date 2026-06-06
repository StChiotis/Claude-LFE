const cache = new Map();

// Memoize expensive render results, keyed by template name.
export function renderCached(key, render) {
  if (cache.has(key)) return cache.get(key);
  const out = render(key);
  cache.set(key, out);
  return out;
}
