import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable, type Renderable } from "@opentui/core"
import { directory, json } from "./fixture/tui-client"
import { createAppFixture } from "./fixture/app"

const promptText = "ALPHA first prompt"
const sentWarning = "Prompt was already sent. Use /undo to take it back"
// The first app fixture also pays for the cold TUI import; match the package's budget.
const caseTimeout = 30_000

test(
  "/undo waits for the admission of the prompt it withdraws",
  async () => {
    const world = createWorld("overtake", "ses_overtake")
    await using setup = await createAppFixture({
      width: 100,
      height: 30,
      args: { sessionID: world.sessionID },
      fetch: world.fetch,
    })
    try {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await setup.mockInput.typeText(promptText)
      setup.mockInput.pressEnter()
      await world.modelRequested.promise
      await setup.mockInput.typeText("/undo")
      setup.mockInput.pressEnter()
      world.releaseModel()
      await waitUntil(
        setup,
        world,
        () =>
          focusedComposer(setup)?.plainText === promptText &&
          world.labels().some((label) => label.startsWith("prompt:")),
        "composer restored after the prompt admission",
      )
      expect({
        pending: [...world.pending],
        history: [...world.history],
        afterModel: world.labels(),
      }).toEqual({
        pending: [],
        history: [],
        afterModel: [`prompt:${promptText}`, "cancel", "message.get"],
      })
    } finally {
      world.release()
    }
  },
  caseTimeout,
)

test(
  "/undo reverts a prompt the server delivered before the client saw it",
  async () => {
    const world = createWorld("delivered", "ses_delivered")
    await using setup = await createAppFixture({
      width: 100,
      height: 30,
      args: { sessionID: world.sessionID },
      fetch: world.fetch,
    })
    try {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await setup.mockInput.typeText(promptText)
      setup.mockInput.pressEnter()
      const posted = await world.promptPosted.promise
      await setup.mockInput.typeText("/undo")
      setup.mockInput.pressEnter()
      await waitUntil(
        setup,
        world,
        () => world.labels().includes(`revert.stage:${posted}`) || (focusedComposer(setup)?.plainText ?? "") !== "",
        "stage request or a restored composer",
      )
      expect({
        composer: focusedComposer(setup)?.plainText ?? "",
        staged: world.labels().filter((label) => label.startsWith("revert.stage:")),
      }).toEqual({ composer: "", staged: [`revert.stage:${posted}`] })
      world.releaseStage()
      await waitUntil(
        setup,
        world,
        () => focusedComposer(setup)?.plainText === promptText,
        "composer restored after stage",
      )
      expect(world.after(`prompt:${promptText}`)).toEqual([
        "cancel",
        "message.get",
        "interrupt",
        "wait",
        `revert.stage:${posted}`,
      ])
      expect(world.labels()).not.toContain("revert.commit")
    } finally {
      world.release()
    }
  },
  caseTimeout,
)

test(
  "/undo of a prompt the server rejected leaves running work alone",
  async () => {
    const world = createWorld("rejected", "ses_rejected")
    await using setup = await createAppFixture({
      width: 100,
      height: 30,
      args: { sessionID: world.sessionID },
      fetch: world.fetch,
    })
    try {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await setup.mockInput.typeText(promptText)
      setup.mockInput.pressEnter()
      await world.modelRequested.promise
      await setup.mockInput.typeText("/undo")
      setup.mockInput.pressEnter()
      world.releaseModel()
      await waitUntil(
        setup,
        world,
        () => focusedComposer(setup)?.plainText === promptText && setup.captureCharFrame().includes("Nothing to undo"),
        "composer restored after undo settled",
      )
      expect(world.labels()).toEqual([`prompt:${promptText}`, `prompt:${promptText}`])
    } finally {
      world.release()
    }
  },
  caseTimeout,
)

test(
  "queued undo leaves an already delivered prompt alone",
  async () => {
    const world = createWorld("queued", "ses_queued")
    await using setup = await createAppFixture({
      width: 120,
      height: 30,
      args: { sessionID: world.sessionID },
      fetch: world.fetch,
    })
    try {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("1 queued"))
      setup.mockInput.pressKey("p", { ctrl: true })
      await setup.waitFor(
        () =>
          setup.captureCharFrame().includes("Commands") &&
          setup.renderer.currentFocusedEditor instanceof InputRenderable,
      )
      await setup.mockInput.typeText("View queued prompts")
      await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === "View queued prompts")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Queued prompts"))
      setup.mockInput.pressKey("u", { ctrl: true })
      await waitUntil(
        setup,
        world,
        () => setup.captureCharFrame().includes(sentWarning) || composerText(setup) !== "",
        "queued undo warning or a restored composer",
      )
      expect({
        warned: setup.captureCharFrame().includes(sentWarning),
        composer: composerText(setup),
      }).toEqual({ warned: true, composer: "" })
    } finally {
      world.release()
    }
  },
  caseTimeout,
)

type WorldMode = "overtake" | "delivered" | "rejected" | "queued" | "paginated"

test("undo loads older history before selecting the predecessor of an unloaded revert", async () => {
  const world = createWorld("paginated", "ses_undo_paginated")
  await using setup = await createAppFixture({ args: { sessionID: world.sessionID }, fetch: world.fetch })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText("/undo")
  setup.mockInput.pressEnter()
  await waitUntil(
    setup,
    world,
    () => focusedComposer(setup)?.plainText === "Previous prompt",
    "paginated undo restoration",
  )
  expect(world.labels()).toEqual(["interrupt", "wait", "revert.stage:msg_z_previous"])
})

test("failed prompt retries retain identity and a late echo clears only the restored draft", async () => {
  const world = createWorld("rejected", "ses_retry_echo")
  await using setup = await createAppFixture({ args: { sessionID: world.sessionID }, fetch: world.fetch })
  world.releaseModel()
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText(promptText)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => world.ids.length === 2 && focusedComposer(setup)?.plainText === promptText)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => world.ids.length === 4 && focusedComposer(setup)?.plainText === promptText)
  expect(new Set(world.ids).size).toBe(1)
  expect(world.labels()).not.toContain("model")
  setup.events.emit({
    id: "evt_retry_echo",
    created: 2,
    type: "session.inbox.enqueued",
    durable: { aggregateID: world.sessionID, seq: 1, version: 1 },
    data: {
      sessionID: world.sessionID,
      inboxID: world.ids[0],
      item: { type: "user", payload: { text: promptText }, delivery: "steer" },
    },
  })
  await setup.waitFor(() => focusedComposer(setup)?.plainText === "")
})

test("a rejected prompt restores its cursor at the end of wide text after leaving the session", async () => {
  const world = createWorld("rejected", `ses_restore_${crypto.randomUUID()}`)
  const text = "中文末"
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: world.sessionID },
    config: { animations: false, tabs: { mode: "off" }, keybinds: { "session.new": "f6" } },
    fetch: world.fetch,
  })
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Demo Model"))
    await setup.mockInput.typeText(text)
    setup.mockInput.pressEnter()
    await world.modelRequested.promise
    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("commands"))
    world.releaseModel()
    await setup.waitForFrame((frame) => frame.includes("Failed to send prompt"))
    setup.events.emit({
      id: "evt_restore_wide",
      created: 2,
      type: "tui.session.select",
      location: { directory },
      data: { sessionID: world.sessionID },
    })
    await setup.waitFor(() => focusedComposer(setup)?.plainText === text)
    await setup.mockInput.typeText("x")
    expect(focusedComposer(setup)?.plainText).toBe(`${text}x`)
  } finally {
    world.release()
  }
})

test("restoring a rejected normal prompt resets a subsequently selected empty shell mode", async () => {
  const world = createWorld("rejected", "ses_restore_mode")
  await using setup = await createAppFixture({ args: { sessionID: world.sessionID }, fetch: world.fetch })
  try {
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Demo Model"))
    await setup.mockInput.typeText(promptText)
    setup.mockInput.pressEnter()
    await world.modelRequested.promise
    await setup.mockInput.typeText("!")
    world.releaseModel()
    await waitUntil(
      setup,
      world,
      () => world.ids.length === 2 && focusedComposer(setup)?.plainText === promptText,
      "failed normal prompt",
    )
    setup.mockInput.pressEnter()
    await waitUntil(setup, world, () => world.ids.length === 4 || world.labels().includes("shell"), "resubmission")
    expect(world.labels()).not.toContain("shell")
    expect(world.ids).toHaveLength(4)
  } finally {
    world.release()
  }
})

test("a prompt waiting behind admission keeps its captured editor context when selection changes", async () => {
  const connected = Promise.withResolvers<void>()
  let select = (_file: string, _text: string) => {}
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      message() {},
      open(socket) {
        select = (file, text) => {
          socket.send(
            JSON.stringify({
              method: "selection_changed",
              params: {
                filePath: `${directory}/${file}`,
                ranges: [
                  { text, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } } },
                ],
                source: "websocket",
              },
            }),
          )
        }
        connected.resolve()
      },
    },
  })
  const previous = process.env.OPENCODE_EDITOR_SSE_PORT
  process.env.OPENCODE_EDITOR_SSE_PORT = String(server.port)
  const world = createWorld("overtake", "ses_context_capture")
  try {
    await using setup = await createAppFixture({ args: { sessionID: world.sessionID }, fetch: world.fetch })
    try {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await connected.promise
      await setup.mockInput.typeText("First")
      setup.mockInput.pressEnter()
      await world.modelRequested.promise
      select("first.ts", "CAPTURED_ALPHA")
      await setup.waitForFrame((frame) => frame.includes("first.ts"))
      await setup.mockInput.typeText("Explain context")
      setup.mockInput.pressEnter()
      await setup.waitFor(() => focusedComposer(setup)?.plainText === "")
      select("second.ts", "LATER_BETA")
      await setup.waitForFrame((frame) => frame.includes("second.ts"))
      world.releaseModel()
      await waitUntil(setup, world, () => world.ids.length === 2, "second context request")
      expect(world.contexts[1]).toContain("CAPTURED_ALPHA")
      expect(world.contexts[1]).not.toContain("LATER_BETA")
    } finally {
      world.release()
    }
  } finally {
    world.release()
    if (previous === undefined) delete process.env.OPENCODE_EDITOR_SSE_PORT
    else process.env.OPENCODE_EDITOR_SSE_PORT = previous
    await server.stop(true)
  }
})

function createWorld(mode: WorldMode, sessionID: string) {
  const ids: string[] = []
  const contexts: Array<string | undefined> = []
  const pending = new Set<string>()
  const history = new Set<string>()
  const texts = new Map<string, string>()
  const requests: { method: string; label: string }[] = []
  const modelRequested = Promise.withResolvers<void>()
  const promptPosted = Promise.withResolvers<string>()
  const modelHeld = Promise.withResolvers<void>()
  const stageHeld = Promise.withResolvers<void>()
  const queuedID = "msg_queued"
  if (mode === "queued") {
    history.add(queuedID)
    texts.set(queuedID, promptText)
  }
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const session = {
    id: sessionID,
    projectID: "project",
    title: "Undo fixture",
    revert: mode === "paginated" ? { messageID: "msg_boundary" } : undefined,
    agent: "build",
    model: { providerID: "demo", id: "model" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const queued = {
    id: queuedID,
    sessionID,
    type: "user",
    delivery: "queue",
    time: { created: 1 },
    payload: { text: promptText },
  }

  return {
    sessionID,
    pending,
    history,
    modelRequested,
    ids,
    contexts,
    promptPosted,
    releaseModel: () => modelHeld.resolve(),
    releaseStage: () => stageHeld.resolve(),
    labels() {
      return requests.map((item) => item.label)
    },
    after(label: string) {
      const index = requests.findIndex((item) => item.label === label)
      return requests.slice(index + 1).map((item) => item.label)
    },
    release() {
      modelHeld.resolve()
      stageHeld.resolve()
    },
    fetch: async (url: URL, request: Request) => {
      if (url.pathname === `/api/session/${sessionID}` && request.method === "GET") return json({ data: session })
      if (url.pathname === `/api/session/${sessionID}/message` && request.method === "GET")
        return mode === "paginated"
          ? json({
              data: url.searchParams.has("cursor")
                ? [
                    { id: "msg_boundary", type: "user", text: "Boundary", time: { created: 2 } },
                    { id: "msg_z_previous", type: "user", text: "Previous prompt", time: { created: 1 } },
                  ]
                : [{ id: "msg_a_later", type: "user", text: "Later", time: { created: 3 } }],
              cursor: url.searchParams.has("cursor") ? {} : { next: "older" },
            })
          : json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/permission`) return json({ data: [] })
      if (url.pathname === `/api/session/${sessionID}/inbox` && request.method === "GET")
        return json({ data: mode === "queued" ? [queued] : [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === `/api/session/${sessionID}/model` && request.method === "POST") {
        requests.push({ method: "POST", label: "model" })
        modelRequested.resolve()
        if (mode === "overtake" || mode === "rejected") await modelHeld.promise
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/prompt` && request.method === "POST") {
        const body = (await request.json()) as { id?: string; text?: string; context?: { text: string } }
        const id = body.id ?? ""
        ids.push(id)
        contexts.push(body.context?.text)
        const text = body.text ?? ""
        requests.push({ method: "POST", label: `prompt:${text}` })
        modelRequested.resolve()
        if (mode === "overtake" || mode === "rejected") await modelHeld.promise
        if (mode === "rejected")
          return json({ _tag: "InvalidRequestError", message: "Skill not found", field: "skills" }, { status: 400 })
        texts.set(id, text)
        if (mode === "overtake") pending.add(id)
        if (mode === "delivered") history.add(id)
        promptPosted.resolve(id)
        return json({
          data: {
            id,
            sessionID,
            type: "user",
            delivery: "steer",
            time: { created: 1 },
            payload: { text },
          },
        })
      }
      const inboxID = url.pathname.match(new RegExp(`^/api/session/${sessionID}/inbox/([^/]+)$`))?.[1]
      if (url.pathname.endsWith("/shell") && request.method === "POST") {
        requests.push({ method: "POST", label: "shell" })
        return new Response(null, { status: 204 })
      }
      if (inboxID && request.method === "DELETE") {
        requests.push({ method: "DELETE", label: "cancel" })
        pending.delete(decodeURIComponent(inboxID))
        return new Response(null, { status: 204 })
      }
      const messageID = url.pathname.match(new RegExp(`^/api/session/${sessionID}/message/([^/]+)$`))?.[1]
      if (messageID && request.method === "GET") {
        const id = decodeURIComponent(messageID)
        requests.push({ method: "GET", label: "message.get" })
        if (history.has(id))
          return json({ data: { id, type: "user", text: texts.get(id) ?? "", time: { created: 1 } } })
        return json(
          { _tag: "MessageNotFoundError", sessionID, messageID: id, message: "Message not found" },
          { status: 404 },
        )
      }
      if (url.pathname === `/api/session/${sessionID}/interrupt` && request.method === "POST") {
        requests.push({ method: "POST", label: "interrupt" })
        return json({ interrupted: true })
      }
      if (url.pathname === `/api/experimental/session/${sessionID}/wait` && request.method === "POST") {
        requests.push({ method: "POST", label: "wait" })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/revert/stage` && request.method === "POST") {
        const body = (await request.json()) as { messageID?: string }
        const id = body.messageID ?? ""
        requests.push({ method: "POST", label: `revert.stage:${id}` })
        if (mode === "delivered") await stageHeld.promise
        return json({ data: { messageID: id, files: [] } })
      }
      if (url.pathname === `/api/session/${sessionID}/revert/commit` && request.method === "POST") {
        requests.push({ method: "POST", label: "revert.commit" })
        return new Response(null, { status: 204 })
      }
      return undefined
    },
  }
}

function focusedComposer(setup: { renderer: { currentFocusedEditor: unknown } }) {
  const editor = setup.renderer.currentFocusedEditor
  if (!(editor instanceof TextareaRenderable) || editor instanceof InputRenderable) return
  return editor
}

function composerText(setup: { renderer: { root: Renderable; currentFocusedEditor: unknown } }) {
  return focusedComposer(setup)?.plainText ?? findComposer(setup.renderer.root)?.plainText ?? ""
}

function findComposer(node: Renderable): TextareaRenderable | undefined {
  for (const child of node.getChildren()) {
    if (child instanceof TextareaRenderable && !(child instanceof InputRenderable)) return child
    const found = findComposer(child)
    if (found) return found
  }
  return
}

async function waitUntil(
  setup: { captureCharFrame(): string },
  world: { labels(): string[] },
  ready: () => boolean,
  label: string,
) {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > caseTimeout / 2) {
      throw new Error(
        `Timed out waiting for ${label}\nrequests: ${JSON.stringify(world.labels())}\nframe:\n${setup.captureCharFrame()}`,
      )
    }
    await Bun.sleep(10)
  }
}
