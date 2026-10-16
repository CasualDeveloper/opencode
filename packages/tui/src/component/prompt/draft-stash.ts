import { isDuplicateEntry, type PromptInfo } from "../../prompt/history"

// Holds one in-progress draft per tab across Prompt remounts. A draft is
// consumed on take: restoring it moves it out of the stash, so a stale copy
// never shadows newer input.
export type DraftEntry = { prompt: PromptInfo; cursor: number }

const byTab = new Map<string | undefined, DraftEntry>()

export function takeDraft(sessionID: string | undefined) {
  const entry = byTab.get(sessionID)
  byTab.delete(sessionID)
  return entry
}

export function saveDraft(sessionID: string | undefined, entry: DraftEntry) {
  byTab.set(sessionID, entry)
}

export function hasDraftContent(prompt: PromptInfo) {
  return !!(
    prompt.text ||
    prompt.files?.length ||
    prompt.agents?.length ||
    prompt.skills?.length ||
    prompt.pasted.length
  )
}

export function restoreDraft(sessionID: string, entry: DraftEntry) {
  const current = byTab.get(sessionID)
  if (current && hasDraftContent(current.prompt)) return false
  byTab.set(sessionID, entry)
  return true
}

export function clearDraft(sessionID: string, prompt: PromptInfo) {
  if (!isDuplicateEntry(byTab.get(sessionID)?.prompt, prompt)) return false
  byTab.delete(sessionID)
  return true
}
