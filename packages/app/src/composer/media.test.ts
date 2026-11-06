import { expect, test } from "bun:test"
import { setMediaBlobLoader } from "@/runtime/persistence/drafts"
import { pinPromptMedia } from "./media"

test("aborting a stalled media pin releases the caller without waiting for the loader", async () => {
  const loading = Promise.withResolvers<string | undefined>()
  const started = Promise.withResolvers<void>()
  const controller = new AbortController()
  const cancelled = new Error("disposed")
  setMediaBlobLoader("aborted-pin", () => {
    started.resolve()
    return loading.promise
  })
  try {
    const pinned = pinPromptMedia(
      [
        {
          type: "image",
          id: "attachment",
          filename: "shot.png",
          mime: "image/png",
          blob: { id: `media:${"a".repeat(64)}`, url: "" },
        },
      ],
      controller.signal,
    )
    await started.promise
    controller.abort(cancelled)
    // This sentinel lets the broken implementation fail without leaving the test hanging.
    const sentinel = new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 0))
    expect(await Promise.race([pinned.catch((error) => error), sentinel])).toBe(cancelled)
  } finally {
    loading.resolve(undefined)
    setMediaBlobLoader("aborted-pin", undefined)
  }
})
