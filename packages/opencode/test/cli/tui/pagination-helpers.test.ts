import { describe, expect, test } from "bun:test"
import { evictFromEnd, evictFromStart, windowNewest, windowOldest } from "../../../src/cli/cmd/tui/util/pagination"
import type { Message } from "@opencode-ai/sdk/v2"

const make = (ids: string[]) =>
  ids.map(
    (id) =>
      ({
        id,
        sessionID: "ses_test",
        role: "user",
        agent: "default",
        model: { providerID: "test", modelID: "test" },
        time: { created: Date.now() },
      }) as Message,
  )

describe("tui pagination helpers", () => {
  test("window bounds skip pinned message", () => {
    const messages = make(["m1", "m2", "m3", "m4"])
    expect(windowOldest(messages, "m1")).toBe("m2")
    expect(windowNewest(messages, "m4")).toBe("m3")
  })

  test("evictFromStart skips pinned messages", () => {
    const messages = make(["m1", "m2", "m3", "m4", "m5"])
    const evicted = evictFromStart(messages, 2, "m2")
    expect(evicted.map((m) => m.id)).toEqual(["m1", "m3"])
    expect(messages.map((m) => m.id)).toEqual(["m2", "m4", "m5"])
  })

  test("evictFromEnd skips pinned messages", () => {
    const messages = make(["m1", "m2", "m3", "m4", "m5"])
    const evicted = evictFromEnd(messages, 2, "m4")
    expect(evicted.map((m) => m.id)).toEqual(["m5", "m3"])
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2", "m4"])
  })
})
