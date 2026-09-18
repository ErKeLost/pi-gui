import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { registerSubagentTools } from "./index.ts"

/** Minimal child extension. It intentionally contains no GUI/session helpers. */
export default function (pi: ExtensionAPI): void {
  registerSubagentTools(pi)
}
