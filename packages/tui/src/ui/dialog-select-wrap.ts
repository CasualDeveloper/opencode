import { TextBuffer, TextBufferView, type WidthMethod } from "@opentui/core"

type Grapheme = {
  text: string
  width: number
  whitespace: boolean
}

type Line = {
  graphemes: Grapheme[]
  width: number
}

const grapheme = new Intl.Segmenter(undefined, { granularity: "grapheme" })
// Wrapping is synchronous, so reuse one process-lifetime native buffer per renderer width mode.
const measurements = new Map<WidthMethod, { buffer: TextBuffer; view: TextBufferView }>()

export function wrap(text: string, width: number, widthMethod: WidthMethod) {
  const normalized = text.replace(/[^\S ]+/g, " ")
  if (width <= 0) return normalized
  const cache = new Map<string, number>()
  const tokens = normalized.match(/\s+|\S+/g) ?? []
  const lines: Line[] = [{ graphemes: [], width: 0 }]
  let breakBeforeWord = false
  let truncated = false

  tokenLoop: for (const token of tokens) {
    const whitespace = /^\s+$/.test(token)
    const parts = Array.from(grapheme.segment(token), (part) => {
      const measured = cache.get(part.segment) ?? measure(part.segment, widthMethod)
      cache.set(part.segment, measured)
      return { text: part.segment, width: measured, whitespace }
    })
    const tokenWidth = parts.reduce((total, part) => total + part.width, 0)
    const current = lines.at(-1)!

    if (whitespace) {
      if (current.width + tokenWidth <= width) append(current, parts)
      else breakBeforeWord = current.graphemes.length > 0
      continue
    }

    if (breakBeforeWord && current.graphemes.length > 0) {
      if (lines.length === 2) {
        truncated = true
        break
      }
      lines.push({ graphemes: [], width: 0 })
    }
    breakBeforeWord = false

    const line = lines.at(-1)!
    if (line.width > 0 && line.width + tokenWidth > width) {
      trimEnd(line)
      if (lines.length === 2) {
        truncated = true
        break
      }
      lines.push({ graphemes: [], width: 0 })
    }

    for (const part of parts) {
      const target = lines.at(-1)!
      if (part.width > width) {
        truncated = true
        break tokenLoop
      }
      if (target.width + part.width > width) {
        if (lines.length === 2) {
          truncated = true
          break tokenLoop
        }
        lines.push({ graphemes: [], width: 0 })
      }
      append(lines.at(-1)!, [part])
    }
  }

  if (!truncated) return lines.map(toText).join("\n")
  const ellipsis = ".".repeat(Math.min(width, 3))
  const last = lines.at(-1)!
  trimEnd(last)
  while (last.graphemes.length > 0 && last.width + ellipsis.length > width) {
    last.width -= last.graphemes.pop()!.width
    trimEnd(last)
  }
  return lines
    .map(toText)
    .slice(0, -1)
    .concat(`${toText(last)}${ellipsis}`)
    .join("\n")
}

function measure(text: string, widthMethod: WidthMethod) {
  if (text.length === 1 && text.charCodeAt(0) >= 0x20 && text.charCodeAt(0) <= 0x7e) return 1
  const current = getMeasurement(widthMethod)
  current.buffer.setText(text)
  return current.view.logicalLineInfo.lineWidthColsMax
}

function getMeasurement(widthMethod: WidthMethod) {
  const cached = measurements.get(widthMethod)
  if (cached) return cached
  const buffer = TextBuffer.create(widthMethod)
  const view = TextBufferView.create(buffer)
  view.setWrapMode("none")
  const result = { buffer, view }
  measurements.set(widthMethod, result)
  return result
}

function append(line: Line, parts: Grapheme[]) {
  line.graphemes.push(...parts)
  line.width += parts.reduce((total, part) => total + part.width, 0)
}

function trimEnd(line: Line) {
  while (line.graphemes.at(-1)?.whitespace) line.width -= line.graphemes.pop()!.width
}

function toText(line: Line) {
  return line.graphemes.map((part) => part.text).join("")
}
