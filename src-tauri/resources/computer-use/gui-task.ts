import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { decide } from "./jev.ts"
import { runGuiTaskEngine, type GuiTaskInput } from "./gui-task-engine.ts"
import { createPiComputerUseDriver } from "./pi-computer-use-driver.ts"

export function registerGuiTask(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gui_task",
    label: "GUI task",
    description: "Complete one visible desktop or browser task through the internal Jev decision loop.",
    promptGuidelines: ["Call once with the complete GUI goal. Pass url, app, and exact text when known."],
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string" },
        url: { type: "string" },
        app: { type: "string" },
        text: { type: "string" },
        maxSteps: { type: "integer", minimum: 1, maximum: 16 },
      },
      required: ["goal"],
      additionalProperties: false,
    } as const,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as GuiTaskInput
      try {
        const result = await runGuiTaskEngine({ input, driver: createPiComputerUseDriver(ctx, signal), decide, signal })
        return { content: [{ type: "text", text: `[${result.status}] ${input.goal}\n${result.evidence}` }], details: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { content: [{ type: "text", text: `[error] ${message}` }], details: { status: "error", message } }
      }
    },
  })
}
