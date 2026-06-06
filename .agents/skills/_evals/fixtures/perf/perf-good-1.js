// Build a feed with one batched author lookup, plus a size-bounded cache.
const MAX_ENTRIES = 500;
const cache = new Map();

export async function buildFeed(postIds, repo) {
  const posts = await repo.getPosts(postIds);
  const authorIds = [...new Set(posts.map((p) => p.authorId))];
  const authors = await repo.getUsers(authorIds);
  const nameById = new Map(authors.map((a) => [a.id, a.displayName]));
  return posts.map((p) => ({ ...p, author: nameById.get(p.authorId) }));
}

export function renderCached(key, render) {
  if (cache.has(key)) return cache.get(key);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  const out = render(key);
  cache.set(key, out);
  return out;
}
