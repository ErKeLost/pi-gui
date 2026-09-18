import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentActivityFeed } from "../src/components/agents/AgentActivityFeed";
import type { AgentSnapshot } from "../src/lib/agents";

const snapshot: AgentSnapshot = {
  version: 1,
  rootId: "root",
  active: [{ id: "active", parentId: "root", name: "Repo integration", task: "检查代码结构", status: "running", startedAt: Date.now(), childrenIds: [], children: [] }],
  recent: [{ id: "done", parentId: "root", name: "Pi latest", task: "核对版本", status: "completed", startedAt: Date.now() - 2_000, endedAt: Date.now(), childrenIds: [], children: [] }],
  updatedAt: Date.now(),
};

describe("agent activity feed", () => {
  test("renders active and completed workers as lightweight timeline rows", () => {
    const html = renderToStaticMarkup(<AgentActivityFeed snapshot={snapshot} />);
    expect(html).toContain("子 agent 活动");
    expect(html).toContain("Repo integration");
    expect(html).toContain("Pi latest");
    expect(html).toContain("agent-feed-line");
    expect(html).not.toContain("已开启 · 2");
  });

  test("does not render an empty snapshot", () => {
    const html = renderToStaticMarkup(<AgentActivityFeed snapshot={{ ...snapshot, active: [], recent: [] }} />);
    expect(html).toBe("");
  });
});
