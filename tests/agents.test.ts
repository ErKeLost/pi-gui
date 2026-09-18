import { describe, expect, test } from "bun:test";
import { elapsedMs, formatAgentElapsed, parseAgentSnapshot } from "../src/lib/agents";

describe("agent snapshot projection", () => {
  test("parses the gui-agents status payload and keeps active rows first", () => {
    const snapshot = parseAgentSnapshot(JSON.stringify({
      version: 1,
      rootId: "root",
      active: [{ id: "a", name: "Repo", task: "Inspect", status: "running", startedAt: 1000 }],
      recent: [
        { id: "a", name: "stale", task: "old", status: "completed" },
        { id: "b", name: "Pi", task: "Check RPC", status: "completed", startedAt: 1000, endedAt: 4000 },
      ],
      updatedAt: 5000,
    }));
    expect(snapshot?.active.map(agent => agent.id)).toEqual(["a"]);
    expect(snapshot?.recent.map(agent => agent.id)).toEqual(["b"]);
    expect(snapshot?.active[0]?.status).toBe("running");
    expect(snapshot?.recent[0]?.status).toBe("completed");
  });

  test("rejects malformed or incomplete wire snapshots", () => {
    expect(parseAgentSnapshot("```json\n{\"active\":[{\"id\":\"a\",\"status\":\"queued\"}]}\n```")).toBeNull();
    expect(parseAgentSnapshot({ version: 1, rootId: "root", active: [{ id: "a" }], recent: [], updatedAt: 1 })).toBeNull();
    expect(parseAgentSnapshot("not json")).toBeNull();
    expect(parseAgentSnapshot(undefined)).toBeNull();
  });

  test("preserves millisecond timestamps and formats elapsed durations", () => {
    const snapshot = parseAgentSnapshot({
      version: 1,
      rootId: "root",
      active: [{ id: "a", name: "Agent", task: "Work", startedAt: 1_000_000_000_000, status: "running" }],
      recent: [],
      updatedAt: 1_000_000_000_000,
    });
    expect(elapsedMs(snapshot!.active[0]!, 1_000_000_064_000)).toBe(64_000);
    expect(formatAgentElapsed(64_000)).toBe("1m 4s");
    expect(formatAgentElapsed(3_600_000)).toBe("1h");
  });

  test("preserves dynamically nested descendants at arbitrary depth", () => {
    const snapshot = parseAgentSnapshot({
      version: 1,
      rootId: "root",
      active: [{
        id: "parent",
        name: "Parent",
        task: "Coordinate",
        status: "running",
        children: [{
          id: "child",
          name: "Child",
          task: "Inspect",
          status: "running",
          children: [{ id: "grandchild", name: "Grandchild", task: "Verify", status: "queued" }],
        }],
      }],
      recent: [],
      updatedAt: 1,
    });
    const child = snapshot?.active[0]?.children[0];
    expect(child?.parentId).toBe("parent");
    expect(child?.children[0]?.parentId).toBe("child");
    expect(snapshot?.active[0]?.childrenIds).toEqual(["child"]);
  });
});
