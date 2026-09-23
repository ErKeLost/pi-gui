import { describe, expect, test } from "bun:test";
import { providerToolChars } from "../src-tauri/resources/context-payload";

describe("provider tool payload accounting", () => {
  test("counts OpenAI tool schemas, calls, and results", () => {
    const tools = [{ type: "function", function: { name: "read", parameters: { type: "object" } } }];
    const toolCalls = [{ id: "call-1", type: "function", function: { name: "read", arguments: "{}" } }];
    const toolResult = { role: "tool", tool_call_id: "call-1", content: "file contents" };
    const payload = {
      tools,
      messages: [
        { role: "user", content: "read a file" },
        { role: "assistant", content: "", tool_calls: toolCalls },
        toolResult,
      ],
    };
    expect(providerToolChars(payload)).toBe(
      JSON.stringify(tools).length + JSON.stringify(toolCalls).length + JSON.stringify(toolResult).length,
    );
  });

  test("counts Anthropic and Google tool blocks without ordinary messages", () => {
    const anthropicUse = { type: "tool_use", id: "1", name: "bash", input: { command: "pwd" } };
    const googleResult = { functionResponse: { name: "bash", response: { output: "/tmp" } } };
    const payload = {
      messages: [{ role: "assistant", content: [{ type: "text", text: "working" }, anthropicUse] }],
      contents: [{ role: "user", parts: [{ text: "continue" }, googleResult] }],
    };
    expect(providerToolChars(payload)).toBe(JSON.stringify(anthropicUse).length + JSON.stringify(googleResult.functionResponse).length);
  });
});
