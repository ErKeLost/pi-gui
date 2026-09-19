import { describe, expect, test } from "bun:test"
import { applyComputerUseMode, COMPUTER_USE_TOOL_NAMES } from "../src-tauri/resources/computer-use/mode"

describe("computer use tool gating", () => {
  test("keeps coding tools and only toggles known computer-use names", () => {
    const available = ["read", "bash", "observe_ui", "act_ui"]
    expect(applyComputerUseMode(["read", "observe_ui"], available, false)).toEqual(["read"])
    expect(applyComputerUseMode(["read"], available, true).sort()).toEqual(["act_ui", "observe_ui", "read"])
  })

  test("ignores computer-use names that were not loaded", () => {
    expect(applyComputerUseMode(["read"], ["read", "bash"], true)).toEqual(["read"])
  })

  test("covers the public pi-computer-use tool surface", () => {
    expect(COMPUTER_USE_TOOL_NAMES).toContain("find_roots")
    expect(COMPUTER_USE_TOOL_NAMES).toContain("act_ui")
    expect(COMPUTER_USE_TOOL_NAMES).toContain("launch_browser")
  })
})
