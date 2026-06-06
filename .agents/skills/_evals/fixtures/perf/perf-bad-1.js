// Build a feed: each post plus its author's display name.
export async function buildFeed(postIds, repo) {
  const feed = [];
  for (const id of postIds) {
    const post = await repo.getPost(id);
    const author = await repo.getUser(post.authorId);
    feed.push({ ...post, author: author.displayName });
  }
  return feed;
}
