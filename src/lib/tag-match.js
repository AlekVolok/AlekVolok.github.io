/**
 * Matching blog tags to graph nodes.
 *
 * Tags are authored freely (`Nanite`, `UnrealEngine`, `unreal engine`), so both
 * sides are reduced to a comparable key before matching: lowercase, letters and
 * digits only. That makes "Unreal Engine" and "#UnrealEngine" the same thing.
 *
 * A node can also declare `aliases` for names a tag would never spell out in
 * full — "Physics (Chaos)" is realistically tagged `Chaos`.
 */

export const normalizeTag = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every key a node answers to. */
export const nodeKeys = (node) =>
  [node.label, ...(node.aliases || [])].map(normalizeTag).filter(Boolean);

/**
 * Cross-references posts against nodes.
 * Returns the posts that matched at least one node (newest first), each
 * carrying the node ids it belongs to, plus a nodeId -> post ids index.
 */
export function matchPostsToNodes(posts, nodes) {
  const prepared = posts.map((post) => ({
    post,
    keys: new Set((post.data.tags || []).map(normalizeTag)),
  }));

  const byNode = {};
  const nodesByPost = new Map();

  for (const node of nodes) {
    const keys = nodeKeys(node);
    const hits = prepared.filter(({ keys: postKeys }) =>
      keys.some((key) => postKeys.has(key))
    );

    byNode[node.id] = hits.map(({ post }) => post.id);

    for (const { post } of hits) {
      if (!nodesByPost.has(post.id)) nodesByPost.set(post.id, []);
      nodesByPost.get(post.id).push(node.id);
    }
  }

  const matched = prepared
    .filter(({ post }) => nodesByPost.has(post.id))
    .map(({ post }) => ({ post, nodeIds: nodesByPost.get(post.id) }))
    .sort((a, b) => b.post.data.date.valueOf() - a.post.data.date.valueOf());

  return { matched, byNode };
}
