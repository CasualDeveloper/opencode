/** @jsxImportSource @opentui/solid */
import { createTestRenderer, setRendererCapabilities } from "@opentui/core/testing"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { render, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onCleanup, onMount } from "solid-js"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { tmpdir } from "../fixture/fixture"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../src/ui/dialog-select"
import { ToastProvider } from "../../src/ui/toast"

function OpenDialog(props: {
  options: DialogSelectOption<number>[]
  current?: number
  maxLines?: 1 | 2
  dynamicFooter?: { initial: string; next: string }
  onFooterReady?: (update: () => void) => void
}) {
  const dialog = useDialog()
  const [footer, setFooter] = createSignal(props.dynamicFooter?.initial ?? "")
  if (props.dynamicFooter) props.onFooterReady?.(() => setFooter(props.dynamicFooter!.next))
  onMount(() => {
    const options = props.dynamicFooter
      ? props.options.map((option) => ({ ...option, footer: <span>{footer()}</span> }))
      : props.options
    dialog.replace(
      <DialogSelect
        title="Sessions"
        options={options}
        current={props.current}
        maxLines={props.maxLines}
        skipFilter={true}
        preserveSelection={true}
      />,
    )
    dialog.setSize("large")
  })
  return null
}

function Harness(props: {
  root: string
  options: DialogSelectOption<number>[]
  current?: number
  maxLines?: 1 | 2
  dynamicFooter?: { initial: string; next: string }
  onFooterReady?: (update: () => void) => void
}) {
  const renderer = useRenderer()
  const config = createTuiResolvedConfig()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  return (
    <TestTuiContexts paths={{ state: path.join(props.root, "state") }}>
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={config}>
          <KVProvider>
            <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
              <ToastProvider>
                <DialogProvider>
                  <OpenDialog
                    options={props.options}
                    current={props.current}
                    maxLines={props.maxLines}
                    dynamicFooter={props.dynamicFooter}
                    onFooterReady={props.onFooterReady}
                  />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    </TestTuiContexts>
  )
}

async function renderDialog(input: {
  options: DialogSelectOption<number>[]
  current?: number
  maxLines?: 1 | 2
  width?: number
  height?: number
  widthMethod?: "unicode" | "wcwidth"
  dynamicFooter?: { initial: string; next: string }
}) {
  const tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "state"))
  await Bun.write(path.join(tmp.path, "state", "kv.json"), "{}")
  const app = await createTestRenderer({ width: input.width ?? 120, height: input.height ?? 30, useThread: false })
  if (input.widthMethod) setRendererCapabilities(app.renderer, { unicode: input.widthMethod })
  let updateFooter: (() => void) | undefined
  await render(
    () => (
      <Harness
        root={tmp.path}
        options={input.options}
        current={input.current}
        maxLines={input.maxLines}
        dynamicFooter={input.dynamicFooter}
        onFooterReady={(update) => (updateFooter = update)}
      />
    ),
    app.renderer,
  )
  for (let attempt = 0; attempt < 50; attempt++) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("Sessions")) break
    await Bun.sleep(10)
  }
  if (!app.captureCharFrame().includes("Sessions")) throw new Error("dialog did not render")
  for (let frame = 0; frame < 3; frame++) {
    await Bun.sleep(10)
    await app.renderOnce()
  }
  return {
    app,
    updateFooter,
    async cleanup() {
      app.renderer.destroy()
      await tmp[Symbol.asyncDispose]()
    },
  }
}

test("uses the full title width allocated by a large dialog", async () => {
  const title = "x".repeat(75)
  const dialog = await renderDialog({
    maxLines: 2,
    options: [{ title, value: 1 }],
  })
  try {
    const lines = matchingLines(dialog.app.captureCharFrame(), "xxxxx")
    expect(lines).toEqual([title])
  } finally {
    await dialog.cleanup()
  }
})

test("clamps overflowing titles to two lines with a final ellipsis", async () => {
  const dialog = await renderDialog({
    maxLines: 2,
    options: [{ title: "x".repeat(170), value: 1 }],
  })
  try {
    const lines = matchingLines(dialog.app.captureCharFrame(), "xxxxx")
    expect(lines.length).toBe(2)
    expect(lines.at(-1)?.endsWith("...")).toBe(true)
  } finally {
    await dialog.cleanup()
  }
})

test("uses Yoga width after gutter and footer allocation", async () => {
  const dialog = await renderDialog({
    maxLines: 2,
    options: [
      {
        title: "x".repeat(145),
        value: 1,
        footer: "workspace",
        gutter: () => <text>⋯ </text>,
      },
    ],
  })
  try {
    const frame = dialog.app.captureCharFrame()
    const lines = matchingLines(frame, "xxxxx")
    expect(frame).toContain("workspace")
    expect(lines.length).toBe(2)
    expect(lines.at(-1)?.endsWith("...")).toBe(true)
  } finally {
    await dialog.cleanup()
  }
})

test("keeps DialogSelect single-line by default", async () => {
  const dialog = await renderDialog({
    options: [{ title: "x".repeat(100), value: 1 }],
  })
  try {
    const lines = matchingLines(dialog.app.captureCharFrame(), "xxxxx")

    expect(lines.length).toBe(1)
    expect(lines[0]?.endsWith("…")).toBe(true)
  } finally {
    await dialog.cleanup()
  }
})

test("clamps joined emoji using the renderer wcwidth mode", async () => {
  const dialog = await renderDialog({
    maxLines: 2,
    widthMethod: "wcwidth",
    options: [{ title: "👨‍👩‍👧‍👦".repeat(21), value: 1 }],
  })
  try {
    const frame = dialog.app.captureCharFrame()
    const lines = matchingLines(frame, "👨")
    expect(dialog.app.renderer.widthMethod).toBe("wcwidth")
    expect(lines.length).toBe(2)
    expect(lines.at(-1)?.endsWith("...")).toBe(true)
  } finally {
    await dialog.cleanup()
  }
})

test("keeps the selected row visible after titles reflow on resize", async () => {
  const selected = "SELECTED-SESSION"
  const dialog = await renderDialog({
    current: 15,
    maxLines: 2,
    options: Array.from({ length: 20 }, (_, index) => ({
      title: `${index === 15 ? selected : `session-${index}`} ${"x".repeat(50)}`,
      value: index,
    })),
  })
  try {
    expect(dialog.app.captureCharFrame()).toContain(selected)

    dialog.app.resize(50, 30)
    await dialog.app.flush({ maxPasses: 50 })

    expect(dialog.app.captureCharFrame()).toContain(selected)
  } finally {
    await dialog.cleanup()
  }
})

test("keeps the selected row visible after reactive row reflow", async () => {
  const selected = "SELECTED-SESSION"
  const dialog = await renderDialog({
    current: 15,
    maxLines: 2,
    dynamicFooter: { initial: ".", next: "f".repeat(40) },
    options: Array.from({ length: 20 }, (_, index) => ({
      title: `${index === 15 ? selected : `session-${index}`} ${"x".repeat(50)}`,
      value: index,
    })),
  })
  try {
    expect(dialog.app.captureCharFrame()).toContain(selected)

    dialog.updateFooter?.()
    for (let frame = 0; frame < 3; frame++) {
      await Bun.sleep(10)
      await dialog.app.renderOnce()
    }

    expect(dialog.app.captureCharFrame()).toContain(selected)
  } finally {
    await dialog.cleanup()
  }
})

test("keeps the first category header visible when moving home", async () => {
  const dialog = await renderDialog({
    current: 15,
    maxLines: 2,
    options: Array.from({ length: 20 }, (_, index) => ({
      title: index === 0 ? "FIRST-SESSION" : `session-${index}`,
      value: index,
      category: index === 0 ? "Pinned" : "Today",
    })),
  })
  try {
    dialog.app.mockInput.pressKey("home")
    await Bun.sleep(10)
    await dialog.app.renderOnce()
    await dialog.app.renderOnce()

    const frame = dialog.app.captureCharFrame()
    expect(frame).toContain("FIRST-SESSION")
    expect(frame).toContain("Pinned")
  } finally {
    await dialog.cleanup()
  }
})

function matchingLines(frame: string, text: string) {
  return frame
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(text))
}
