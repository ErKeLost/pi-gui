import { m } from "motion/react";

export type FlowerRailItem = {
  id: string;
  kind: "project" | "session";
  active: boolean;
};

const ITEM_H = 36;
const START_Y = 18;
const PROJECT_X = 10;
const SESSION_X = 18;

type RailNode = FlowerRailItem & { x: number; y: number; idx: number };

function nodesFrom(items: FlowerRailItem[]): RailNode[] {
  return items.map((item, idx) => ({
    ...item,
    idx,
    x: item.kind === "project" ? PROJECT_X : SESSION_X,
    y: START_Y + idx * ITEM_H,
  }));
}

function pathThrough(nodes: RailNode[], end = nodes.length - 1) {
  if (!nodes.length || end < 0) return "";
  let d = `M ${nodes[0].x} ${nodes[0].y}`;
  for (let i = 1; i <= end; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    if (prev.x === curr.x) d += ` L ${curr.x} ${curr.y}`;
    else {
      const midY = (prev.y + curr.y) / 2;
      d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`;
    }
  }
  return d;
}

export function FlowerRail({ items }: { items: FlowerRailItem[] }) {
  const nodes = nodesFrom(items);
  const activeIndex = nodes.findIndex(node => node.active);
  const markerIndex = activeIndex >= 0 ? activeIndex : 0;
  const active = nodes[markerIndex];
  const height = Math.max(nodes.length * ITEM_H, ITEM_H);
  if (!nodes.length) return null;

  return <div className="sidebar-flower-rail-wrap" aria-hidden="true">
    <svg className="sidebar-flower-rail" width="28" height={height} viewBox={`0 0 28 ${height}`}>
      <path d={pathThrough(nodes)} className="sidebar-flower-rail-base" />
      <path d={pathThrough(nodes, markerIndex)} className="sidebar-flower-rail-active" />
      {nodes.map((node, index) => index === markerIndex ? null : <circle key={node.id} cx={node.x} cy={node.y} r={node.kind === "project" ? 2.5 : 2} className={index <= markerIndex ? "is-covered" : ""} />)}
    </svg>
    {active && <m.span className="sidebar-flower-rail-marker" animate={{ x: active.x - 5, y: active.y - 5 }} transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
  </div>;
}

export const FLOWER_ITEM_H = ITEM_H;
