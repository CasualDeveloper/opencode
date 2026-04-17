import { describe, expect, test } from "bun:test"
import { TextBuffer, TextBufferView, type WidthMethod } from "@opentui/core"
import { wrap } from "../../src/ui/dialog-select-wrap"

describe("dialog-select wrap", () => {
  test("uses the supplied title width without subtracting row chrome", () => {
    const result = wrap("x".repeat(150), 80, "unicode")

    expect(result.endsWith("...")).toBe(false)
    expect(result.split("\n").map((line) => line.length)).toEqual([80, 70])
  })

  test("does not merge words when repeated spaces cross a line boundary", () => {
    expect(wrap("12345678    x", 10, "unicode")).toBe("12345678\nx")
  })

  test("wraps to two lines with ellipsis", () => {
    const result = wrap("one two three four five six seven eight nine ten", 10, "unicode")
    const lines = result.split("\n")

    expect(lines.length).toBe(2)
    expect(lines.at(-1) ?? "").toContain("...")
  })

  test("wrap preserves whitespace when text already fits", () => {
    expect(wrap("Foo  Bar", 20, "unicode")).toBe("Foo  Bar")
  })

  test("wrap preserves repeated spaces when wrapping", () => {
    expect(wrap("Foo    Bar baz qux quux corge", 10, "unicode").startsWith("Foo    Bar")).toBe(true)
  })

  test("wraps text that only fits across multiple lines", () => {
    const lines = wrap("123456 123456", 10, "unicode").split("\n")

    expect(lines.length).toBe(2)
    expect(lines.every((line) => Bun.stringWidth(line) <= 10)).toBe(true)
  })

  test("wrap does not carry whitespace to the next line", () => {
    expect(
      wrap("12345 12 34567 x", 5, "unicode")
        .split("\n")
        .every((line) => !line.startsWith(" ")),
    ).toBe(true)
  })

  test("wrap normalizes hard whitespace before enforcing max lines", () => {
    const lines = wrap("a\nb\nc\nd\ne", 5, "unicode").split("\n")

    expect(lines.length).toBe(2)
    expect(lines.every((line) => Bun.stringWidth(line) <= 5)).toBe(true)
  })

  test("wrap respects display width for CJK", () => {
    const lines = wrap("你好世界 你好世界 你好世界", 10, "unicode").split("\n")

    expect(lines.length).toBe(2)
    expect(lines.every((line) => displayWidth(line, "unicode") <= 10)).toBe(true)
  })

  test("wrap chunks wide tokens by display width", () => {
    const lines = wrap("你好你好你好你好你好你好", 10, "unicode").split("\n")

    expect(lines.length).toBe(2)
    expect(lines.every((line) => displayWidth(line, "unicode") <= 10)).toBe(true)
  })

  test("uses the renderer wcwidth model for joined emoji", () => {
    const lines = wrap("👨‍👩‍👧‍👦".repeat(21), 80, "wcwidth").split("\n")

    expect(lines.length).toBe(2)
    expect(lines.at(-1)?.endsWith("...")).toBe(true)
    expect(lines.every((line) => displayWidth(line, "wcwidth") <= 80)).toBe(true)
  })

  test("wrap chunks long tokens", () => {
    const lines = wrap("supercalifragilisticexpialidocious", 10, "unicode").split("\n")

    expect(lines.length).toBe(2)
    expect(lines.at(-1) ?? "").toContain("...")
  })
})

function displayWidth(text: string, widthMethod: WidthMethod) {
  const buffer = TextBuffer.create(widthMethod)
  const view = TextBufferView.create(buffer)
  try {
    view.setWrapMode("none")
    buffer.setText(text)
    return view.logicalLineInfo.lineWidthColsMax
  } finally {
    view.destroy()
    buffer.destroy()
  }
}
