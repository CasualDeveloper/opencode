import { describe, expect, test } from "bun:test"
import { clearDraft, restoreDraft, saveDraft, takeDraft } from "../../src/component/prompt/draft-stash"
import { emptyPrompt } from "../../src/prompt/history"

// The Prompt component stashes an unsent draft in onCleanup and takes it back
// in onMount across route remounts, keyed by sessionID or undefined for home.

function draft(text: string, cursor = text.length) {
  return { prompt: { ...emptyPrompt(), text }, cursor }
}

describe("prompt draft stash", () => {
  test("failed admission restores only an empty originating slot and late acknowledgement clears only its matching draft", () => {
    const failed = draft("failed prompt")
    expect(restoreDraft("ses_restore", failed)).toBe(true)
    expect(clearDraft("ses_restore", draft("another prompt").prompt)).toBe(false)
    expect(clearDraft("ses_restore", failed.prompt)).toBe(true)
    const attachment = draft("")
    attachment.prompt.files = [{ uri: "data:image/png;base64,YQ==" }]
    saveDraft("ses_restore", attachment)
    expect(restoreDraft("ses_restore", failed)).toBe(false)
    expect(takeDraft("ses_restore")).toEqual(attachment)
  })

  test("tab-keyed drafts stay on the tab they were written in", () => {
    const two = draft("notes for session two")
    saveDraft("ses_two", two)

    // Switching to another tab or home finds nothing.
    expect(takeDraft("ses_one")).toBeUndefined()
    expect(takeDraft("home")).toBeUndefined()

    // Returning to the original tab restores exactly its draft, once.
    expect(takeDraft("ses_two")).toBe(two)
    expect(takeDraft("ses_two")).toBeUndefined()
  })

  test("each tab keeps its own draft, including home", () => {
    const one = draft("DRAFT-ONE")
    const home = draft("draft on home")
    saveDraft("ses_one", one)
    saveDraft(undefined, home)

    expect(takeDraft(undefined)).toBe(home)
    expect(takeDraft("ses_one")).toBe(one)
  })

  test("a newer draft for the same slot replaces the older one", () => {
    saveDraft("ses_a", draft("first"))
    const second = draft("second")
    saveDraft("ses_a", second)
    expect(takeDraft("ses_a")).toBe(second)
  })
})
