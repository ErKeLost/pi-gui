import type { CompletionSpec, ControlCondition, ControlSnapshot, GuiObservation, VerificationResult } from "./gui-task-contract.ts"

export function verifyCompletion(observation: GuiObservation, completion: CompletionSpec, previous?: GuiObservation, satisfiedSlots: ReadonlySet<string> = new Set(observation.presentSlotIds), excludedMediaTracks: ReadonlySet<string> = new Set()): VerificationResult {
  const reasons: string[] = []
  const text = observation.verificationContext
  if (completion.appReady && observation.targetReady !== true) reasons.push("desktop target is not ready")
  ;(completion.requiredText ?? []).forEach((expected, index) => { if (!text.includes(expected)) reasons.push(`required text condition ${index + 1} is not satisfied`) })
  ;(completion.requiredSlots ?? []).forEach(id => { if (!satisfiedSlots.has(id)) reasons.push(`required text slot is not satisfied: ${id}`) })
  ;(completion.forbiddenText ?? []).forEach((forbidden, index) => { if (text.includes(forbidden)) reasons.push(`forbidden text condition ${index + 1} is present`) })
  if (completion.urlIncludes && !observation.url.includes(completion.urlIncludes)) reasons.push("URL condition is not satisfied")
  if (completion.titleIncludes && !observation.title.includes(completion.titleIncludes)) reasons.push("title condition is not satisfied")
  for (const condition of completion.controls ?? []) verifyControl(observation.controls, condition, reasons)
  let needsMediaSample = false
  if (completion.mediaPlayback) {
    const eligibleTracks = Object.entries(observation.mediaTracks).filter(([ref]) => !excludedMediaTracks.has(ref))
    if (eligibleTracks.length === 0) {
      reasons.push("media playback track is not observed")
    } else if (!previous) {
      reasons.push("media playback requires a second observation")
      needsMediaSample = reasons.length === 1
    } else {
      const elapsed = observation.capturedAt - previous.capturedAt
      const advanced = eligibleTracks.some(([ref, current]) => {
        const before = previous.mediaTracks[ref]
        return before !== undefined && current - before >= completion.mediaPlayback!.minAdvanceSeconds
      })
      if (elapsed < completion.mediaPlayback.sampleIntervalMs || !advanced) reasons.push("media playback progress is not verified")
    }
  }
  return { passed: reasons.length === 0, reasons, needsMediaSample: needsMediaSample || undefined }
}

function verifyControl(controls: ControlSnapshot[], condition: ControlCondition, reasons: string[]): void {
  const matches = controls.filter(control => control.label === condition.label && (!condition.role || canonicalRole(control.role) === canonicalRole(condition.role)))
  if (condition.present === false) {
    if (matches.length) reasons.push(`control still present: ${condition.label}`)
    return
  }
  if (matches.length !== 1) {
    reasons.push(matches.length ? `control is ambiguous: ${condition.label}` : `control is missing: ${condition.label}`)
    return
  }
  const control = matches[0]
  if (condition.checked !== undefined && control.checked !== condition.checked) reasons.push(`control checked state differs: ${condition.label}`)
  if (condition.selected !== undefined && control.selected !== condition.selected) reasons.push(`control selected state differs: ${condition.label}`)
  if (condition.valueEquals !== undefined && control.value !== condition.valueEquals) reasons.push(`control value differs: ${condition.label}`)
  if (condition.valueIncludes !== undefined && !control.value?.includes(condition.valueIncludes)) reasons.push(`control value does not include expected text: ${condition.label}`)
}

export function canonicalRole(value: string): string {
  const role = value.toLowerCase().replace(/[\s_-]/g, "").replace(/^ax/, "")
  if (["button", "pushbutton"].includes(role)) return "button"
  if (["statictext", "text", "label"].includes(role)) return "text"
  if (["textfield", "searchfield", "textbox", "editabletext"].includes(role)) return "text_field"
  if (["textarea", "textview"].includes(role)) return "text_area"
  if (["checkbox", "checkbutton"].includes(role)) return "checkbox"
  if (["radiobutton", "radio"].includes(role)) return "radio"
  if (["group", "container", "pane"].includes(role)) return "group"
  if (["image", "img", "graphic"].includes(role)) return "image"
  if (["tab", "tabitem"].includes(role)) return "tab"
  if (["listitem", "row"].includes(role)) return "list_item"
  return role
}
