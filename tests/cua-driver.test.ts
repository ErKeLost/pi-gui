import { describe, expect, test } from "bun:test"
import { semanticFingerprint } from "../src-tauri/resources/computer-use/cua-driver"

describe("Cua Driver adapter boundary", () => {
  test("keeps semantic action state stable across snapshot IDs", () => {
    const structured = { id: "candidate-1", target: { kind: "element" as const, ref: "snapshot-a:1" }, role: "AXButton", label: "Search", action: "click" as const, state: {} }
    const first = semanticFingerprint("Window", "", [structured])
    const second = semanticFingerprint("Window", "", [{ ...structured, target: { kind: "element" as const, ref: "snapshot-b:1" } }])
    expect(second).toBe(first)
    expect(semanticFingerprint("Window", "", [{ ...structured, label: "Submit" }])).not.toBe(first)
  })

  test("includes collection semantics in the state fingerprint", () => {
    const candidate = { id: "candidate-1", target: { kind: "element" as const, ref: "snapshot:1" }, role: "AXGroup", label: "Result", action: "click" as const, state: {} }
    const first = semanticFingerprint("Window", "", [candidate], [{ id: "collection-1", label: "results", order: "reading", size: 1, items: [{ candidateId: "candidate-1", ordinal: 1 }] }])
    const second = semanticFingerprint("Window", "", [candidate], [{ id: "collection-1", label: "filters", order: "reading", size: 1, items: [{ candidateId: "candidate-1", ordinal: 1 }] }])
    expect(second).not.toBe(first)
  })
})
