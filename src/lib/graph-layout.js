/**
 * Radial tree layout, computed at build time.
 *
 * Every leaf gets an equal angular slot; a branch sits at the centre of the
 * slice its subtree occupies. Rings are explicit rather than depth * gap so the
 * outer rings can be pulled in — otherwise the graph grows unusably wide.
 *
 * The y axis is squashed so the result reads as a landscape constellation
 * rather than a circle the height of the viewport.
 */

const RINGS = [0, 150, 285, 410, 505];
const Y_SCALE = 0.6;
const START_ANGLE = -Math.PI / 2; // first slot begins at 12 o'clock

const countLeaves = (node) =>
  !node.children || node.children.length === 0
    ? 1
    : node.children.reduce((sum, child) => sum + countLeaves(child), 0);

export function layoutRadial(root) {
  const nodes = [];
  const links = [];

  const place = (node, depth, a0, a1, parent) => {
    const angle = (a0 + a1) / 2;
    const r = RINGS[Math.min(depth, RINGS.length - 1)];

    const record = {
      id: node.id,
      label: node.label,
      aliases: node.aliases || [],
      kind: node.kind || "topic",
      href: node.href || null,
      date: node.date || null,
      note: node.note,
      group: node.group,
      depth,
      angle,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * Y_SCALE,
      parent: parent ? parent.id : null,
      parentLabel: parent ? parent.label : null,
      isBranch: Boolean(node.children && node.children.length),
    };
    nodes.push(record);

    if (parent) {
      // Bend each link slightly toward the centre so the rings read as arcs.
      const cx = ((parent.x + record.x) / 2) * 0.85;
      const cy = ((parent.y + record.y) / 2) * 0.85;
      links.push({
        id: `${parent.id}--${record.id}`,
        source: parent.id,
        target: record.id,
        group: record.group,
        d: `M${parent.x.toFixed(1)} ${parent.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${record.x.toFixed(1)} ${record.y.toFixed(1)}`,
      });
    }

    if (node.children) {
      const total = countLeaves(node);
      let cursor = a0;
      for (const child of node.children) {
        const span = (a1 - a0) * (countLeaves(child) / total);
        place(child, depth + 1, cursor, cursor + span, record);
        cursor += span;
      }
    }
  };

  place(root, 0, START_ANGLE, START_ANGLE + Math.PI * 2, null);

  return { nodes, links };
}

/** Ancestors + descendants of a node — the set kept lit when it is focused. */
export function buildAdjacency(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const related = {};

  for (const node of nodes) {
    const set = new Set([node.id]);

    for (let cur = node; cur && cur.parent; cur = byId.get(cur.parent)) {
      set.add(cur.parent);
    }

    const descend = (id) => {
      for (const candidate of nodes) {
        if (candidate.parent === id) {
          set.add(candidate.id);
          descend(candidate.id);
        }
      }
    };
    descend(node.id);

    related[node.id] = [...set];
  }

  return related;
}
