import { describe, expect, test } from "bun:test"
import { matchPromptKeybind, promptKeybindOptions } from "./keybinds"

function keyEvent(input: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key: "Enter", ...input })
}

describe("prompt keybind matching", () => {
  test("keeps prompt commands out of the global keymap", () => {
    expect(promptKeybindOptions({ submit: "Submit", newline: "Newline" }).map((option) => option.disabled)).toEqual([
      true,
      true,
    ])
  })

  test("preserves non-shift Enter submit variants without an override", () => {
    expect(matchPromptKeybind("submit", {}, keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("submit", {}, keyEvent({ metaKey: true }))).toBe(true)
    expect(matchPromptKeybind("submit", {}, keyEvent({ altKey: true }))).toBe(true)
  })

  test("preserves shifted Enter newline variants without an override", () => {
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true, ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true, metaKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true, altKey: true }))).toBe(true)
  })

  test("uses exact matching after an explicit override", () => {
    expect(matchPromptKeybind("submit", { submit: "enter" }, keyEvent({ ctrlKey: true }))).toBe(false)
    expect(matchPromptKeybind("submit", { submit: "ctrl+enter" }, keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", { newline: "shift+enter" }, keyEvent({ shiftKey: true, ctrlKey: true }))).toBe(
      false,
    )
  })

  test("prefers an explicit submit binding over the newline fallback", () => {
    const event = keyEvent({ ctrlKey: true, shiftKey: true })

    const overrides = { submit: "ctrl+shift+enter" }
    expect(matchPromptKeybind("newline", overrides, event)).toBe(false)
    expect(matchPromptKeybind("submit", overrides, event)).toBe(true)
  })

  test("does not restore defaults after clearing a binding", () => {
    expect(matchPromptKeybind("submit", { submit: "none" }, keyEvent())).toBe(false)
    expect(matchPromptKeybind("newline", { newline: "none" }, keyEvent({ shiftKey: true }))).toBe(false)
  })

  test("supports swapped submit and newline bindings", () => {
    const overrides = { submit: "shift+enter", newline: "enter" }
    expect(matchPromptKeybind("submit", overrides, keyEvent({ shiftKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", overrides, keyEvent())).toBe(true)
  })
})
