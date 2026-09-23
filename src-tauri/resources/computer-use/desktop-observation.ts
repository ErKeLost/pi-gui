import { createHash } from "node:crypto"
import type { AgentDesktopClient, DesktopBounds, DesktopNode, SnapshotData } from "./agent-desktop-client.ts"
import type { DesktopCandidate, DesktopObservation, TextSlot } from "./gui-task-contract.ts"

// A TypeSafe Choice accepts 255 options. Candidate limits apply per operation,
// so the same observed element may safely participate in several action heads.
const MAX_OBSERVED_ELEMENTS = 254
const OVERLAY_ROLES = new Set(["sheet", "alert", "menu", "popover"])

type FlatNode = DesktopNode & {
  path: string[]
  descendantSummary?: string
  siblingOrdinal?: number
  siblingCount?: number
  actionableAncestor?: { description: string; bounds?: DesktopBounds }
}

export async function observeDesktop(
  client: AgentDesktopClient,
  input: { app: string; windowId?: string; root?: string; textSlots: TextSlot[]; usedSlotIds: ReadonlySet<string>; allowPressEnter: boolean },
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<DesktopObservation> {
  const base = ["snapshot", "--app", input.app, "--compact", "--include-bounds"]
  if (input.windowId) base.push("--window-id", input.windowId)
  // The tree stays local. Keeping inert descendants lets an unnamed actionable
  // parent inherit the visible text that identifies it before Jev sees candidates.
  const args = input.root ? [...base, "--root", input.root] : [...base, "--skeleton"]
  let snapshot = (await client.run<SnapshotData>(args, options)).data!

  if (!input.root) {
    const surface = findOverlay(snapshot.tree)
    if (surface) {
      snapshot = (await client.run<SnapshotData>([...base, "--surface", surface, "--skeleton"], options)).data!
    }
  }

  const nodes = flatten(snapshot.tree)
    .filter(node => node.ref_id && !(node.states ?? []).some(state => state === "disabled" || state === "hidden"))
  const actionableNodes = nodes.filter(hasSupportedCapability)
  const offeredNodes = actionableNodes.slice(0, MAX_OBSERVED_ELEMENTS)
  let candidates = buildCandidates(offeredNodes, input.textSlots, input.usedSlotIds, Boolean(input.root), input.allowPressEnter, !snapshot.complete)
  const nextSlot = nextTextSlot(offeredNodes, input.textSlots, input.usedSlotIds)
  if (nextSlot && candidates.some(candidate => candidate.slotId === nextSlot.id && ["SET_VALUE", "TYPE_TEXT"].includes(candidate.operation))) {
    candidates = candidates.filter(candidate =>
      ["SET_VALUE", "TYPE_TEXT", "DRILL", "WIDEN"].includes(candidate.operation),
    )
  }
  const context = buildContext(snapshot, candidates, input.root, actionableNodes.length > offeredNodes.length)
  const fingerprint = createHash("sha256").update(JSON.stringify(nodes.map(node => ({
    role: node.role,
    name: node.name,
    description: node.description,
    value: visibleValue(node),
    states: node.states,
    actions: node.available_actions,
    childrenCount: node.children_count,
  })))).digest("hex")
  return {
    app: snapshot.app,
    windowId: snapshot.window.id,
    title: snapshot.window.title,
    surface: findOverlay(snapshot.tree) ?? "window",
    root: input.root,
    snapshotId: snapshot.snapshot_id,
    complete: snapshot.complete,
    capturedAt: Date.now(),
    candidates,
    context,
    fingerprint,
  }
}

function flatten(root: DesktopNode): FlatNode[] {
  const result: FlatNode[] = []
  const visit = (node: DesktopNode, path: string[], siblingOrdinal?: number, siblingCount?: number, actionableAncestor?: FlatNode["actionableAncestor"]) => {
    const label = node.name ?? node.description
    const descendantSummary = summarizeDescendants(node)
    const self = label
      ? `${node.role} "${sanitize(label, 160)}"`
      : descendantSummary && hasPrimaryCapability(node)
        ? `${node.role} containing "${sanitize(descendantSummary, 100)}"`
        : node.role
    if (node.ref_id) result.push({ ...node, path, descendantSummary, siblingOrdinal, siblingCount, actionableAncestor })
    const next = node.children?.length && path.at(-1) !== self ? [...path, self] : path
    const nextActionableAncestor = hasPrimaryCapability(node) && descendantSummary
      ? { description: self, bounds: node.bounds }
      : actionableAncestor
    const groups = groupSiblings(node.children ?? [])
    for (const [index, child] of (node.children ?? []).entries()) {
      const siblings = groups.get(siblingIdentity(child))!
      visit(child, next, siblings.indexOf(index) + 1, siblings.length, nextActionableAncestor)
    }
  }
  visit(root, [])
  return result
}

function groupSiblings(children: DesktopNode[]): Map<string, number[]> {
  const groups = new Map<string, number[]>()
  for (const [index, child] of children.entries()) {
    const identity = siblingIdentity(child)
    const indices = groups.get(identity) ?? []
    indices.push(index)
    groups.set(identity, indices)
  }
  return groups
}

function siblingIdentity(node: DesktopNode): string {
  const capabilities = (node.available_actions ?? [])
    .filter(action => !["RightClick", "ScrollTo", "SetFocus"].includes(action))
    .sort()
  return `${node.role}:${capabilities.join(",")}`
}

function buildCandidates(nodes: FlatNode[], slots: TextSlot[], used: ReadonlySet<string>, insideRoot: boolean, allowPressEnter: boolean, allowDrill: boolean): DesktopCandidate[] {
  const candidates: DesktopCandidate[] = []
  const nextSlot = nextTextSlot(nodes, slots, used)
  const add = (candidate: Omit<DesktopCandidate, "id">) => {
    candidates.push({ ...candidate, id: `candidate-${candidates.length + 1}` })
  }
  for (const node of nodes) {
    const ref = node.ref_id!
    const actions = new Set(node.available_actions ?? [])
    const descriptor = describeNode(node)
    const webContent = node.path.some(part => part.startsWith("webarea"))
    const offscreen = (node.states ?? []).includes("offscreen")
    if (offscreen && (actions.has("Click") || actions.has("SetValue") || actions.has("TypeText"))) {
      add({ operation: "SCROLL_TO", ref, headed: false, description: `${descriptor}; bring this observed target into the visible viewport before choosing its action` })
      continue
    }
    if (actions.has("Click") && !isEditableTextRole(node.role)) {
      add({ operation: "CLICK", ref, headed: webContent, description: `${descriptor}; delivery=${webContent ? "exact-window physical pointer" : "semantic accessibility"}` })
      if (webContent && node.role === "group" && !node.name && !node.description && (node.siblingCount ?? 0) > 1) {
        add({ operation: "DOUBLE_CLICK", ref, headed: true, description: `${descriptor}; activate this observed list item itself with two rapid verified pointer clicks` })
      }
    }
    if (actions.has("Toggle")) {
      add({ operation: "CHECK", ref, description: descriptor })
      add({ operation: "UNCHECK", ref, description: descriptor })
    }
    if (actions.has("Expand")) add({ operation: "EXPAND", ref, description: descriptor })
    if (actions.has("Collapse")) add({ operation: "COLLAPSE", ref, description: descriptor })
    if (actions.has("Scroll")) {
      add({ operation: "SCROLL_DOWN", ref, description: descriptor })
      add({ operation: "SCROLL_UP", ref, description: descriptor })
    }
    if (nextSlot && isEditableTextRole(node.role) && !(node.states ?? []).includes("secure")) {
      const purpose = sanitize(nextSlot.description, 180)
      const hasCurrentValue = typeof node.value === "string" && node.value.length > 0
      if (actions.has("SetValue")) add({ operation: "SET_VALUE", ref, slotId: nextSlot.id, description: `${descriptor}; replace with caller-prepared text for ${purpose}` })
      if (actions.has("TypeText") && !hasCurrentValue) {
        add({ operation: "TYPE_TEXT", ref, slotId: nextSlot.id, headed: webContent, description: `${descriptor}; enter caller-prepared text for ${purpose}; delivery=${webContent ? "exact-window physical keyboard" : "semantic text input"}` })
      }
    }
    const hasIdentity = Boolean(node.name || node.description || visibleValue(node) || node.native_id?.value)
    if (allowDrill && node.children_count && node.children_count > 0 && (!hasIdentity || !actions.has("Click"))) {
      add({ operation: "DRILL", ref, description: descriptor })
    }
  }
  if (allowPressEnter) add({ operation: "PRESS_ENTER", description: "Press Return to submit the value written by the immediately preceding text action." })
  if (insideRoot) add({ operation: "WIDEN", description: "Return from the current drilled region to the whole window." })
  add({ operation: "WAIT", description: "Wait briefly and obtain a fresh accessibility observation without mutating the app." })
  add({ operation: "DONE", description: "Every part of the user's goal is visibly satisfied in the current observation." })
  add({ operation: "BLOCKED", description: "No offered operation can safely make progress toward the goal." })
  return candidates
}

function nextTextSlot(nodes: FlatNode[], slots: TextSlot[], used: ReadonlySet<string>): TextSlot | undefined {
  return slots.find(slot => !used.has(slot.id) && !nodes.some(node => isEditableTextRole(node.role) && node.value === slot.value))
}

function hasSupportedCapability(node: FlatNode): boolean {
  const actions = new Set(node.available_actions ?? [])
  return Boolean(node.children_count) || ["Click", "Toggle", "Expand", "Collapse", "Scroll", "SetValue", "TypeText"].some(action => actions.has(action))
}

function hasPrimaryCapability(node: DesktopNode): boolean {
  const actions = new Set(node.available_actions ?? [])
  return ["Click", "Toggle", "Expand", "Collapse", "Scroll", "SetValue", "TypeText"].some(action => actions.has(action))
}

function describeNode(node: FlatNode): string {
  const label = node.name ?? node.description
  const derived = !label ? node.descendantSummary : undefined
  const embedded = !label && !derived && node.actionableAncestor
  const parts = [`${node.role}${label ? ` "${sanitize(label, 120)}"` : derived ? ` containing "${sanitize(derived, 90)}"` : embedded ? " embedded control" : ""}`]
  const value = visibleValue(node)
  if (value) parts.push(`holds "${sanitize(value, 120)}"`)
  if (node.states?.length) parts.push(`state=${node.states.join(",")}`)
  const path = node.path.slice(-5).join(" > ")
  if (path && !label && !derived) parts.push(`inside ${sanitize(path, 120)}`)
  if ((node.siblingCount ?? 0) > 1) parts.push(`item ${node.siblingOrdinal} of ${node.siblingCount} among sibling ${node.role} elements with the same capabilities`)
  if (node.children_count) parts.push(`contains ${node.children_count} items not shown`)
  if (embedded && node.bounds && node.actionableAncestor?.bounds?.width) {
    const position = Math.round(((node.bounds.x + node.bounds.width / 2 - node.actionableAncestor.bounds.x) / node.actionableAncestor.bounds.width) * 100)
    const placement = position <= 25 ? "leading" : position >= 75 ? "trailing" : "middle"
    parts.push(`${placement} embedded control at horizontal position ${position}% within ${sanitize(node.actionableAncestor.description, 140)}`)
  }
  if (!label && !derived && !value && node.bounds) parts.push(`at ${Math.round(node.bounds.x)},${Math.round(node.bounds.y)}`)
  return parts.join("; ").slice(0, 360)
}

function summarizeDescendants(node: DesktopNode): string | undefined {
  const values: string[] = []
  const visit = (current: DesktopNode) => {
    if (values.length >= 4) return
    const value = current.name ?? current.description ?? visibleValue(current)
    if (value && !values.includes(value)) values.push(value)
    for (const child of current.children ?? []) visit(child)
  }
  for (const child of node.children ?? []) visit(child)
  return values.length ? values.join(" · ") : undefined
}

function visibleValue(node: DesktopNode): string | undefined {
  if (!node.value || (node.states ?? []).includes("secure") || node.role.toLowerCase() === "securetextfield") return undefined
  if (node.value === node.name || node.value === node.description) return undefined
  return node.value
}

function isEditableTextRole(role: string): boolean {
  return ["textfield", "textarea", "searchfield", "textbox", "editabletext"].includes(role.toLowerCase().replace(/[\s_-]/g, ""))
}

function buildContext(snapshot: SnapshotData, candidates: DesktopCandidate[], root?: string, truncated = false): string {
  const descriptions = [...new Set(candidates.filter(candidate => candidate.ref).map(candidate => candidate.description))]
  const lines = descriptions.map((description, index) => `${index + 1}. ${description}`)
  const header = [
    `app=${snapshot.app}`,
    `window=${snapshot.window.title}`,
    `scope=${root ? "drilled region" : "full local accessibility tree"}`,
    `complete=${snapshot.complete}`,
    `candidate_space_truncated=${truncated}`,
  ].join("\n")
  const body = lines.length <= 40 ? lines.join("\n") : `${lines.slice(0, 20).join("\n")}\n... ${lines.length - 40} candidates omitted ...\n${lines.slice(-20).join("\n")}`
  const remaining = 16_000 - header.length - 2
  if (body.length <= remaining) return `${header}\n${body}`
  const marker = "\n... middle candidates omitted ...\n"
  const side = Math.floor((remaining - marker.length) / 2)
  return `${header}\n${body.slice(0, side)}${marker}${body.slice(-side)}`
}

function findOverlay(root: DesktopNode): string | undefined {
  const queue = [root]
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]
    if (OVERLAY_ROLES.has(node.role)) return node.role
    queue.push(...(node.children ?? []))
  }
  return undefined
}

function sanitize(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}
