/**
 * Grafts blog posts onto the topic tree as leaf nodes, so the layout allocates
 * real space for them and they can be revealed by zoom.
 *
 * A post is attached only to its *most specific* matches — the deepest nodes it
 * matched. A post tagged `UnrealEngine, Runtime, HLOD` belongs under HLOD, not
 * repeated under every ancestor it happens to name. Genuine ties (equally deep
 * matches, e.g. HLOD and Draw Calls) attach in both places, which is honest:
 * the article really is about both.
 */

import { nodeKeys, normalizeTag } from './tag-match.js';

export function buildGraphTree(root, posts) {
  const flat = [];
  const walk = (node, depth) => {
    flat.push({ node, depth });
    (node.children || []).forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);

  const prepared = posts.map((post) => ({
    post,
    keys: new Set((post.data.tags || []).map(normalizeTag)),
  }));

  /** nodeId -> posts attached there */
  const attachments = new Map();

  for (const { post, keys } of prepared) {
    const hits = flat.filter(({ node }) => nodeKeys(node).some((key) => keys.has(key)));
    if (hits.length === 0) continue;

    const deepest = Math.max(...hits.map((h) => h.depth));
    for (const hit of hits.filter((h) => h.depth === deepest)) {
      if (!attachments.has(hit.node.id)) attachments.set(hit.node.id, []);
      attachments.get(hit.node.id).push(post);
    }
  }

  const clone = (node) => {
    const children = (node.children || []).map(clone);

    for (const post of attachments.get(node.id) || []) {
      children.push({
        id: `post:${post.id}@${node.id}`,
        label: post.data.title,
        kind: 'post',
        group: node.group,
        href: `/blog/${post.id}`,
        note: post.data.description,
        date: post.data.date,
      });
    }

    return { ...node, children: children.length ? children : undefined };
  };

  return { tree: clone(root), attachments };
}
