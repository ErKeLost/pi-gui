import { describe, expect, test } from "bun:test"
import { redactLocalValues, runGuiTaskEngine, type GuiObservation, type GuiTaskDriver } from "../src-tauri/resources/computer-use/gui-task-engine"
import { ABSTAIN_CANDIDATE_ID, REOBSERVE_CANDIDATE_ID, buildDecisionSpace, decideWithClient, normalizeDecision, sanitizeLabel, type JevDecision, type JevOperation } from "../src-tauri/resources/computer-use/jev"
import { applyComputerUseMode, COMPUTER_USE_INSTRUCTIONS, COMPUTER_USE_TOOL_NAMES } from "../src-tauri/resources/computer-use/mode"
import { collectCandidateSet, nodeLabel } from "../src-tauri/resources/computer-use/candidate-policy"
import { formatResult } from "../src-tauri/resources/computer-use/gui-task"
import { canonicalRole } from "../src-tauri/resources/computer-use/completion-verifier"
import { validateTaskInput } from "../src-tauri/resources/computer-use/gui-task-contract"

const element = (ref: string) => ({ kind: "element" as const, ref })

describe("computer use tool gating", () => {
  test("keeps coding tools and only toggles known computer-use names", () => {
    const available = ["read", "bash", "gui_task"]
    expect(applyComputerUseMode(["read", "gui_task"], available, false)).toEqual(["read"])
    expect(applyComputerUseMode(["read"], available, true).sort()).toEqual(["gui_task", "read"])
  })

  test("documents the strict task contract", () => {
    expect(COMPUTER_USE_TOOL_NAMES).toContain("gui_task")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("completion predicate")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("textSlots")
    expect(COMPUTER_USE_INSTRUCTIONS).toContain("Jev is not offered a completion action")
  })
})

describe("completion role normalization", () => {
  test("maps platform accessibility role spellings to one semantic role", () => {
    expect(canonicalRole("AXButton")).toBe("button")
    expect(canonicalRole("button")).toBe("button")
    expect(canonicalRole("AXSearchField")).toBe("text_field")
  })
})

describe("typed plan validation", () => {
  test("accepts a launch-only desktop task with local readiness proof", () => {
    expect(() => validateTaskInput({
      goal: "open the requested application",
      target: { kind: "desktop", app: "requested application", activation: "foreground", launch: { timeoutMs: 10_000 } },
      steps: [],
      completion: { appReady: true },
      scope: { allow: [] },
      budget: { maxActions: 1, maxDecisions: 1, maxDurationMs: 15_000 },
    })).not.toThrow()
  })

  test("requires every fill slot in final completion and rejects redundant focus clicks", () => {
    const base = {
      goal: "submit a query",
      target: { kind: "desktop" as const, app: "Demo", activation: "background" as const },
      textSlots: [{ id: "query", value: "value", description: "query" }],
      completion: { requiredSlots: ["query"] },
      scope: { allow: ["click", "type_text"] as ("click" | "type_text")[] },
      budget: { maxActions: 3, maxDecisions: 3, maxDurationMs: 10_000 },
    }
    expect(() => validateTaskInput({ ...base, completion: { requiredText: ["done"] }, steps: [{ id: "fill", kind: "fill", purpose: "query", slotId: "query" }] })).toThrow("Every fill step")
    expect(() => validateTaskInput({ ...base, steps: [
      { id: "focus", kind: "choose", purpose: "focus", action: "click", expect: { titleIncludes: "Demo" } },
      { id: "fill", kind: "fill", purpose: "query", slotId: "query" },
    ] })).toThrow("reveal that slot")
  })

  test("separates post-action expect from pre-action skipIf", () => {
    const task = {
      goal: "reveal and fill",
      target: { kind: "desktop" as const, app: "Demo", activation: "background" as const },
      textSlots: [{ id: "query", value: "value", description: "query" }],
      steps: [
        { id: "reveal", kind: "choose" as const, purpose: "reveal field", action: "click" as const, expect: { fillableSlots: ["query"] }, skipIf: { fillableSlots: ["query"] } },
        { id: "fill", kind: "fill" as const, purpose: "query", slotId: "query" },
      ],
      completion: { requiredSlots: ["query"] },
      scope: { allow: ["click", "type_text"] as ("click" | "type_text")[] },
      budget: { maxActions: 3, maxDecisions: 3, maxDurationMs: 10_000 },
    }
    expect(() => validateTaskInput(task)).not.toThrow()
  })
})

describe("Jev decision space", () => {
  test("offers complete local candidates and reserved outcomes in one Choice", () => {
    const space = buildDecisionSpace("open the result", [
      { id: "candidate-1", target: element("@e1"), role: "button", label: "Open", action: "click" },
      { id: "candidate-2", target: element("@e2"), role: "text field", label: "Search", action: "type_text", slotId: "query" },
    ])
    expect(Object.keys(space.criteria)).toEqual(["candidate-1", "candidate-2", REOBSERVE_CANDIDATE_ID, ABSTAIN_CANDIDATE_ID])
    expect(space.criteria["candidate-2"]).toContain("TYPE_TEXT")
    expect(space.criteria["candidate-1"]).toContain("Open")
    expect(space.instructions.rules.join(" ")).toContain("immediate next step")
    expect(space.instructions.rules.join(" ")).toContain("inserted locally")
  })

  test("normalizes visible labels without guessing privacy classes from text patterns", () => {
    expect(sanitizeLabel("  Open   https://example.com/path  ")).toBe("Open https://example.com/path")
  })

  test("maps one selected candidate back to its locally owned operation", () => {
    const space = buildDecisionSpace("open the result", [
      { id: "candidate-1", target: element("@e1"), role: "button", label: "Open", action: "click" },
      { id: "candidate-2", target: element("@e2"), role: "text field", label: "Search", action: "type_text", slotId: "query" },
    ])
    const decision = normalizeDecision({
      candidate: { type: "choice", choice: "candidate-1", confidence: 0.9, probabilities: { "candidate-1": 0.9, "candidate-2": 0.04, reobserve: 0.02, abstain: 0.04 } },
    }, space)
    expect(decision.operation).toBe("CLICK")
    expect(decision.candidateId).toBe("candidate-1")
  })

  test("rejects non-maximal candidate choices", () => {
    const space = buildDecisionSpace("open", [{ id: "candidate-1", target: element("@e1"), role: "button", label: "Open", action: "click" }])
    expect(() => normalizeDecision({ candidate: { type: "choice", choice: "candidate-1", confidence: 0.8, probabilities: { "candidate-1": 0.2, reobserve: 0.7, abstain: 0.1 } } }, space)).toThrow("non-maximal")
  })

  test("maps reserved candidates to reobserve and abstain", () => {
    const space = buildDecisionSpace("wait", [])
    expect(normalizeDecision({ candidate: { type: "choice", choice: REOBSERVE_CANDIDATE_ID, confidence: 1, probabilities: { reobserve: 1, abstain: 0 } } }, space).operation).toBe("WAIT")
    expect(normalizeDecision({ candidate: { type: "choice", choice: ABSTAIN_CANDIDATE_ID, confidence: 1, probabilities: { reobserve: 0, abstain: 1 } } }, space).operation).toBe("BLOCKED")
  })

  test("can remove reobserve after the same actionable state was refreshed", () => {
    const space = buildDecisionSpace("act or stop", [{ id: "candidate-1", target: element("@e1"), role: "button", label: "Open", action: "click" }], { allowReobserve: false })
    expect(Object.keys(space.criteria)).toEqual(["candidate-1", ABSTAIN_CANDIDATE_ID])
    expect(space.instructions.rules.join(" ")).not.toContain(REOBSERVE_CANDIDATE_ID)
  })

  test("enforces TypeSafe Choice's documented 255-option protocol limit", () => {
    const candidates = Array.from({ length: 254 }, (_, index) => ({ id: `candidate-${index}`, target: element(`@e${index}`), role: "button", label: `Item ${index}`, action: "click" as const }))
    expect(() => buildDecisionSpace("open", candidates)).toThrow("at most 253 executable candidates")
  })

  test("uses the official SDK boundary for one candidate Choice", async () => {
    let sent: any
    const client = { systemOne: async (request: unknown, options: unknown) => {
      sent = { request, options }
      return { model: "jev-1.13.0", usage: { input_tokens: 10, output_tokens: 2 }, answers: { candidate: { type: "choice", choice: "candidate-1", confidence: 0.4, probabilities: { "candidate-1": 0.6, reobserve: 0.2, abstain: 0.2 } } } }
    } }
    const signal = new AbortController().signal
    const result = await decideWithClient(client as never, "open", [{ id: "candidate-1", target: element("@e1"), role: "button", label: "Open", action: "click" }], "screen", [], signal)
    expect(Object.keys(sent.request.questions)).toEqual(["candidate"])
    expect(sent.options.signal).toBe(signal)
    expect(JSON.stringify(sent.request)).not.toContain("@e1")
    expect(result).toMatchObject({ operation: "CLICK", candidateId: "candidate-1", model: "jev-1.13.0", usage: { inputTokens: 10, outputTokens: 2 } })
  })

  test("never sends capture IDs or coordinates to Jev", async () => {
    let sent: any
    const client = { systemOne: async (request: unknown) => {
      sent = request
      return { model: "jev-1.13.0", usage: { input_tokens: 1, output_tokens: 1 }, answers: { candidate: { type: "choice", choice: "visual", confidence: 1, probabilities: { visual: 1, reobserve: 0, abstain: 0 } } } }
    } }
    await decideWithClient(client as never, "open", [{ id: "visual", target: { kind: "point", captureId: "private-capture", regionId: "r1", x: 123, y: 456 }, role: "visual text", label: "Open", action: "click" }], "screen", [])
    const payload = JSON.stringify(sent)
    expect(payload).not.toContain("private-capture")
    expect(payload).not.toContain("123")
    expect(payload).not.toContain("456")
  })
})

describe("candidate scope", () => {
  test("exposes only caller-scoped controls and local text slots", () => {
    const result = collectCandidateSet({
      ref: "@e0",
      role: "window",
      children: [
        { ref: "@e1", role: "button", title: "Open", canPress: true },
        { ref: "@e2", role: "button", title: "Delete", canPress: true },
        { ref: "@e3", role: "text field", title: "Search", value: "", canSetValue: true },
      ],
    }, { allow: ["click", "type_text"] }, [{ id: "query", value: "hello", description: "search query" }])
    expect(result.candidates.map(candidate => candidate.id)).toEqual(["candidate-1", "candidate-2", "candidate-3"])
    expect(result.deferred).toBe(0)
  })

  test("keeps duplicate controls complete and distinguishes them by observation order", () => {
    const result = collectCandidateSet({ ref: "@e0", children: [
      { ref: "@e1", role: "text field", title: "Name", canSetValue: true },
      { ref: "@e2", role: "text field", title: "Name", canSetValue: true },
    ] }, { allow: ["type_text"] }, [{ id: "name", value: "Orbit", description: "name" }])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]?.label).toContain("occurrence 1 of 2")
    expect(result.candidates[1]?.label).toContain("occurrence 2 of 2")
    expect(result.deferred).toBe(0)
  })

  test("does not infer action policy from localized label keywords", () => {
    const root = { ref: "@e0", children: [{ ref: "@e1", role: "button", title: "Delete", canPress: true }] }
    expect(collectCandidateSet(root, { allow: ["click"] }, []).candidates[0]?.id).toBe("candidate-1")
  })

  test("keeps offscreen AX controls outside the current executable set", () => {
    const result = collectCandidateSet({ ref: "@root", children: [
      { ref: "@visible", role: "button", title: "Visible", canPress: true, offscreen: false },
      { ref: "@hidden", role: "button", title: "Hidden", canPress: true, offscreen: true },
    ] }, { allow: ["click"] }, [])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.label).toContain("Visible")
  })

  test("keeps Web clicks on Cua element tokens and Web text on a snapshot-bound pixel target", () => {
    const result = collectCandidateSet({ ref: "@root", role: "AXWindow", children: [{
      ref: "@web", role: "AXWebArea", children: [
        { ref: "@button", role: "AXButton", title: "Open", canPress: true, rect: { x: 20, y: 40, w: 100, h: 30 } },
        { ref: "@field", role: "AXTextField", title: "Query", canSetValue: true, isTextInput: true, rect: { x: 10, y: 80, w: 200, h: 40 } },
        { ref: "@list", role: "AXGroup", title: "Results", canScroll: true, rect: { x: 0, y: 120, w: 300, h: 300 } },
      ],
    }] }, { allow: ["click", "type_text", "scroll"], scrollDeltas: [400] }, [{ id: "query", value: "value", description: "query" }], { stateId: "capture-1", width: 500, height: 500 })

    expect(result.candidates.find(candidate => candidate.action === "click")?.target).toEqual({ kind: "element", ref: "@button" })
    expect(result.candidates.find(candidate => candidate.action === "type_text")?.target).toEqual({ kind: "point", captureId: "capture-1", regionId: "field:@field", x: 110, y: 100 })
    expect(result.candidates.find(candidate => candidate.action === "scroll" && candidate.role === "AXGroup")?.target).toEqual({ kind: "element", ref: "@list" })
  })

  test("keeps a Web click token but defers Web text without pixel grounding", () => {
    const result = collectCandidateSet({ ref: "@root", role: "AXWindow", children: [{
      ref: "@web", role: "AXWebArea", children: [{
        ref: "@frame", role: "AXGroup", children: [
          { ref: "@button", role: "AXButton", title: "Open", canPress: true },
          { ref: "@field", role: "AXTextField", canSetValue: true, isTextInput: true },
        ],
      }],
    }] }, { allow: ["click", "type_text"] }, [{ id: "query", value: "value", description: "query" }], { stateId: "capture-1", width: 500, height: 500 })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ action: "click", target: { kind: "element", ref: "@button" } })
    expect(result.deferred).toBe(1)
  })

  test("keeps AX element actions for browser observations without a desktop capture", () => {
    const result = collectCandidateSet({ ref: "@root", role: "AXWebArea", children: [
      { ref: "@button", role: "AXButton", title: "Open", canPress: true },
    ] }, { allow: ["click"] }, [])

    expect(result.candidates[0]?.target).toEqual({ kind: "element", ref: "@button" })
    expect(result.deferred).toBe(0)
  })

  test("combines prepared slots with observed editable fields after observation", () => {
    const result = collectCandidateSet({ ref: "@e0", children: [
      { ref: "@e1", role: "text field", title: "Recipient", canSetValue: true },
    ] }, { allow: ["type_text"] }, [
      { id: "subject", value: "Hello", description: "message subject" },
      { id: "recipient", value: "Ada", description: "recipient name" },
    ])
    expect(result.candidates.map(candidate => candidate.id)).toEqual(["candidate-1", "candidate-2"])
  })

  test("keeps secure native roles out while preserving the full local candidate inventory", () => {
    const children = Array.from({ length: 260 }, (_, index) => ({ ref: `@e${index}`, role: "button", title: `Item ${index}`, canPress: true }))
    children.push({ ref: "@secure", role: "AXSecureTextField", title: "PIN", canFocus: true })
    const result = collectCandidateSet({ ref: "@root", children }, { allow: ["click", "type_text"] }, [{ id: "pin", value: "1234", description: "PIN" }])
    expect(result.candidates).toHaveLength(260)
    expect(result.candidates.some(candidate => candidate.target.kind === "element" && candidate.target.ref === "@secure")).toBe(false)
    expect(result.deferred).toBe(0)
  })

  test("turns capture-bound native OCR regions into visual click candidates only", () => {
    const result = collectCandidateSet({ ref: "@root", role: "window", children: [
      { ref: "pic_1", role: "AXImage", title: "搜索", pictureOnly: true, rect: { x: 20, y: 40, w: 100, h: 30 } },
    ] }, { allow: ["click", "type_text"] }, [{ id: "query", value: "美女", description: "search query" }], { stateId: "capture-1", width: 800, height: 600 })
    expect(result.candidates.map(candidate => candidate.id)).toEqual(["candidate-1"])
    expect(result.candidates[0]?.target).toEqual({ kind: "point", captureId: "capture-1", regionId: "p0", x: 70, y: 55 })
  })

  test("keeps structurally editable controls even when the application exposes no label", () => {
    const result = collectCandidateSet({ ref: "@root", role: "window", children: [
      { ref: "@first", role: "AXTextField", canFocus: true, canSetValue: true, isTextInput: true },
      { ref: "@second", role: "AXTextField", canFocus: true, canSetValue: true, isTextInput: true },
    ] }, { allow: ["type_text"] }, [{ id: "query", value: "value", description: "query" }])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map(candidate => candidate.label)).toEqual([
      "unlabeled AXTextField; input purpose=query; occurrence 1 of 2 in observation order",
      "unlabeled AXTextField; input purpose=query; occurrence 2 of 2 in observation order",
    ])
  })

  test("describes an unlabeled editable field with its nearest sibling semantics", () => {
    const result = collectCandidateSet({ ref: "@root", children: [{
      ref: "@form", role: "AXGroup", children: [
        { ref: "@field", role: "AXTextField", canSetValue: true, isTextInput: true },
        { ref: "@submit", role: "AXButton", title: "Find", canPress: true },
      ],
    }] }, { allow: ["type_text"] }, [{ id: "query", value: "value", description: "query" }])
    expect(result.candidates[0]?.label).toContain("nearby Find")
  })

  test("does not offer a prepared slot again once its exact value is present in an editable field", () => {
    const result = collectCandidateSet({ ref: "@root", children: [
      { ref: "@query", role: "AXTextField", canSetValue: true, value: "value" },
      { ref: "@comment", role: "AXTextField", canSetValue: true, value: "" },
    ] }, { allow: ["type_text"] }, [{ id: "query", value: "value", description: "query" }])
    expect(result.candidates).toEqual([])
  })

  test("relates a filled field to its nearest structured action", () => {
    const result = collectCandidateSet({ ref: "@root", children: [{
      ref: "@form", role: "AXGroup", children: [
        { ref: "@field", role: "AXTextField", canSetValue: true, isTextInput: true, value: "value" },
        { ref: "@submit", role: "AXButton", title: "Find", canPress: true },
      ],
    }] }, { allow: ["click", "type_text"] }, [{ id: "query", value: "value", description: "query" }])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ action: "click", afterSlotIds: ["query"], label: expect.stringContaining("Find") })
  })

  test("uses OCR text rectangles without a label or confidence threshold", () => {
    const result = collectCandidateSet({ ref: "@root", role: "window", text: [
      { string: "任意文本", confidence: 0.01, rect: { x: 4, y: 8, w: 20, h: 10 } },
    ] }, { allow: ["click"] }, [], { stateId: "capture-1", width: 100, height: 100 })
    expect(result.candidates[0]).toMatchObject({ id: "candidate-1", label: "任意文本" })
    expect(nodeLabel({ role: "AXGroup", text: [{ string: "任意文本" }] })).toBe("")
  })

  test("does not reintroduce secure native fields through their OCR annotations", () => {
    const result = collectCandidateSet({ ref: "@root", role: "window", children: [
      { ref: "@secure", role: "AXSecureTextField", title: "PIN", text: [{ string: "1234", rect: { x: 2, y: 2, w: 20, h: 10 } }] },
    ] }, { allow: ["click", "type_text"] }, [{ id: "pin", value: "1234", description: "PIN" }], { stateId: "capture-1", width: 100, height: 100 })
    expect(result.candidates).toEqual([])
  })

  test("discloses read-only leaf text but keeps editable values and image URLs local", () => {
    expect(nodeLabel({ role: "AXStaticText", value: "Visible caption" })).toBe("Visible caption")
    expect(nodeLabel({ role: "AXTextField", value: "private", canSetValue: true, isTextInput: true })).toBe("")
    expect(nodeLabel({ role: "AXImage", title: "https://cdn.example/private.jpg", value: "https://cdn.example/private.jpg" })).toBe("")
  })

  test("describes a capture-bound image candidate with nearby read-only text", () => {
    const result = collectCandidateSet({ ref: "@root", role: "window", children: [{
      ref: "@card", role: "AXGroup", canPress: true, rect: { x: 10, y: 20, w: 100, h: 150 }, children: [
        { ref: "@image", role: "AXImage", value: "https://cdn.example/image.jpg", rect: { x: 10, y: 20, w: 100, h: 120 } },
        { ref: "@caption", role: "AXStaticText", value: "Result caption" },
      ],
    }] }, { allow: ["click"] }, [], { stateId: "capture-1", width: 500, height: 500 })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ role: "visual image", label: "Result caption", target: { kind: "point", x: 60, y: 80 } })
  })

  test("replaces a coarse clickable image container with its capture-bound image region", () => {
    const result = collectCandidateSet({ ref: "@root", children: [{
      ref: "@card", role: "AXGroup", canPress: true, rect: { x: 0, y: 0, w: 200, h: 240 }, children: [
        { ref: "@image", role: "AXImage", rect: { x: 10, y: 10, w: 180, h: 180 } },
        { ref: "@caption", role: "AXStaticText", value: "Result caption" },
      ],
    }] }, { allow: ["click"] }, [], { stateId: "capture-1", width: 500, height: 500 })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.target.kind).toBe("point")
  })

  test("keeps nested card links from competing with the owned image action", () => {
    const result = collectCandidateSet({ ref: "@root", children: [{
      ref: "@card", role: "AXGroup", canPress: true, rect: { x: 10, y: 10, w: 180, h: 240 }, children: [
        { ref: "@image", role: "AXImage", rect: { x: 10, y: 10, w: 180, h: 180 } },
        { ref: "@caption", role: "AXStaticText", value: "Result caption" },
        { ref: "@author", role: "AXLink", title: "Author", canPress: true },
      ],
    }] }, { allow: ["click"] }, [], { stateId: "capture-1", width: 500, height: 500 })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ role: "visual image", label: expect.stringContaining("Result caption") })
  })

  test("lets a described visual image dominate an equivalent semantic container", () => {
    const result = collectCandidateSet({ ref: "@root", children: [{
      ref: "@card", role: "AXGroup", canPress: true, title: "Result caption", rect: { x: 0, y: 0, w: 120, h: 140 },
      children: [{ ref: "@wrapper", role: "AXGroup", children: [{ ref: "@image", role: "AXImage", rect: { x: 10, y: 10, w: 100, h: 100 } }, { ref: "@text", role: "AXStaticText", value: "Result caption" }] }],
    }] }, { allow: ["click"] }, [], { stateId: "capture-1", width: 500, height: 500 })
    expect(result.candidates.filter(candidate => candidate.label.includes("Result caption"))).toHaveLength(1)
    expect(result.candidates[0]?.target.kind).toBe("point")
  })

  test("drops a coarse actionable container when a descendant owns a specific action", () => {
    const result = collectCandidateSet({ ref: "@root", children: [{
      ref: "@panel", role: "AXGroup", canPress: true, title: "Panel", children: [
        { ref: "@button", role: "AXButton", canPress: true, title: "Open" },
      ],
    }] }, { allow: ["click"] }, [])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.label).toContain("Open")
  })

  test("does not turn ancestor context into a label for an otherwise undescribed click", () => {
    const result = collectCandidateSet({ ref: "@root", role: "AXWindow", title: "Page", children: [
      { ref: "@anonymous", role: "AXGroup", canPress: true, rect: { x: 10, y: 10, w: 50, h: 20 } },
    ] }, { allow: ["click"] }, [], { stateId: "capture-1", width: 100, height: 100 })
    expect(result.candidates).toEqual([])
    expect(result.deferred).toBe(1)
  })

  test("grounds collection ordinals from geometry instead of tree or candidate order", () => {
    const card = (ref: string, label: string, x: number, y: number) => ({ ref, role: "AXGroup", canPress: true, rect: { x, y, w: 80, h: 60 }, children: [{ role: "AXStaticText", value: label }] })
    const result = collectCandidateSet({ ref: "@root", children: [{ ref: "@grid", role: "AXGroup", children: [
      card("@fifth", "Fifth", 0, 100),
      card("@third", "Third", 200, 0),
      card("@first", "First", 0, 0),
      card("@sixth", "Sixth", 100, 100),
      card("@fourth", "Fourth", 300, 0),
      card("@second", "Second", 100, 0),
    ] }] }, { allow: ["click"] }, [])
    const fifth = result.candidates.find(candidate => candidate.label.includes("Fifth"))
    const collection = result.collections.find(candidate => candidate.items.some(item => item.candidateId === fifth?.id))
    expect(collection).toMatchObject({ size: 6, order: "reading" })
    expect(collection?.items.find(item => item.candidateId === fifth?.id)?.ordinal).toBe(5)
  })
})

const observation = (fingerprint: string, text = "screen"): GuiObservation => ({
  stateId: `state-${fingerprint}`,
  rootRef: "@r1",
  title: "Demo",
  url: "https://example.test/",
  controls: [],
  collections: [],
  candidateStats: { accessibility: 1, visual: 0 },
  capturedAt: 1_000,
  mediaTracks: {},
  presentSlotIds: [],
  fingerprint,
  context: text,
  verificationContext: text,
  deferred: 0,
  candidates: [{ id: "candidate-1", target: element("@e1"), role: "button", label: "Result", action: "click" }],
})

const input = (requiredText: string[] = ["complete"]) => ({
  goal: "open the result",
  target: { kind: "desktop" as const, app: "Demo", activation: "background" as const },
  steps: [{ id: "open", kind: "choose" as const, purpose: "open the result", action: "click" as const, expect: { requiredText: ["complete"] } }],
  completion: { requiredText },
  scope: { allow: ["click"] as ("click" | "type_text" | "scroll")[] },
  budget: { maxActions: 24, maxDecisions: 48, maxDurationMs: 60_000 },
})

const decision = (operation: JevOperation, candidateId: string | null = null, confidence = 1): JevDecision => ({
  operation, candidateId, confidence, model: "jev-1.13.0", latencyMs: 1, probabilities: {},
})

describe("gui task engine", () => {
  test("redacts local slot values from every string sent to Jev", async () => {
    const privateValue = "private-value-42"
    const start = { ...observation("a", `screen ${privateValue}`), candidates: [{ id: "candidate-1", target: element("@e1"), role: "button", label: `Open ${privateValue}`, action: "click" as const }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: { ...input(), goal: `Use ${privateValue}`, textSlots: [{ id: "value", value: privateValue, description: "field value" }] }, driver, decide: async (goal, candidates, context) => {
      expect(`${goal} ${context} ${candidates[0]?.label}`).not.toContain(privateValue)
      return decision("BLOCKED")
    } })
    expect(result.status).toBe("blocked")
    expect(redactLocalValues("a secret and secret", ["secret"])).toBe("a [local slot] and [local slot]")
  })

  test("rejects a non-desktop task target", async () => {
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    await expect(runGuiTaskEngine({ input: { ...input(), target: { kind: "web" } as never }, driver, decide: async () => { throw new Error("must not decide") } })).rejects.toThrow("desktop app target")
  })

  test("accepts independent action and decision ceilings", async () => {
    const driver: GuiTaskDriver = { start: async () => observation("a", "complete"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: { ...input(), budget: { maxActions: 12, maxDecisions: 8, maxDurationMs: 30_000 } }, driver, decide: async () => { throw new Error("must not decide") } })
    expect(result.status).toBe("done")
  })

  test("finishes only from the independent local verifier", async () => {
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a", "complete"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => { decisions++; throw new Error("must not decide") } })
    expect(result.status).toBe("done")
    expect(decisions).toBe(0)
  })

  test("verifies media playback caused by the terminal phase", async () => {
    let refreshes = 0
    let decisions = 0
    const start = { ...observation("a", "screen"), capturedAt: 1_000, mediaTracks: {} }
    const first = { ...observation("b", "screen"), capturedAt: 2_000, mediaTracks: { player: 7 } }
    const second = { ...observation("c", "screen"), capturedAt: 3_000, mediaTracks: { player: 8 } }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async () => { refreshes++; return second }, act: async () => ({ observation: first, outcome: "worked" }) }
    const result = await runGuiTaskEngine({ input: { ...input([]), completion: { requiredText: [], mediaPlayback: { sampleIntervalMs: 1, minAdvanceSeconds: 1 } } }, driver, decide: async () => { decisions++; return decision("CLICK", "candidate-1") } })
    expect(result.status).toBe("done")
    expect(refreshes).toBe(1)
    expect(decisions).toBe(1)
  })

  test("does not confuse a grid of media previews with one active player", async () => {
    let refreshes = 0
    const grid = { ...observation("a", "screen"), capturedAt: 1_000, mediaTracks: {} }
    const driver: GuiTaskDriver = { start: async () => grid, refresh: async current => { refreshes++; return current }, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: { ...input([]), completion: { requiredText: [], mediaPlayback: { sampleIntervalMs: 1, minAdvanceSeconds: 1 } } }, driver, decide: async () => decision("BLOCKED") })
    expect(result.status).toBe("blocked")
    expect(refreshes).toBe(0)
  })

  test("lets Jev reobserve an empty loading state instead of blocking before the decision", async () => {
    let refreshes = 0
    const empty = { ...observation("a"), candidates: [] }
    const driver: GuiTaskDriver = { start: async () => empty, refresh: async () => { refreshes++; return observation("b", "complete") }, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => decision("WAIT") })
    expect(result.status).toBe("done")
    expect(refreshes).toBe(1)
  })

  test("does not offer reobserve while executable actions are available", async () => {
    const stable = observation("a")
    const options: (boolean | undefined)[] = []
    const driver: GuiTaskDriver = { start: async () => stable, refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async (_goal, _candidates, _context, _history, _signal, decisionOptions) => {
      options.push(decisionOptions?.allowReobserve)
      return decision("BLOCKED")
    } })
    expect(result.status).toBe("blocked")
    expect(options).toEqual([false])
  })

  test("does not echo private completion values in failure details", async () => {
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(["private completion value"]), driver, decide: async () => decision("BLOCKED") })
    expect(JSON.stringify(result)).not.toContain("private completion value")
  })

  test("does not apply an uncalibrated confidence cutoff", async () => {
    let actions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { actions++; return { observation: observation("b", "complete"), outcome: "worked" } } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => decision("CLICK", "candidate-1", 0.01) })
    expect(result.status).toBe("done")
    expect(actions).toBe(1)
    expect(formatResult(input(), result)).toContain("jev_action=jev-1.13.0")
    expect(formatResult(input(), result)).toContain("confidence=0.01")
  })

  test("rejects an operation that does not match the locally owned candidate", async () => {
    let actions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { actions++; throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => decision("TYPE_TEXT", "candidate-1") })
    expect(result.status).toBe("uncertain")
    expect(actions).toBe(0)
  })

  test("rejects a visual candidate that belongs to an older capture", async () => {
    let actions = 0
    const start = { ...observation("a"), candidates: [{ id: "candidate-1", target: { kind: "point" as const, captureId: "state-old", regionId: "r1", x: 10, y: 20 }, role: "visual text", label: "Open", action: "click" as const }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => { actions++; throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => decision("CLICK", "candidate-1") })
    expect(result.status).toBe("uncertain")
    expect(actions).toBe(0)
  })

  test("reports cancellation during a Jev decision as aborted", async () => {
    const controller = new AbortController()
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: input(), driver, signal: controller.signal, decide: async () => { controller.abort(); throw new Error("request aborted") } })
    expect(result.status).toBe("aborted")
  })

  test("continues from a changed successor without replaying an uncertain action", async () => {
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => ({ observation: observation("b", "complete"), outcome: "unknown" }) }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => { decisions++; return decision("CLICK", "candidate-1") } })
    expect(result.status).toBe("done")
    expect(result.trace[0].outcome).toBe("unknown")
    expect(decisions).toBe(1)
  })

  test("never replays an unknown mutation when state did not change", async () => {
    let actions = 0
    const stable = observation("a")
    const driver: GuiTaskDriver = { start: async () => stable, refresh: async current => current, act: async () => { actions++; return { observation: stable, outcome: "unknown" } } }
    const result = await runGuiTaskEngine({ input: input(), driver, decide: async () => decision("CLICK", "candidate-1") })
    expect(result.status).toBe("needs_review")
    expect(actions).toBe(1)
  })

  test("does not branch to another mutation when an unknown action changed UI without phase proof", async () => {
    let actions = 0
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => observation("a"), refresh: async current => current, act: async () => { actions++; return { observation: observation(`frame-${actions}`), outcome: "unknown" } } }
    const result = await runGuiTaskEngine({ input: { ...input(), budget: { maxActions: 3, maxDecisions: 3, maxDurationMs: 10_000 } }, driver, decide: async (_goal, candidates) => {
      decisions++
      return candidates.length ? decision("CLICK", candidates[0].id) : decision("BLOCKED")
    } })
    expect(result.status).toBe("needs_review")
    expect(actions).toBe(1)
    expect(decisions).toBe(1)
  })

  test("resolves text locally from the selected slot", async () => {
    let action: unknown
    const start: GuiObservation = { ...observation("a"), candidates: [{ id: "candidate-1", target: element("@e1"), role: "text field", label: "Search", action: "type_text", slotId: "query" }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async (_observation, next) => { action = next; return { observation: observation("b", "complete"), outcome: "worked" } } }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [{ id: "fill-query", kind: "fill", purpose: "search query", slotId: "query" }], textSlots: [{ id: "query", value: "private value", description: "search query" }], completion: { requiredText: ["complete"], requiredSlots: ["query"] }, scope: { allow: ["type_text"] } }, driver, decide: async () => decision("TYPE_TEXT", "candidate-1") })
    expect(result.status).toBe("done")
    expect(action).toEqual({ action: "typeText", target: element("@e1"), text: "private value", slotId: "query" })
    expect(JSON.stringify(result)).not.toContain("private value")
  })

  test("offers required slot actions before unrelated clicks and scrolls", async () => {
    const start: GuiObservation = { ...observation("a"), candidates: [
      { id: "candidate-1", target: element("@button"), role: "button", label: "Other", action: "click" },
      { id: "candidate-2", target: element("@field"), role: "text field", label: "Field", action: "type_text", slotId: "query" },
      { id: "candidate-3", target: { kind: "point", captureId: "state-a", regionId: "viewport", x: 10, y: 10 }, role: "viewport", label: "Viewport", action: "scroll", scrollY: 100 },
    ] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => ({ observation: observation("b", "complete"), outcome: "worked" }) }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [{ id: "fill-query", kind: "fill", purpose: "query", slotId: "query" }], textSlots: [{ id: "query", value: "value", description: "query" }], completion: { requiredText: ["complete"], requiredSlots: ["query"] }, scope: { allow: ["type_text"] } }, driver, decide: async (goal, candidates) => {
      expect(goal).toContain("Typed plan phase fill-query")
      expect(goal).toContain("query")
      expect(goal).not.toContain('"value"')
      expect(candidates.map(candidate => candidate.id)).toEqual(["candidate-2"])
      return decision("TYPE_TEXT", "candidate-2")
    } })
    expect(result.status).toBe("done")
  })

  test("keeps an explicitly planned choose action available", async () => {
    const start: GuiObservation = { ...observation("a"), candidates: [{ id: "candidate-1", target: element("@button"), role: "button", label: "Open form", action: "click" }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => ({ observation: observation("b", "complete"), outcome: "worked" }) }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [{ id: "open-form", kind: "choose", purpose: "open form", action: "click", expect: { requiredText: ["complete"] } }], budget: { maxActions: 1, maxDecisions: 1, maxDurationMs: 10_000 } }, driver, decide: async (_goal, candidates) => {
      expect(candidates.map(candidate => candidate.id)).toEqual(["candidate-1"])
      return decision("CLICK", "candidate-1")
    } })
    expect(result.status).toBe("done")
  })

  test("offers a filled slot's structurally related action before unrelated controls", async () => {
    const start: GuiObservation = { ...observation("a"), presentSlotIds: ["query"], candidates: [
      { id: "candidate-1", target: element("@other"), role: "button", label: "Other", action: "click" },
      { id: "candidate-2", target: element("@submit"), role: "button", label: "Submit", action: "click", afterSlotIds: ["query"] },
    ] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => ({ observation: observation("b", "complete"), outcome: "worked" }) }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [
      { id: "fill-query", kind: "fill", purpose: "query", slotId: "query" },
      { id: "submit-query", kind: "activate", purpose: "submit query", afterSlotId: "query", expect: { requiredText: ["complete"] } },
    ], textSlots: [{ id: "query", value: "value", description: "query" }], completion: { requiredText: ["complete"], requiredSlots: ["query"] }, scope: { allow: ["click", "type_text"] } }, driver, decide: async (goal, candidates) => {
      expect(goal).toContain("Typed plan phase submit-query")
      expect(candidates.map(candidate => candidate.id)).toEqual(["candidate-2"])
      return decision("CLICK", "candidate-2")
    } })
    expect(result.status).toBe("done")
  })

  test("does not accept a preexisting state-only postcondition as action proof", async () => {
    const start: GuiObservation = { ...observation("a", "complete"), candidates: [{ id: "candidate-1", target: element("@submit"), role: "button", label: "Submit", action: "click" }] }
    let actions = 0
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async current => { actions++; return { observation: current, outcome: "unknown" } } }
    const result = await runGuiTaskEngine({ input: { ...input(["other terminal proof"]), steps: [{ id: "submit", kind: "choose", purpose: "submit", action: "click", expect: { requiredText: ["complete"] } }] }, driver, decide: async () => decision("CLICK", "candidate-1") })
    expect(result.status).toBe("blocked")
    expect(actions).toBe(0)
    expect(result.trace.at(-1)?.note).toContain("already satisfied")
  })

  test("proves submission from a changed collection instead of a preexisting collection", async () => {
    const before: GuiObservation = { ...observation("a"), candidates: [{ id: "candidate-1", target: element("@submit"), role: "button", label: "Submit", action: "click" }], collections: [{ id: "collection-1", label: "old results", order: "reading", size: 2, items: [] }] }
    const after: GuiObservation = { ...observation("b", "complete"), collections: [{ id: "collection-1", label: "new results", order: "reading", size: 2, items: [] }] }
    const driver: GuiTaskDriver = { start: async () => before, refresh: async current => current, act: async () => ({ observation: after, outcome: "unknown" }) }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [{ id: "submit", kind: "choose", purpose: "submit", action: "click", expect: { collectionChanged: true } }] }, driver, decide: async () => decision("CLICK", "candidate-1") })
    expect(result.status).toBe("done")
  })

  test("offers only the locally grounded ordinal during a select phase", async () => {
    const start: GuiObservation = { ...observation("a"), candidates: [
      { id: "candidate-1", target: element("@first"), role: "card", label: "First", action: "click" },
      { id: "candidate-2", target: element("@fifth"), role: "card", label: "Fifth", action: "click" },
    ], collections: [{ id: "collection-1", label: "6-item video result collection", order: "reading", size: 6, items: [{ candidateId: "candidate-1", ordinal: 1 }, { candidateId: "candidate-2", ordinal: 5 }] }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => ({ observation: observation("b", "complete"), outcome: "worked" }) }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [{ id: "select-fifth", kind: "select", purpose: "result cards", index: 5, order: "reading" }] }, driver, decide: async (goal, candidates) => {
      expect(goal).toContain("item 5")
      expect(candidates.map(candidate => candidate.id)).toEqual(["candidate-2"])
      return decision("CLICK", "candidate-2")
    } })
    expect(result.status).toBe("done")
  })

  test("lets Jev choose the collection while local code owns the requested ordinal", async () => {
    const start: GuiObservation = { ...observation("a"), candidates: [
      { id: "candidate-filter-5", target: element("@filter-5"), role: "chip", label: "Filter five", action: "click" },
      { id: "candidate-video-5", target: element("@video-5"), role: "card", label: "Actual fifth video", action: "click" },
    ], collections: [
      { id: "collection-filters", label: "8-item filter chip collection; samples: All | Dance | Photo", order: "reading", size: 8, items: [{ candidateId: "candidate-filter-5", ordinal: 5 }] },
      { id: "collection-videos", label: "12-item video card collection; samples: First video | Second video", order: "reading", size: 12, items: [{ candidateId: "candidate-video-5", ordinal: 5 }] },
    ] }
    let acted: unknown
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async (_current, action) => { acted = action; return { observation: observation("b", "complete"), outcome: "worked" } } }
    const result = await runGuiTaskEngine({ input: { ...input(), steps: [{ id: "select-fifth", kind: "select", purpose: "video result cards", index: 5, order: "reading" }] }, driver, decide: async (_goal, candidates) => {
      expect(candidates.map(candidate => candidate.label)).toEqual([
        "8-item filter chip collection; samples: All | Dance | Photo",
        "12-item video card collection; samples: First video | Second video",
      ])
      return decision("CLICK", "select:collection-videos:5")
    } })
    expect(acted).toEqual({ action: "click", target: element("@video-5") })
    expect(result.trace[0].candidate).toMatchObject({ collection: { id: "collection-videos", ordinal: 5 }, selectedItemLabel: "Actual fifth video" })
  })

  test("verifies structured control state without asking Jev", async () => {
    const ready = { ...observation("a"), controls: [{ label: "Dark mode", role: "checkbox", checked: true }] }
    let decisions = 0
    const driver: GuiTaskDriver = { start: async () => ready, refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: { ...input([]), completion: { requiredText: [], controls: [{ label: "Dark mode", role: "checkbox", checked: true }] } }, driver, decide: async () => { decisions++; throw new Error("must not decide") } })
    expect(result.status).toBe("done")
    expect(decisions).toBe(0)
  })

  test("keeps confirmed text-slot evidence across later observations", async () => {
    const start = { ...observation("a"), candidates: [{ id: "candidate-1", target: element("@e1"), role: "text field", label: "Field", action: "type_text" as const, slotId: "query" }] }
    const driver: GuiTaskDriver = { start: async () => start, refresh: async current => current, act: async () => ({ observation: { ...observation("b"), mediaTracks: { player: 1 } }, outcome: "worked" }) }
    const result = await runGuiTaskEngine({ input: { ...input([]), steps: [{ id: "fill-query", kind: "fill", purpose: "query", slotId: "query" }], textSlots: [{ id: "query", value: "value", description: "query" }], completion: { requiredText: [], requiredSlots: ["query"] }, scope: { allow: ["type_text"] }, budget: { maxActions: 1, maxDecisions: 1, maxDurationMs: 10_000 } }, driver, decide: async () => decision("TYPE_TEXT", "candidate-1") })
    expect(result.status).toBe("done")
  })

  test("does not reuse a preexisting media track as evidence after required input", async () => {
    let decisions = 0
    const first = { ...observation("a"), presentSlotIds: ["query"], mediaTracks: { oldPlayer: 10 } }
    const driver: GuiTaskDriver = { start: async () => first, refresh: async current => current, act: async () => { throw new Error("must not act") } }
    const result = await runGuiTaskEngine({ input: { ...input([]), textSlots: [{ id: "query", value: "value", description: "query" }], completion: { requiredText: [], requiredSlots: ["query"], mediaPlayback: { sampleIntervalMs: 1, minAdvanceSeconds: 1 } } }, driver, decide: async () => { decisions++; return decision("BLOCKED") } })
    expect(result.status).toBe("blocked")
    expect(decisions).toBe(1)
  })
})
