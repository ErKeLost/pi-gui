import type { ActionScope, TextSlot } from "./gui-task-contract.ts"
import type { JevCandidate } from "./jev.ts"

export type OutlineNode = {
  ref?: string
  role?: string
  title?: string
  description?: string
  value?: string
  checked?: boolean
  selected?: boolean
  disabled?: boolean
  text?: { string?: string }[]
  actions?: string[]
  canPress?: boolean
  canSetValue?: boolean
  canScroll?: boolean
  isTextInput?: boolean
  pictureOnly?: boolean
  children?: OutlineNode[]
}

export type CandidateSet = { candidates: JevCandidate[]; deferred: number }

const MAX_CANDIDATES = 200
const consequential = /发送|发布|支付|付款|购买|下单|删除|清空|授权|允许|提交|上传|登录|安装|同意|转账|send\b|publish\b|pay\b|purchase\b|buy\b|delete\b|erase\b|grant\b|allow\b|submit\b|upload\b|sign.?in|log.?in|install\b|accept\b|transfer\b|checkout/i
const sensitive = /密码|密钥|令牌|验证码|password|passwd|api[_ -]?key|secret|bearer|secure.?text|one.?time.?code/i

export function collectCandidateSet(root: OutlineNode | undefined, scope: ActionScope, slots: TextSlot[], preferredText = ""): CandidateSet {
  const candidates: JevCandidate[] = []
  let deferred = 0
  const clickLabels = new Set(scope.clickLabels ?? [])
  const scrollLabels = new Set(scope.scrollLabels ?? [])
  const authorizedConsequentialLabels = new Set(scope.authorizedConsequentialLabels ?? [])
  const visit = (node?: OutlineNode) => {
    if (!node) return
    const label = nodeLabel(node)
    if (node.ref && !node.pictureOnly && !node.disabled && label) {
      const eligibleClick = node.canPress || node.actions?.some(action => /press|click/i.test(action))
      const eligibleScroll = node.canScroll || node.actions?.some(action => /scroll/i.test(action))
      const allowedClick = clickLabels.has(label) || (scope.mode === "observed_low_risk" && eligibleClick)
      const allowedScroll = scrollLabels.has(label) || (scope.mode === "observed_low_risk" && eligibleScroll)
      if (eligibleClick && allowedClick) {
        if (consequential.test(label) && !authorizedConsequentialLabels.has(label)) deferred++
        else candidates.push({ id: `click:${node.ref}`, ref: node.ref, role: node.role || "element", label, action: "click", state: { checked: node.checked, selected: node.selected } })
      }
      if (eligibleScroll && allowedScroll && !consequential.test(label)) {
        candidates.push({ id: `scroll-up:${node.ref}`, ref: node.ref, role: node.role || "element", label, action: "scroll_up", state: {} })
        candidates.push({ id: `scroll-down:${node.ref}`, ref: node.ref, role: node.role || "element", label, action: "scroll_down", state: {} })
      }
      const editable = node.canSetValue || node.isTextInput || node.actions?.some(action => /setvalue|settext|typetext/i.test(action))
      if (editable && !sensitive.test(label)) {
        for (const slot of slots) {
          if (slot.fieldLabel !== label || node.value === slot.value) continue
          candidates.push({ id: `type:${node.ref}:${slot.id}`, ref: node.ref, role: node.role || "text field", label, action: "type_text", slotId: slot.id, state: { filled: Boolean(node.value) } })
        }
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)

  const counts = new Map<string, number>()
  for (const candidate of candidates) counts.set(candidateIdentity(candidate), (counts.get(candidateIdentity(candidate)) ?? 0) + 1)
  const unambiguous = candidates.filter(candidate => counts.get(candidateIdentity(candidate)) === 1)
  deferred += candidates.length - unambiguous.length
  const tokens = preferredText.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2)
  unambiguous.sort((left, right) => relevance(right, tokens) - relevance(left, tokens))
  return { candidates: unambiguous.slice(0, MAX_CANDIDATES), deferred }
}

export function nodeLabel(node: OutlineNode): string {
  const values: string[] = []
  const visit = (current: OutlineNode, depth: number) => {
    if (depth > 3 || values.join(" ").length >= 160) return
    for (const value of [current.title, current.description, ...(current.text ?? []).map(item => item.string)]) {
      const text = value?.replace(/\s+/g, " ").trim()
      if (text && !values.includes(text)) values.push(text)
    }
    for (const child of current.children ?? []) visit(child, depth + 1)
  }
  visit(node, 0)
  return values.join(" ").slice(0, 160)
}

function candidateIdentity(candidate: JevCandidate): string {
  return `${candidate.action}:${candidate.role}:${candidate.label}:${candidate.slotId || ""}`
}

function relevance(candidate: JevCandidate, tokens: string[]): number {
  return 1 + tokens.reduce((sum, token) => sum + (candidate.label.toLocaleLowerCase().includes(token) ? 4 : 0), 0)
}
