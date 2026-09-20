import { describe, expect, test } from "bun:test"
import { runGuiTaskEngine, type GuiObservation, type GuiTaskDriver } from "../src-tauri/resources/computer-use/gui-task-engine"
import { buildDecisionSpace, normalizeDecision, sanitizeLabel } from "../src-tauri/resources/computer-use/jev"
import { applyComputerUseMode, COMPUTER_USE_INSTRUCTIONS, COMPUTER_USE_TOOL_NAMES } from "../src-tauri/resources/computer-use/mode"
import { collectCandidateSet } from "../src-tauri/resources/computer-use/candidate-policy"

describe("computer use tool gating", () => {
  test("keeps coding tools and only toggles known computer-use names", () => {
    const available = ["read", "bash", "gui_task", "observe_ui", "act_ui"]
    expect(applyComputerUseMode(["read", "observe_ui"], available, false)).toEqual(["read"])
    expect(applyComputerUseMode(["read", "observe_ui"], available, true).sort()).toEqual(["gui_task", "read"])
  })

  test("documents the strict task contract", () => {
    expect(COMPUTER_USE_TOOL_NAMES).toContain("gui_task")
    expect(COMPUTER_USE_TOOL_NAMES).toContain("act_ui")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("completion predicate")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("textSlots")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("A Jev DONE choice is advisory")
  })
})

describe("Jev decision space", () => {
  test("keeps operation and compatible target heads in one request", () => {
    const space = buildDecisionSpace("open the result", [
      { id: "click:@e1", ref: "@e1", role: "button", label: "Open", action: "click" },
      { id: "type:@e2:query", ref: "@e2", role: "text field", label: "Search", action: "type_text", slotId: "query" },
    ])
    expect(Object.keys(space.questions)).toEqual(["operation", "click_target", "type_text_target"])
    expect(Object.keys(space.questions.operation.criteria)).toContain("DONE")
    expect(space.questions.operation.criteria.TYPE_TEXT).toContain("local text slot")
    expect(space.questions.click_target.criteria["click:@e1"]).toContain("Open")
  })

  test("keeps page URLs out of labels sent to Jev", () => {
    expect(sanitizeLabel("Open https://example.com/private?token=secret")).toBe("Open")
  })

  test("validates only the target head selected by the operation", () => {
    const space = buildDecisionSpace("open the result", [
      { id: "click:@e1", ref: "@e1", role: "button", label: "Open", action: "click" },
      { id: "type:@e2:query", ref: "@e2", role: "text field", label: "Search", action: "type_text", slotId: "query" },
    ])
    const decision = normalizeDecision({
      operation: { type: "choice", choice: "CLICK", confidence: 0.9, probabilities: { CLICK: 0.9, TYPE_TEXT: 0.03, WAIT: 0.02, DONE: 0.02, BLOCKED: 0.03 } },
      click_target: { type: "choice", choice: "click:@e1", confidence: 1, probabilities: { "click:@e1": 1 } },
      type_text_target: { type: "choice", choice: "invented", confidence: 1, probabilities: { invented: 1 } },
    }, space)
    expect(decision.operation).toBe("CLICK")
    expect(decision.targetId).toBe("click:@e1")
  })

  test("rejects non-maximal operation choices", () => {
    const space = buildDecisionSpace("open", [{ id: "click:@e1", ref: "@e1", role: "button", label: "Open", action: "click" }])
    expect(() => normalizeDecision({ operation: { type: "choice", choice: "CLICK", confidence: 0.8, probabilities: { CLICK: 0.2, WAIT: 0.7, DONE: 0.03, BLOCKED: 0.07 } } }, space)).toThrow("non-maximal")
  })
})

describe("candidate scope", () => {
  test("exposes only scoped, non-consequential controls and local text slots", () => {
    const result = collectCandidateSet({
      ref: "@e0",
      role: "window",
      children: [
        { ref: "@e1", role: "button", title: "Open", canPress: true },
        { ref: "@e2", role: "button", title: "Delete", canPress: true },
        { ref: "@e3", role: "text field", title: "Search", value: "", canSetValue: true },
      ],
    }, { mode: "observed_low_risk" }, [{ id: "query", value: "hello", fieldLabel: "Search" }], "open")
    expect(result.candidates.map(candidate => candidate.id)).toEqual(["click:@e1", "type:@e3:query"])
    expect(result.deferred).toBe(1)
  })

  test("defers duplicate text targets instead of guessing between them", () => {
    const result = collectCandidateSet({ ref: "@e0", children: [
      { ref: "@e1", role: "text field", title: "Name", canSetValue: true },
      { ref: "@e2", role: "text field", title: "Name", canSetValue: true },
    ] }, { mode: "explicit" }, [{ id: "name", value: "Orbit", fieldLabel: "Name" }])
    expect(result.candidates).toEqual([])
    expect(result.deferred).toBe(2)
  })

  test("admits a consequential control only through an exact authorized label", () => {
    const root = { ref: "@e0", children: [{ ref: "@e1", role: "button", title: "Delete", canPress: true }] }
    expect(collectCandidateSet(root, { mode: "explicit", clickLabels: ["Delete"] }, []).candidates).toEqual([])
    expect(collectCandidateSet(root, { mode: "explicit", clickLabels: ["Delete"], authorizedConsequentialLabels: ["Delete"] }, []).candidates[0]?.id).toBe("click:@e1")
  })
})

const observation = (fingerprint: string, text = "screen"): GuiObservation => ({
  stateId: `state-${fingerprint}`,
  rootRef: "@r1",
  title: "Demo",
  url: "https://example.test/",
  controls: [],
  fingerprint,
  context: text,
  verificationContext: text,
  deferred: 0,
  candidates: [{ id: "click:@e1", ref: "@e1", role: "button", label: "Result", action: "click" }],
})

const input = (requiredText: string[] = ["complete"]) => ({
  version: 1 as const,
  goal: "open the result",
  target: { kind: "browser" as const, url: "https://example.test/", allowedOrigins: ["https://example.test"] },
  completion: { requiredText },
  scope: { mode: "observed_low_risk" as const },
})

describe("gui task engine", () => {
  test("rejects a browser task whose start URL is outside its origin scope", async () => {
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    await expect(runGuiTaskEngine({ input: { ...input(), target: { kind: "browser", url: "https://outside.test", allowedOrigins: ["https://example.test"] } }, driver, decide: async () => { throw new Error("must not decide") } })).rejects.toThrow("outside target.allowedOrigins")
  })

  test("finishes only from the independent local verifier", async () => {
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a", "complete"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => { decisions++; throw new Error("must not decide") } })
    expect(result.status).toBe("done")
    expect(decisions).toBe(0)
  })

  test("rejects a Jev DONE signal before completion is verified", async () => {
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => ({ operation: "DONE", targetId: null, confidence: 1, targetConfidence: null, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} }) })
    expect(result.status).toBe("blocked")
  })

  test("does not echo private completion values in failure details", async () => {
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(["private completion value"]), driver, decide: async () => ({ operation: "DONE", targetId: null, confidence: 1, targetConfidence: null, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} }) })
    expect(JSON.stringify(result)).not.toContain("private completion value")
  })

  test("hands uncertain choices back without executing", async () => {
    let actions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { actions++; return { observation: observation("b"), outcome: "worked" } } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => ({ operation: "CLICK", targetId: "click:@e1", confidence: 0.6, targetConfidence: 0.99, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} }) })
    expect(result.status).toBe("uncertain")
    expect(actions).toBe(0)
  })

  test("continues from a changed successor without replaying an uncertain action", async () => {
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => ({ observation: observation("b", "complete"), outcome: "unknown" }) }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => { decisions++; return { operation: "CLICK", targetId: "click:@e1", confidence: 1, targetConfidence: 1, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} } } })
    expect(result.status).toBe("done")
    expect(result.trace[0].outcome).toBe("unknown")
    expect(decisions).toBe(1)
  })

  test("never replays an unknown mutation when state did not change", async () => {
    let actions = 0
    const stable = observation("a")
    const driver: GuiTaskDriver = { start: async () => stable, refresh: async current => current, act: async () => { actions++; return { observation: stable, outcome: "unknown" } } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => ({ operation: "CLICK", targetId: "click:@e1", confidence: 1, targetConfidence: 1, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} }) })
    expect(result.status).toBe("needs_review")
    expect(actions).toBe(1)
  })

  test("re-observes stale decisions without consuming the mutation budget", async () => {
    let attempts = 0
    const driver: GuiTaskDriver = {
      start: async () => observation("a"),
      refresh: async current => current,
      act: async () => {
        attempts++
        return attempts === 1
          ? { observation: observation("b"), outcome: "stale" }
          : { observation: observation("c", "complete"), outcome: "worked" }
      },
    }
    const result = await runGuiTaskEngine({ input: { ...input(), budget: { maxActions: 1, maxDecisions: 3 } }, driver, decide: async () => ({ operation: "CLICK", targetId: "click:@e1", confidence: 1, targetConfidence: 1, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} }) })
    expect(result.status).toBe("done")
    expect(result.actions).toBe(1)
    expect(result.decisions).toBe(2)
    expect(result.metrics.staleDecisions).toBe(1)
    expect(result.metrics.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  test("resolves text locally from the selected slot", async () => {
    let action: unknown
    const start: GuiObservation = { ...observation("a"), candidates: [{ id: "type:@e1:query", ref: "@e1", role: "text field", label: "Search", action: "type_text", slotId: "query" }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async (_observation, next) => { action = next; return { observation: observation("b", "complete"), outcome: "worked" } } }
    const result = await runGuiTaskEngine({ input: { ...input(), textSlots: [{ id: "query", value: "private value", fieldLabel: "Search" }] }, driver, decide: async () => ({ operation: "TYPE_TEXT", targetId: "type:@e1:query", confidence: 1, targetConfidence: 1, model: "jev-1.13.0", latencyMs: 1, probabilities: {}, targetProbabilities: {} }) })
    expect(result.status).toBe("done")
    expect(action).toEqual({ action: "setText", ref: "@e1", text: "private value", slotId: "query" })
    expect(JSON.stringify(result)).not.toContain("private value")
  })

  test("verifies structured control state without asking Jev", async () => {
    const ready = { ...observation("a"), controls: [{ label: "Dark mode", role: "checkbox", checked: true }] }
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => ready, refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: { ...input([]), completion: { requiredText: [], controls: [{ label: "Dark mode", role: "checkbox", checked: true }] } }, driver, decide: async () => { decisions++; throw new Error("must not decide") } })
    expect(result.status).toBe("done")
    expect(decisions).toBe(0)
  })
})
