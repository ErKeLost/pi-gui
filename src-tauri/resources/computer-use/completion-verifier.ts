import type { CompletionSpec, ControlCondition, ControlSnapshot, GuiObservation, VerificationResult } from "./gui-task-contract.ts"

export function verifyCompletion(observation: GuiObservation, completion: CompletionSpec): VerificationResult {
  const reasons: string[] = []
  const text = observation.verificationContext
  completion.requiredText.forEach((expected, index) => { if (!text.includes(expected)) reasons.push(`required text condition ${index + 1} is not satisfied`) })
  ;(completion.forbiddenText ?? []).forEach((forbidden, index) => { if (text.includes(forbidden)) reasons.push(`forbidden text condition ${index + 1} is present`) })
  if (completion.urlIncludes && !observation.url.includes(completion.urlIncludes)) reasons.push("URL condition is not satisfied")
  if (completion.titleIncludes && !observation.title.includes(completion.titleIncludes)) reasons.push("title condition is not satisfied")
  for (const condition of completion.controls ?? []) verifyControl(observation.controls, condition, reasons)
  return { passed: reasons.length === 0, reasons }
}

function verifyControl(controls: ControlSnapshot[], condition: ControlCondition, reasons: string[]): void {
  const matches = controls.filter(control => control.label === condition.label && (!condition.role || control.role === condition.role))
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
