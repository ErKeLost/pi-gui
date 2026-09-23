import { describe, expect, test } from "bun:test"
import { AgentDesktopCommandError, type AgentDesktopClient, type DesktopEnvelope, type SnapshotData } from "../src-tauri/resources/computer-use/agent-desktop-client"
import { observeDesktop } from "../src-tauri/resources/computer-use/desktop-observation"
import { selectInstalledDesktopApp, type InstalledDesktopApp } from "../src-tauri/resources/computer-use/desktop-app-resolver"
import { runGuiTaskEngine } from "../src-tauri/resources/computer-use/gui-task-engine"
import { validateTaskInput, type DesktopDecision, type DesktopObservation, type GuiTaskInput } from "../src-tauri/resources/computer-use/gui-task-contract"
import { applyComputerUseMode, COMPUTER_USE_INSTRUCTIONS } from "../src-tauri/resources/computer-use/mode"

const task = (overrides: Partial<GuiTaskInput> = {}): GuiTaskInput => ({
  goal: "search for the prepared song and play it",
  target: { app: "Music" },
  textSlots: [{ id: "query", value: "private song", description: "song search query" }],
  budget: { maxActions: 5, maxDecisions: 8, maxDurationMs: 30_000 },
  ...overrides,
})

const observation = (fingerprint: string, candidates: DesktopObservation["candidates"]): DesktopObservation => ({
  app: "Music",
  windowId: "w-1",
  title: "Music",
  surface: "window",
  complete: true,
  capturedAt: Date.now(),
  candidates,
  context: "Music window",
  fingerprint,
})

const choice = (operation: DesktopDecision["operation"], candidateId: string): DesktopDecision => ({
  operation,
  candidateId,
  confidence: 0.9,
  model: "jev-test",
  latencyMs: 1,
  probabilities: { [candidateId]: 1 },
  usage: { inputTokens: 1, outputTokens: 1 },
})

const resolveApp = async () => ({ displayName: "Music", bundleId: "test.music", path: "/Applications/Music.app", launchId: "test.music" })

function mockClient(handler: (args: string[]) => DesktopEnvelope | Promise<DesktopEnvelope>): AgentDesktopClient {
  return {
    run: async <T>(args: string[]) => await handler(args) as DesktopEnvelope<T>,
    dispose: async () => undefined,
  }
}

describe("computer use tool surface", () => {
  test("toggles only the one desktop tool", () => {
    expect(applyComputerUseMode(["read", "gui_task"], ["read", "gui_task"], false)).toEqual(["read"])
    expect(applyComputerUseMode(["read"], ["read", "gui_task"], true).sort()).toEqual(["gui_task", "read"])
  })

  test("exposes one goal instead of a caller-authored UI plan", () => {
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("Do not plan UI phases")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("does not capture screenshots")
    expect(() => validateTaskInput(task())).not.toThrow()
    expect(() => validateTaskInput(task({ target: { app: "" } }))).toThrow("Invalid GUI task contract")
  })
})

describe("installed app resolver", () => {
  const calendar: InstalledDesktopApp = { displayName: "日历", bundleId: "com.apple.iCal", path: "/System/Applications/Calendar.app", launchId: "com.apple.iCal" }
  const chrome: InstalledDesktopApp = { displayName: "Google Chrome", bundleId: "com.google.Chrome", path: "/Applications/Google Chrome.app", launchId: "com.google.Chrome" }

  test("uses the localized display name as a local fact without calling Jev", async () => {
    let calls = 0
    const result = await selectInstalledDesktopApp("日历", [calendar], async () => [calendar], async () => { calls++; return null })
    expect(result.launchId).toBe("com.apple.iCal")
    expect(calls).toBe(0)
  })

  test("uses the bundle filename as an exact local identity", async () => {
    const result = await selectInstalledDesktopApp("Calendar", [calendar], async () => [calendar], async () => null)
    expect(result).toBe(calendar)
  })

  test("lets Jev choose only among real bounded candidates when the intent is semantic", async () => {
    const result = await selectInstalledDesktopApp("浏览器", [], async () => [calendar, chrome], async candidates => {
      expect(candidates).toHaveLength(2)
      return "app-1"
    })
    expect(result).toBe(chrome)
  })

  test("refuses a missing or ambiguous target instead of guessing", async () => {
    await expect(selectInstalledDesktopApp("不存在的应用", [], async () => [calendar, chrome], async () => null)).rejects.toThrow("unambiguously")
  })
})

describe("AX-first desktop observation", () => {
  test("builds compatible candidates from a skeleton without exposing local text", async () => {
    let command: string[] = []
    const snapshot: SnapshotData = {
      app: "Music",
      complete: true,
      ref_count: 3,
      snapshot_id: "s1",
      window: { id: "w-1", title: "Music" },
      tree: {
        role: "window",
        name: "Music",
        children: [{
          role: "textfield",
          name: "Search",
          ref_id: "@s1:e1",
          available_actions: ["SetValue", "TypeText"],
        }, {
          role: "button",
          name: "Play",
          ref_id: "@s1:e2",
          available_actions: ["Click"],
        }, {
          role: "group",
          name: "Results",
          ref_id: "@s1:e3",
          children_count: 20,
          available_actions: ["ScrollTo"],
        }, {
          role: "textfield",
          name: "Password",
          ref_id: "@s1:e4",
          states: ["secure"],
          available_actions: ["SetValue", "TypeText"],
        }],
      },
    }
    const client = mockClient(args => {
      command = args
      return { version: "2.4", ok: true, command: "snapshot", data: snapshot }
    })
    const result = await observeDesktop(client, {
      app: "Music",
      textSlots: [{ id: "query", value: "private song", description: "song search query" }],
      usedSlotIds: new Set(),
      allowPressEnter: false,
    }, { timeoutMs: 5_000 })

    expect(command).toContain("--skeleton")
    expect(command).not.toContain("screenshot")
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "SET_VALUE", ref: "@s1:e1", slotId: "query" }),
      expect.objectContaining({ operation: "TYPE_TEXT", ref: "@s1:e1", slotId: "query" }),
      expect.objectContaining({ operation: "CLICK", ref: "@s1:e2" }),
      expect.objectContaining({ operation: "DRILL", ref: "@s1:e3" }),
      expect.objectContaining({ operation: "DONE" }),
    ]))
    expect(JSON.stringify(result)).not.toContain("private song")
    expect(result.candidates.some(candidate => candidate.ref === "@s1:e4" && ["SET_VALUE", "TYPE_TEXT"].includes(candidate.operation))).toBe(false)
  })
})

describe("desktop goal loop", () => {
  test("can finish a launch-only goal without inventing an action", async () => {
    const commands: string[][] = []
    const client = mockClient(args => {
      commands.push(args)
      return { version: "2.4", ok: true, command: "launch", data: { app: "Music", pid: 1, window: { id: "w-1", title: "Music" } } }
    })
    const ready = observation("ready", [{ id: "done", operation: "DONE", description: "done" }])
    const result = await runGuiTaskEngine({
      input: task({ goal: "open Music", textSlots: [] }),
      client,
      observe: async () => ready,
      decide: async () => choice("DONE", "done"),
      resolveApp,
    })
    expect(result.status).toBe("done")
    expect(result.actions).toBe(0)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("--activate")
  })

  test("types prepared text, submits it, then finishes", async () => {
    const commands: string[][] = []
    const client = mockClient(args => {
      commands.push(args)
      if (args[0] === "launch") return { version: "2.4", ok: true, command: "launch", data: { app: "Music", pid: 1, window: { id: "w-1", title: "Music" } } }
      return { version: "2.4", ok: true, command: args[0], data: { disposition: { delivery: "delivered_verified", retry: "unsafe" } } }
    })
    const states = [
      observation("field", [{ id: "type", operation: "SET_VALUE", ref: "@s1:e1", slotId: "query", description: "Search; prepared text purpose=song query" }]),
      observation("filled", [{ id: "enter", operation: "PRESS_ENTER", description: "submit" }]),
      observation("results", [{ id: "done", operation: "DONE", description: "done" }]),
    ]
    const decisions = [choice("SET_VALUE", "type"), choice("PRESS_ENTER", "enter"), choice("DONE", "done")]
    const result = await runGuiTaskEngine({
      input: task(),
      client,
      observe: async () => states.shift()!,
      decide: async () => decisions.shift()!,
      resolveApp,
    })
    expect(result.status).toBe("done")
    expect(result.actions).toBe(2)
    expect(commands.map(args => args[0])).toEqual(["launch", "set-value", "press"])
    expect(commands[1]).toContain("private song")
  })

  test("never replays an action after uncertain delivery", async () => {
    let clicks = 0
    const client = mockClient(args => {
      if (args[0] === "launch") return { version: "2.4", ok: true, command: "launch", data: { app: "Music", pid: 1, window: { id: "w-1", title: "Music" } } }
      clicks++
      throw new AgentDesktopCommandError("click", { code: "ACTION_FAILED", message: "effect unverified", disposition: { delivery: "delivered_unverified", retry: "unsafe" } })
    })
    const current = observation("play", [{ id: "play", operation: "CLICK", ref: "@s1:e2", description: "Play" }])
    const result = await runGuiTaskEngine({
      input: task({ textSlots: [] }),
      client,
      observe: async () => current,
      decide: async () => choice("CLICK", "play"),
      resolveApp,
    })
    expect(result.status).toBe("needs_review")
    expect(clicks).toBe(1)
  })

  test("does not switch text delivery routes after a failed Jev-selected operation", async () => {
    const commands: string[][] = []
    const client = mockClient(args => {
      commands.push(args)
      if (args[0] === "launch") return { version: "2.4", ok: true, command: "launch", data: { app: "Music", pid: 1 } }
      throw new AgentDesktopCommandError("set-value", { code: "ACTION_FAILED", message: "not settable", disposition: { delivery: "not_delivered", retry: "safe" } })
    })
    const current = observation("field", [{ id: "type", operation: "SET_VALUE", ref: "@s1:e1", slotId: "query", description: "Search" }])
    const result = await runGuiTaskEngine({
      input: task(),
      client,
      observe: async () => current,
      decide: async () => choice("SET_VALUE", "type"),
      resolveApp,
    })
    expect(result.status).toBe("blocked")
    expect(commands.map(args => args[0])).toEqual(["launch", "set-value"])
  })
})
