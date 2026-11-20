import { expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

test.each([100, 44])("low thinking stays inline through history, Ctrl-T and streaming at width %s", async (width) => {
  const session = {
    id: "ses_visible_thinking",
    title: "Visible thinking",
    projectID: "project",
    location: { directory },
    agent: "build",
    model: { providerID: "fixture", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  }
  const tool = (id: string): SessionMessageAssistant["content"][number] => ({
    type: "tool",
    id,
    name: "shell",
    time: { created: 2, completed: 3 },
    state: {
      status: "completed",
      input: { command: `echo ${id}` },
      content: [{ type: "text", text: `${id} output` }],
      metadata: {},
    },
  })
  const message: SessionMessageAssistant = {
    id: "msg_thinking",
    type: "assistant",
    agent: session.agent,
    model: session.model,
    time: { created: 2 },
    content: [
      tool("before"),
      { type: "reasoning", text: "INLINE_THOUGHT", time: { created: 3, completed: 4 } },
      tool("after"),
    ],
  }
  await using setup = await createAppFixture({
    width,
    height: 40,
    config: {
      animations: false,
      tabs: { mode: "off" },
      keybinds: { "session.toggle.thinking": "ctrl+t", "variant.cycle": "none" },
      session: { sidebar: "hide", verbosity: "low", thinking: "show" },
    },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [message, { id: "msg_ask", type: "user", text: "Inspect", time: { created: 1 } }],
          cursor: {},
        })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    },
  })
  await setup.ready
  const frame = await waitForHighlightedFrame(setup, (frame) => frame.includes("INLINE_THOUGHT"))
  expect(frame.match(/\+ 1 command/g)).toHaveLength(2)
  expect(frame.indexOf("+ 1 command")).toBeLessThan(frame.indexOf("INLINE_THOUGHT"))
  expect(frame.lastIndexOf("+ 1 command")).toBeGreaterThan(frame.indexOf("INLINE_THOUGHT"))
  expect(frame).not.toContain("echo before")
  expect(frame).not.toContain("echo after")

  setup.mockInput.pressKey("t", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("+ 2 commands") && !frame.includes("INLINE_THOUGHT"))
  expect(setup.config().session?.thinking).toBe("hide")
  setup.mockInput.pressKey("t", { ctrl: true })
  await waitForHighlightedFrame(setup, (frame) => frame.includes("INLINE_THOUGHT"))
  expect(setup.config().session?.thinking).toBe("show")

  const row = setup
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes("+ 1 command"))
  await setup.mockMouse.click(6, row)
  await waitForHighlightedFrame(setup, (frame) => frame.includes("echo before"))
  expect(setup.captureCharFrame()).toContain("INLINE_THOUGHT")
  expect(setup.captureCharFrame()).not.toContain("echo after")

  setup.events.emit({
    id: "evt_thought_started",
    created: 5,
    type: "session.reasoning.started",
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: { sessionID: session.id, assistantMessageID: message.id, ordinal: 1 },
  })
  setup.events.emit({
    id: "evt_thought_delta",
    created: 5,
    type: "session.reasoning.delta",
    data: { sessionID: session.id, assistantMessageID: message.id, ordinal: 1, delta: "STREAM_THOUGHT\n\n" },
  })
  await waitForHighlightedFrame(setup, (frame) => frame.includes("STREAM_THOUGHT"))
  setup.events.emit({
    id: "evt_thought_ended",
    created: 6,
    type: "session.reasoning.ended",
    durable: { aggregateID: session.id, seq: 2, version: 1 },
    data: { sessionID: session.id, assistantMessageID: message.id, ordinal: 1, text: "STREAM_THOUGHT\n\nLAST_LINE" },
  })
  await waitForHighlightedFrame(setup, (frame) => frame.includes("LAST_LINE"))
  expect(setup.captureCharFrame().indexOf("INLINE_THOUGHT")).toBeLessThan(
    setup.captureCharFrame().indexOf("STREAM_THOUGHT"),
  )
  setup.mockInput.pressKey("t", { ctrl: true })
  await setup.waitForFrame((frame) => !frame.includes("STREAM_THOUGHT") && !frame.includes("INLINE_THOUGHT"))
  setup.mockInput.pressKey("t", { ctrl: true })
  await waitForHighlightedFrame(setup, (frame) => frame.includes("INLINE_THOUGHT") && frame.includes("LAST_LINE"))
})
