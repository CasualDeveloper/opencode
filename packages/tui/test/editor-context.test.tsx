import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
  EditorContextProvider,
  editorSelectionKey,
  useEditorContext,
  type EditorSelection,
} from "../src/context/editor"
import { TuiPathsProvider } from "../src/context/runtime"

class FakeWebSocket extends EventTarget {
  static current: FakeWebSocket | undefined
  readyState = 0
  constructor(_url: string) {
    super()
    FakeWebSocket.current = this
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event("open"))
  }
  message(value: unknown) {
    const event = new Event("message")
    Object.defineProperty(event, "data", { value: JSON.stringify(value) })
    this.dispatchEvent(event)
  }
  send(_data: string) {}
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
}

const selection = (text: string): EditorSelection => ({
  filePath: "/work/index.ts",
  source: "websocket",
  ranges: [{ text, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } } }],
})

test("acknowledging captured editor context does not acknowledge a newer selection", async () => {
  const mounted = Promise.withResolvers<ReturnType<typeof useEditorContext>>()
  function Probe() {
    const editor = useEditorContext()
    mounted.resolve(editor)
    return <text>{editor.labelState()}</text>
  }
  const app = await testRender(
    () => (
      <TuiPathsProvider value={{ cwd: "/work", home: "/home", state: "/state", worktree: "/work" }}>
        <EditorContextProvider
          integration={{ connection: () => ({ url: "ws://editor.test", source: "test" }) }}
          WebSocketImpl={FakeWebSocket as never}
        >
          <Probe />
        </EditorContextProvider>
      </TuiPathsProvider>
    ),
    { width: 40, height: 3 },
  )
  try {
    const editor = await mounted.promise
    const socket = FakeWebSocket.current
    if (!socket) throw new Error("Editor did not connect")
    socket.open()
    socket.message({ method: "selection_changed", params: selection("first") })
    const key = editorSelectionKey(editor.selection())
    if (!key) throw new Error("Selection was not received")
    socket.message({ method: "selection_changed", params: selection("second") })
    editor.markSelectionSent(key)
    expect(editor.selection()).toEqual(selection("second"))
    expect(editor.labelState()).toBe("pending")
    editor.markSelectionSent(editorSelectionKey(selection("second"))!)
    expect(editor.labelState()).toBe("sent")
  } finally {
    app.renderer.destroy()
    FakeWebSocket.current = undefined
  }
})
