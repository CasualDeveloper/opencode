import { describe, expect, test } from "bun:test"
import { resolvePromptInputV2KeyAction } from "./keybind"

const keybinds = {
  submit: (event: KeyboardEvent) => event.key === "s" && event.metaKey,
  newline: (event: KeyboardEvent) => event.key === "Enter" && event.shiftKey,
}

function keyEvent(input: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">) {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    keyCode: 0,
    isComposing: false,
    ...input,
  } as KeyboardEvent
}

describe("prompt input v2 keybind resolution", () => {
  test("leaves bare Enter composition to the IME", () => {
    const action = resolvePromptInputV2KeyAction(
      keyEvent({ key: "Enter", isComposing: true }),
      {
        submit: () => false,
        newline: (event) => event.key === "Enter",
      },
      true,
    )

    expect(action).toBeUndefined()
  })

  test("keeps modified newline bindings available during composition", () => {
    const action = resolvePromptInputV2KeyAction(
      keyEvent({ key: "Enter", shiftKey: true, isComposing: true }),
      keybinds,
      true,
    )

    expect(action).toBe("newline")
  })

  test("ignores non-Enter newline bindings during composition", () => {
    const action = resolvePromptInputV2KeyAction(
      keyEvent({ key: "n", metaKey: true, isComposing: true }),
      {
        submit: () => false,
        newline: (event) => event.key === "n" && event.metaKey,
      },
      true,
    )

    expect(action).toBeUndefined()
  })

  test("ignores non-Enter submit bindings during composition", () => {
    const action = resolvePromptInputV2KeyAction(
      keyEvent({ key: "s", metaKey: true, isComposing: true }),
      keybinds,
      true,
    )

    expect(action).toBeUndefined()
  })

  test("recognizes arbitrary submit bindings", () => {
    const action = resolvePromptInputV2KeyAction(keyEvent({ key: "s", metaKey: true }), keybinds, false)

    expect(action).toBe("submit")
  })

  test("leaves unbound Enter chords without an action", () => {
    const action = resolvePromptInputV2KeyAction(keyEvent({ key: "Enter", altKey: true }), keybinds, false)

    expect(action).toBeUndefined()
  })
})
