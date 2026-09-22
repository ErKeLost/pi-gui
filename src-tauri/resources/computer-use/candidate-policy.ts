import type { ActionScope, GuiCollection, TextSlot } from "./gui-task-contract.ts"
import type { JevCandidate } from "./jev.ts"

export type Rect = { x: number; y: number; w: number; h: number }
export type OutlineNode = { ref?: string; role?: string; subrole?: string; title?: string; description?: string; value?: string; checked?: boolean; selected?: boolean; disabled?: boolean; rect?: Rect; text?: { string?: string; confidence?: number; rect?: Rect }[]; canPress?: boolean; canFocus?: boolean; focused?: boolean; canSetValue?: boolean; canScroll?: boolean; isTextInput?: boolean; pictureOnly?: boolean; offscreen?: boolean; inWebContent?: boolean; children?: OutlineNode[] }
export type VisualCapture = { stateId: string; width: number; height: number }
export type VisualRegion = { id: string; text: string; role: string; x: number; y: number; bounds: Rect; itemRef?: string }
export type CandidateSet = { candidates: JevCandidate[]; collections: GuiCollection[]; deferred: number }

export function collectCandidateSet(root: OutlineNode | undefined, scope: ActionScope, slots: TextSlot[], capture?: VisualCapture): CandidateSet {
  const candidates: JevCandidate[] = []
  let deferred = 0
  const allowed = new Set(scope.allow)
  const satisfiedSlots = slotsAlreadyPresent(root, slots)
  const relatedActions = relatedActionsForSlots(root, slots)
  const visualCardDescendants = capture ? collectVisualCardDescendants(root) : new WeakSet<OutlineNode>()
  const visit = (node: OutlineNode | undefined, path: string[], insideWebContent: boolean, ancestors: OutlineNode[]) => {
    if (!node) return
    const label = nodeLabel(node)
    const ownOrDescendant = label || descendantLabel(node)
    const context = [...path, ownOrDescendant].filter(Boolean).join(" > ")
    const descriptor = context || `unlabeled ${node.role || "element"}`
    const locallyDescribed = Boolean(ownOrDescendant)
    const webContent = insideWebContent || isWebContentRole(node.role)
    if (node.ref && !node.pictureOnly && !node.disabled && !node.offscreen) {
      const coarseImageContainer = Boolean(capture && isContainerRole(node.role) && hasImageDescendant(node))
      const nestedVisualCardAction = visualCardDescendants.has(node) && !isButtonRole(node.role)
      const coarseActionContainer = isContainerRole(node.role) && hasActionableDescendant(node)
      const elementTarget = { kind: "element" as const, ref: node.ref }
      const clickTarget = elementTarget
      const textTarget = capture && webContent
        ? node.rect && validRect(node.rect, capture)
          ? { kind: "point" as const, captureId: capture.stateId, regionId: `field:${node.ref}`, x: node.rect.x + node.rect.w / 2, y: node.rect.y + node.rect.h / 2 }
          : undefined
        : elementTarget
      if (allowed.has("click") && node.canPress && locallyDescribed && !coarseImageContainer && !nestedVisualCardAction && !coarseActionContainer) {
        candidates.push({ id: `click:${node.ref}`, target: clickTarget, role: node.role || "element", label: descriptor, action: "click", afterSlotIds: relatedActions.slotsByAction.get(node.ref), afterFieldKeys: relatedActions.fieldsByAction.get(node.ref), bounds: node.rect, itemRef: node.ref, state: { checked: node.checked, selected: node.selected, focused: node.focused } })
      } else if (allowed.has("click") && node.canPress && !locallyDescribed) {
        deferred++
      }
      if (allowed.has("scroll") && node.canScroll) {
        for (const deltaY of scope.scrollDeltas ?? []) candidates.push({ id: `scroll:${node.ref}:${deltaY}`, target: elementTarget, role: node.role || "element", label: descriptor, action: "scroll", scrollY: deltaY, state: {} })
      }
      const editable = isEditableText(node)
      const secure = node.role === "AXSecureTextField" || node.subrole === "AXSecureTextField"
      const fieldContext = editable && !label ? nearestSiblingContext(node, ancestors) : ""
      const fieldDescriptor = fieldContext ? `${descriptor} > nearby ${fieldContext}` : descriptor
      if (allowed.has("type_text") && editable && !secure) for (const slot of slots) if (!satisfiedSlots.has(slot.id)) {
        if (textTarget) candidates.push({ id: `type:${node.ref}:${slot.id}`, target: textTarget, role: node.role || "text field", label: `${fieldDescriptor}; input purpose=${slot.description}`, action: "type_text", slotId: slot.id, fieldKey: fieldIdentity(node), bounds: node.rect, itemRef: node.ref, state: { filled: Boolean(node.value), focused: node.focused } })
        else deferred++
      }
    }
    const nextPath = label ? [...path, label] : path
    for (const child of node.children ?? []) visit(child, nextPath, webContent, [...ancestors, node])
  }
  visit(root, [], false, [])

  if (capture) {
    const visual = collectVisualRegions(root, capture)
    deferred += visual.deferred
    for (const region of visual.regions) {
      const target = { kind: "point" as const, captureId: capture.stateId, regionId: region.id, x: region.x, y: region.y }
      if (allowed.has("click")) candidates.push({ id: `vclick:${region.id}`, target, role: region.role, label: region.text, action: "click", bounds: region.bounds, itemRef: region.itemRef, state: {} })
    }
    if (allowed.has("scroll")) {
      const target = { kind: "point" as const, captureId: capture.stateId, regionId: "viewport", x: capture.width / 2, y: capture.height / 2 }
      for (const deltaY of scope.scrollDeltas ?? []) candidates.push({ id: `vscroll:viewport:${deltaY}`, target, role: "viewport", label: "window viewport", action: "scroll", scrollY: deltaY, state: {} })
    }
  }

  const executable = removeDominatedSemanticClicks(candidates)
  const counts = new Map<string, number>()
  for (const candidate of executable) counts.set(candidateIdentity(candidate), (counts.get(candidateIdentity(candidate)) ?? 0) + 1)
  const positions = new Map<string, number>()
  const distinguishable = executable.map(candidate => {
    const identity = candidateIdentity(candidate)
    const count = counts.get(identity) ?? 1
    if (count === 1) return candidate
    const position = (positions.get(identity) ?? 0) + 1
    positions.set(identity, position)
    return { ...candidate, label: `${candidate.label}; occurrence ${position} of ${count} in observation order` }
  })
  const identified = distinguishable.map((candidate, index) => ({ ...candidate, id: `candidate-${index + 1}` }))
  return { candidates: identified, collections: collectStructuralCollections(root, identified), deferred }
}

export function nodeLabel(node: OutlineNode): string {
  const values: string[] = []
  const visibleValue = isReadOnlyLeafText(node) ? node.value : undefined
  const semanticFields = isImageRole(node.role) && !node.pictureOnly ? [] : [node.title, node.description]
  for (const value of [...semanticFields, visibleValue]) {
    const text = value?.replace(/\s+/g, " ").trim()
    if (text && !values.includes(text)) values.push(text)
  }
  return values.join(" ")
}

export function collectVisualRegions(root: OutlineNode | undefined, capture: VisualCapture): { regions: VisualRegion[]; deferred: number } {
  const regions: VisualRegion[] = []
  let deferred = 0
  const seen = new Set<string>()
  const add = (id: string, text: string | undefined, role: string, rect: Rect | undefined, bounds = rect, itemRef?: string) => {
    const normalized = text?.replace(/\s+/g, " ").trim()
    if (!normalized || !rect || !bounds || !validRect(rect, capture) || !validRect(bounds, capture)) {
      if (normalized || rect || bounds) deferred++
      return
    }
    const identity = `${normalized}:${rect.x}:${rect.y}:${rect.w}:${rect.h}`
    if (seen.has(identity)) return
    seen.add(identity)
    regions.push({ id, text: normalized, role, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, bounds, itemRef })
  }
  const visit = (node: OutlineNode | undefined, path: number[], secureAncestor: boolean, ancestors: OutlineNode[]) => {
    if (!node) return
    const id = path.length ? path.join(".") : "0"
    const secure = secureAncestor || node.role === "AXSecureTextField" || node.subrole === "AXSecureTextField"
    if (!secure) {
      if (node.pictureOnly) add(`p${id}`, nodeLabel(node), node.role || "visual text", node.rect, node.rect, node.ref)
      for (const [index, text] of (node.text ?? []).entries()) add(`p${id}.t${index}`, text.string, "visual text", text.rect)
      if (isImageRole(node.role)) {
        const card = visualContextOwner(node, ancestors)
        add(`p${id}.image`, card ? descendantLabel(card) : undefined, "visual image", node.rect, card?.rect ?? node.rect, card?.ref)
      }
    }
    for (const [index, child] of (node.children ?? []).entries()) visit(child, [...path, index], secure, [...ancestors, node])
  }
  visit(root, [], false, [])
  return { regions, deferred }
}

function validRect(rect: Rect, capture: VisualCapture): boolean {
  return [rect.x, rect.y, rect.w, rect.h, capture.width, capture.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0
    && rect.x + rect.w <= capture.width && rect.y + rect.h <= capture.height
}

function descendantLabel(node: OutlineNode, maxChars = 500): string {
  const values: string[] = []
  const queue = [...(node.children ?? [])]
  for (let index = 0; index < queue.length && values.join(" ").length < maxChars; index++) {
    const current = queue[index]
    const label = nodeLabel(current)
    if (label && !values.includes(label)) values.push(label)
    queue.push(...(current.children ?? []))
  }
  return values.join(" ").slice(0, maxChars)
}

function nearestSiblingContext(node: OutlineNode, ancestors: OutlineNode[]): string {
  for (let index = ancestors.length - 1; index >= 0; index--) {
    const ancestor = ancestors[index]
    const branch = index + 1 < ancestors.length ? ancestors[index + 1] : node
    const labels = (ancestor.children ?? [])
      .filter(child => child !== branch)
      .map(firstSemanticLabel)
      .filter((label): label is string => Boolean(label))
    if (labels.length) return [...new Set(labels)].join(" ")
  }
  return ""
}

function firstSemanticLabel(node: OutlineNode): string {
  const queue = [node]
  for (let index = 0; index < queue.length; index++) {
    const label = nodeLabel(queue[index])
    if (label) return label
    queue.push(...(queue[index].children ?? []))
  }
  return ""
}

function isReadOnlyLeafText(node: OutlineNode): boolean {
  return Boolean(node.value)
    && !node.canSetValue && !isEditableText(node) && !node.canPress && !node.canScroll
    && (node.children?.length ?? 0) === 0
    && !isImageRole(node.role)
    && node.role !== "AXSecureTextField" && node.subrole !== "AXSecureTextField"
}

function isImageRole(role: string | undefined): boolean {
  const normalized = role?.toLowerCase() ?? ""
  return normalized === "aximage" || normalized === "image" || normalized === "img" || normalized === "graphic"
}

function isEditableText(node: OutlineNode): boolean {
  if (node.isTextInput) return true
  const role = node.role?.toLowerCase() ?? ""
  return role === "axtextfield" || role === "axtextarea" || role === "axtextview" || role === "axsearchfield" || role === "axeditabletext" || role === "textbox" || role === "text field"
}

function isContainerRole(role: string | undefined): boolean {
  const normalized = role?.toLowerCase() ?? ""
  return normalized === "axgroup" || normalized === "group" || normalized === "container" || normalized === "pane"
}

function isWebContentRole(role: string | undefined): boolean {
  const normalized = role?.toLowerCase().replace(/[\s_-]/g, "") ?? ""
  return normalized === "axwebarea" || normalized === "webarea"
}

function visualContextOwner(node: OutlineNode, ancestors: OutlineNode[]): OutlineNode | undefined {
  const rect = node.rect
  if (rect) {
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const ancestor = ancestors[index]
      const candidate = ancestor.rect
      const role = ancestor.role?.toLowerCase() ?? ""
      const ownsAction = Boolean(ancestor.canPress && (isContainerRole(role) || role === "axlink" || role === "link"))
      const transparentPath = ancestors.slice(index + 1, -1).every(wrapper => (wrapper.children?.length ?? 0) === 1)
      if (!candidate || !ownsAction || !transparentPath || !descendantLabel(ancestor)) continue
      const contains = candidate.x <= rect.x && candidate.y <= rect.y && candidate.x + candidate.w >= rect.x + rect.w && candidate.y + candidate.h >= rect.y + rect.h
      const expands = candidate.w > rect.w || candidate.h > rect.h
      if (contains && expands) return ancestor
    }
  }
  return undefined
}

function collectVisualCardDescendants(root: OutlineNode | undefined): WeakSet<OutlineNode> {
  const descendants = new WeakSet<OutlineNode>()
  const mark = (node: OutlineNode) => {
    for (const child of node.children ?? []) {
      descendants.add(child)
      mark(child)
    }
  }
  const visit = (node: OutlineNode | undefined, ancestors: OutlineNode[]) => {
    if (!node) return
    if (isImageRole(node.role) && node.rect) {
      const owner = visualContextOwner(node, ancestors)
      const rect = owner?.rect
      if (owner && rect && Math.abs(rect.x - node.rect.x) <= 1 && Math.abs(rect.w - node.rect.w) <= 1 && rect.h > node.rect.h) mark(owner)
    }
    for (const child of node.children ?? []) visit(child, [...ancestors, node])
  }
  visit(root, [])
  return descendants
}

function isButtonRole(role: string | undefined): boolean {
  const normalized = role?.toLowerCase() ?? ""
  return normalized === "axbutton" || normalized === "button"
}

function hasImageDescendant(node: OutlineNode): boolean {
  const queue = [...(node.children ?? [])]
  for (let index = 0; index < queue.length; index++) {
    if (isImageRole(queue[index].role)) return true
    queue.push(...(queue[index].children ?? []))
  }
  return false
}

function hasActionableDescendant(node: OutlineNode): boolean {
  const queue = [...(node.children ?? [])]
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (current.canPress || current.canSetValue || current.canScroll || current.isTextInput) return true
    queue.push(...(current.children ?? []))
  }
  return false
}

function slotsAlreadyPresent(root: OutlineNode | undefined, slots: TextSlot[]): Set<string> {
  const satisfied = new Set<string>()
  const visit = (node: OutlineNode | undefined) => {
    if (!node) return
    const secure = node.role === "AXSecureTextField" || node.subrole === "AXSecureTextField"
    if (!secure && !node.inWebContent && isEditableText(node) && typeof node.value === "string") {
      for (const slot of slots) if (node.value === slot.value) satisfied.add(slot.id)
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return satisfied
}

function relatedActionsForSlots(root: OutlineNode | undefined, slots: TextSlot[]): { slotsByAction: Map<string, string[]>; fieldsByAction: Map<string, string[]> } {
  const relatedSlots = new Map<string, Set<string>>()
  const relatedFields = new Map<string, Set<string>>()
  const add = (ref: string, fieldRef: string, slotId: string) => {
    const ids = relatedSlots.get(ref) ?? new Set<string>()
    ids.add(slotId)
    relatedSlots.set(ref, ids)
    const fields = relatedFields.get(ref) ?? new Set<string>()
    fields.add(fieldRef)
    relatedFields.set(ref, fields)
  }
  const visit = (node: OutlineNode | undefined, ancestors: OutlineNode[]) => {
    if (!node) return
    if (!node.disabled && node.ref && isEditableText(node)) {
      for (let index = ancestors.length - 1; index >= 0; index--) {
        const ancestor = ancestors[index]
        const branch = index + 1 < ancestors.length ? ancestors[index + 1] : node
        const actions = (ancestor.children ?? []).filter(child => child !== branch).flatMap(nearestActionableNodes)
        const described = actions.filter(action => action.ref && nodeLabel(action))
        if (!described.length) continue
        for (const action of described) for (const slot of slots) add(action.ref!, fieldIdentity(node), slot.id)
        break
      }
    }
    for (const child of node.children ?? []) visit(child, [...ancestors, node])
  }
  visit(root, [])
  return {
    slotsByAction: new Map([...relatedSlots].map(([ref, ids]) => [ref, [...ids]])),
    fieldsByAction: new Map([...relatedFields].map(([ref, ids]) => [ref, [...ids]])),
  }
}

function fieldIdentity(node: OutlineNode): string {
  const rect = node.rect
  const geometry = rect ? [rect.x, rect.y, rect.w, rect.h].map(value => Math.round(value)).join(":") : "unknown"
  return `${(node.role || "field").toLowerCase()}:${geometry}`
}

function nearestActionableNodes(root: OutlineNode): OutlineNode[] {
  const queue = [root]
  for (let start = 0; start < queue.length;) {
    const end = queue.length
    const matches: OutlineNode[] = []
    for (let index = start; index < end; index++) {
      const node = queue[index]
      if (node.ref && node.canPress && !node.disabled && !node.offscreen) matches.push(node)
      else queue.push(...(node.children ?? []))
    }
    if (matches.length) return matches
    start = end
  }
  return []
}

function removeDominatedSemanticClicks(candidates: JevCandidate[]): JevCandidate[] {
  const imageLabels = candidates.filter(candidate => candidate.action === "click" && candidate.target.kind === "point" && candidate.role === "visual image").map(candidate => normalizeCandidateLabel(candidate.label))
  return candidates.filter(candidate => {
    if (candidate.action !== "click" || candidate.role === "visual image") return true
    const role = candidate.role.toLowerCase()
    if (!isContainerRole(role) && role !== "axlink" && role !== "link") return true
    const label = normalizeCandidateLabel(candidate.label.split(" > ").at(-1) ?? candidate.label)
    return !imageLabels.some(image => image !== label && (image.includes(label) || label.includes(image)))
  })
}

function collectStructuralCollections(root: OutlineNode | undefined, candidates: JevCandidate[]): GuiCollection[] {
  if (!root) return []
  const nodesByRef = new Map<string, OutlineNode>()
  const nodeIds = new WeakMap<OutlineNode, string>()
  const ancestors = new Map<string, OutlineNode[]>()
  const depths = new Map<string, number>()
  let nextNodeId = 1
  const visit = (node: OutlineNode, path: OutlineNode[]) => {
    const nodeId = `node-${nextNodeId++}`
    nodeIds.set(node, nodeId)
    depths.set(nodeId, path.length)
    if (node.ref) {
      nodesByRef.set(node.ref, node)
      ancestors.set(node.ref, path)
    }
    for (const child of node.children ?? []) visit(child, [...path, node])
  }
  visit(root, [])

  const byOwner = new Map<string, JevCandidate>()
  for (const candidate of candidates) {
    if (candidate.action !== "click" || !candidate.itemRef || !candidate.bounds || !usableBounds(candidate.bounds) || !nodesByRef.has(candidate.itemRef)) continue
    const current = byOwner.get(candidate.itemRef)
    if (!current || collectionCandidatePriority(candidate) > collectionCandidatePriority(current)) byOwner.set(candidate.itemRef, candidate)
  }

  const byShape = new Map<string, JevCandidate[]>()
  for (const candidate of byOwner.values()) {
    const shape = itemShape(nodesByRef.get(candidate.itemRef!)!)
    const group = byShape.get(shape) ?? []
    group.push(candidate)
    byShape.set(shape, group)
  }

  const discovered = new Map<string, { container: OutlineNode; items: JevCandidate[] }>()
  for (const shapedItems of byShape.values()) {
    const containers = new Map<string, JevCandidate[]>()
    for (const candidate of shapedItems) {
      for (const ancestor of ancestors.get(candidate.itemRef!) ?? []) {
        const containerId = nodeIds.get(ancestor)!
        const group = containers.get(containerId) ?? []
        group.push(candidate)
        containers.set(containerId, group)
      }
    }
    for (const [containerId, rawItems] of containers) {
      const items = [...new Map(rawItems.map(candidate => [candidate.itemRef!, candidate])).values()]
      if (items.length < 2) continue
      const container = [...(ancestors.get(items[0].itemRef!) ?? [])].find(node => nodeIds.get(node) === containerId)
      if (!container) continue
      const branches = new Set(items.map(candidate => directBranch(container, candidate.itemRef!, ancestors)))
      if (branches.size < 2 || branches.has(undefined)) continue
      const itemKey = items.map(candidate => candidate.itemRef).sort().join("|")
      const current = discovered.get(itemKey)
      if (!current || (depths.get(containerId) ?? 0) > (depths.get(nodeIds.get(current.container) ?? "") ?? 0)) discovered.set(itemKey, { container, items })
    }
  }

  return [...discovered.values()]
    .sort((left, right) => collectionTop(left.items) - collectionTop(right.items) || collectionLeft(left.items) - collectionLeft(right.items))
    .map(({ container, items }, index) => {
      const ordered = readingOrder(items)
      return {
        id: `collection-${index + 1}`,
        label: collectionLabel(container, ordered),
        order: "reading" as const,
        size: ordered.length,
        items: ordered.map((candidate, ordinal) => ({ candidateId: candidate.id, ordinal: ordinal + 1 })),
      }
    })
}

function collectionCandidatePriority(candidate: JevCandidate): number {
  return (candidate.role === "visual image" ? 4 : 0) + (candidate.target.kind === "point" ? 2 : 0) + (candidate.label ? 1 : 0)
}

function usableBounds(bounds: Rect): boolean {
  return [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0
}

function itemShape(node: OutlineNode): string {
  let image = false
  let editable = false
  let nestedAction = false
  const visit = (current: OutlineNode) => {
    if (current !== node && current.canPress) nestedAction = true
    if (isImageRole(current.role)) image = true
    if (isEditableText(current)) editable = true
    for (const child of current.children ?? []) visit(child)
  }
  visit(node)
  const rect = node.rect
  return JSON.stringify({
    role: (node.role || "element").toLowerCase(),
    press: Boolean(node.canPress),
    scroll: Boolean(node.canScroll),
    image,
    editable,
    nestedAction,
    size: rect ? `${Math.round(rect.w)}:${Math.round(rect.h)}` : "unknown",
  })
}

function directBranch(container: OutlineNode, itemRef: string, ancestors: Map<string, OutlineNode[]>): OutlineNode | undefined {
  const path = [...(ancestors.get(itemRef) ?? []), { ref: itemRef } as OutlineNode]
  const containerIndex = path.findIndex(node => node === container)
  return containerIndex >= 0 ? path[containerIndex + 1] : undefined
}

function collectionLabel(container: OutlineNode, items: JevCandidate[]): string {
  const samples = items.slice(0, 4).map(candidate => localCandidateLabel(candidate.label)).filter(Boolean)
  const containerLabel = nodeLabel(container)
  return `${items.length}-item repeated ${items[0]?.role || "control"} collection${containerLabel ? ` in ${containerLabel}` : ""}; samples: ${samples.join(" | ")}`
}

function localCandidateLabel(label: string): string {
  return (label.split(" > ").at(-1) ?? label).replace(/; occurrence \d+ of \d+ in observation order$/, "").slice(0, 120)
}

function collectionTop(items: JevCandidate[]): number { return Math.min(...items.map(candidate => candidate.bounds!.y)) }
function collectionLeft(items: JevCandidate[]): number { return Math.min(...items.map(candidate => candidate.bounds!.x)) }

function readingOrder(candidates: JevCandidate[]): JevCandidate[] {
  const remaining = [...candidates].sort((left, right) => left.bounds!.y - right.bounds!.y || left.bounds!.x - right.bounds!.x)
  const ordered: JevCandidate[] = []
  while (remaining.length) {
    const seed = remaining.shift()!
    const seedBottom = seed.bounds!.y + seed.bounds!.h
    const row = [seed]
    for (let index = remaining.length - 1; index >= 0; index--) {
      const bounds = remaining[index].bounds!
      if (bounds.y < seedBottom && bounds.y + bounds.h > seed.bounds!.y) row.push(remaining.splice(index, 1)[0])
    }
    row.sort((left, right) => left.bounds!.x - right.bounds!.x)
    ordered.push(...row)
  }
  return ordered
}

function normalizeCandidateLabel(value: string): string {
  return value.replace(/; occurrence \d+ of \d+ in observation order$/, "").replace(/\s+/g, " ").trim()
}

function candidateIdentity(candidate: JevCandidate): string { return `${candidate.action}:${candidate.role}:${candidate.label}:${candidate.slotId || ""}:${candidate.fieldKey ?? ""}:${candidate.afterSlotIds?.join(",") ?? ""}:${candidate.afterFieldKeys?.join(",") ?? ""}:${candidate.collection?.id ?? ""}:${candidate.collection?.ordinal ?? ""}:${candidate.scrollY ?? ""}` }
