import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TerminalColors } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { DEFAULT_THEMES, addTheme, allThemes, generateSyntax, hasTheme, resolveTheme, terminalMode } from "../src/theme"
import { discoverThemes } from "../src/context/theme"
import { tmpdir } from "./fixture/fixture"

test("addTheme writes into module theme store", () => {
  const name = `plugin-theme-${Date.now()}`
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(allThemes()[name]).toBeDefined()
})

test("addTheme keeps first theme for duplicate names", () => {
  const name = `plugin-theme-keep-${Date.now()}`
  const one = structuredClone(DEFAULT_THEMES.opencode)
  const two = structuredClone(DEFAULT_THEMES.opencode)
  one.theme.primary = "#101010"
  two.theme.primary = "#fefefe"

  expect(addTheme(name, one)).toBe(true)
  expect(addTheme(name, two)).toBe(false)
  expect(allThemes()[name]!.theme.primary).toBe("#101010")
})

test("addTheme ignores entries without a theme object", () => {
  const name = `plugin-theme-invalid-${Date.now()}`
  expect(addTheme(name, { defs: { a: "#ffffff" } })).toBe(false)
  expect(allThemes()[name]).toBeUndefined()
})

test("hasTheme checks theme presence", () => {
  const name = `plugin-theme-has-${Date.now()}`
  expect(hasTheme(name)).toBe(false)
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(hasTheme(name)).toBe(true)
})

test("resolveTheme rejects circular color refs", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.defs = { ...item.defs, one: "two", two: "one" }
  item.theme.primary = "one"
  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

test("resolveTheme falls back to legacy XML/HTML syntax colors", () => {
  const theme = structuredClone(DEFAULT_THEMES.opencode)

  delete theme.theme.syntaxTag
  delete theme.theme.syntaxAttribute
  delete theme.theme.syntaxTagDelimiter

  const resolved = resolveTheme(theme, "dark")

  expect(resolved.syntaxTag).toBe(resolved.error)
  expect(resolved.syntaxAttribute).toBe(resolved.syntaxKeyword)
  expect(resolved.syntaxTagDelimiter).toBe(resolved.syntaxOperator)
})

test("resolveTheme honors explicit XML/HTML syntax tokens", () => {
  const syntaxTag = RGBA.fromInts(10, 20, 30)
  const syntaxAttribute = RGBA.fromInts(40, 50, 60)
  const syntaxTagDelimiter = RGBA.fromInts(70, 80, 90)

  const theme = structuredClone(DEFAULT_THEMES.opencode)
  theme.theme.syntaxTag = syntaxTag
  theme.theme.syntaxAttribute = syntaxAttribute
  theme.theme.syntaxTagDelimiter = syntaxTagDelimiter

  const resolved = resolveTheme(theme, "dark")

  expect(resolved.syntaxTag).toBe(syntaxTag)
  expect(resolved.syntaxAttribute).toBe(syntaxAttribute)
  expect(resolved.syntaxTagDelimiter).toBe(syntaxTagDelimiter)
})

test("generateSyntax maps XML/HTML scopes to syntax tokens", () => {
  const theme = structuredClone(DEFAULT_THEMES.opencode)
  theme.theme.syntaxTag = RGBA.fromInts(10, 20, 30)
  theme.theme.syntaxAttribute = RGBA.fromInts(40, 50, 60)
  theme.theme.syntaxTagDelimiter = RGBA.fromInts(70, 80, 90)

  const resolved = resolveTheme(theme, "dark")
  const syntax = generateSyntax(resolved)

  try {
    const styles = new Map(syntax.getAllStyles())
    expect(styles.get("tag")?.fg?.toInts()).toEqual(resolved.syntaxTag.toInts())
    expect(styles.get("tag.attribute")?.fg?.toInts()).toEqual(resolved.syntaxAttribute.toInts())
    expect(styles.get("tag.delimiter")?.fg?.toInts()).toEqual(resolved.syntaxTagDelimiter.toInts())
  } finally {
    syntax.destroy()
  }
})

function terminalColors(defaultBackground: string | null, palette: Array<string | null> = []): TerminalColors {
  return {
    palette,
    defaultForeground: null,
    defaultBackground,
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

test("terminalMode derives mode from refreshed background", () => {
  expect(terminalMode(terminalColors("#fbf1c7"))).toBe("light")
  expect(terminalMode(terminalColors("#1a1b26"))).toBe("dark")
})

test("terminalMode does not derive mode from ANSI slot zero", () => {
  expect(terminalMode(terminalColors(null, ["#000000"]))).toBeUndefined()
})

test("custom theme precedence follows directory order", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "project")
  await mkdir(path.join(global, "themes"), { recursive: true })
  await mkdir(path.join(project, "themes"), { recursive: true })
  await writeFile(path.join(global, "themes", "custom.json"), JSON.stringify({ source: "global" }))
  await writeFile(path.join(project, "themes", "custom.json"), JSON.stringify({ source: "project" }))

  await expect(discoverThemes([global, project])).resolves.toEqual({ custom: { source: "project" } })
})
