import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { OpenCode } from "@opencode/client/promise"
import { createData } from "@opencode/client/solid"
import type { ModelSelection } from "@/providers/models/selection"
import type { SessionMessageUser } from "@opencode/client/promise"
import { Skill } from "@opencode/schema/skill"
import type { ActiveComposerAdapter, ComposerControls, ComposerSession, NewSessionComposerAdapter } from "./adapter"
import { createMemoryComposerState, type Prompt } from "./state"
import { createComposerSubmit } from "./submit"
import type { ComposerStateTarget } from "./submission-state"

const disposers: Array<() => void> = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

// SAFETY: submission reads only the selected model's id, name, and provider id.
const selectedModel = {
  id: "model-1",
  name: "Model 1",
  provider: { id: "provider-1" },
} as NonNullable<ReturnType<ModelSelection["current"]>>

const selection = {
  ready: Object.assign(() => true, { promise: undefined }),
  current: () => selectedModel,
  recent: () => [selectedModel],
  list: () => [selectedModel],
  cycle() {},
  set() {},
  visible: () => true,
  setVisibility() {},
  variant: {
    configured: () => undefined,
    selected: () => "balanced",
    current: () => "balanced",
    list: () => ["balanced"],
    set() {},
    cycle() {},
  },
} satisfies ModelSelection

function controls(): ComposerControls {
  return {
    agents: {
      available: [{ name: "build", mode: "primary" }],
      options: ["build"],
      current: "build",
      visible: true,
      select() {},
    },
    model: { selection, paid: true, loading: false },
  }
}

function active(state: ComposerStateTarget, target: ComposerSession, ctl = controls): ActiveComposerAdapter {
  return {
    kind: "active-session",
    state,
    ready: () => true,
    controls: ctl,
    working: () => false,
    session: () => target,
    interrupt: async () => undefined,
    submitted() {},
    setEditor() {},
  }
}

function fresh(state: ComposerStateTarget, start: NewSessionComposerAdapter["start"]): NewSessionComposerAdapter {
  return { kind: "new-session", state, ready: () => true, controls, working: () => false, submitted() {}, start }
}

function submitInput(
  adapter: ActiveComposerAdapter | NewSessionComposerAdapter,
  notify: Parameters<typeof createComposerSubmit>[0]["notify"] = {
    missingSelection() {},
    unqueueable() {},
    failed() {},
  },
  mode: "normal" | "shell" = "normal",
  commands: () => readonly { name: string }[] | undefined = () => [],
  history: string[] = [],
  clientCommand?: (text: string) => (() => void | Promise<void>) | undefined,
) {
  return createComposerSubmit({
    adapter,
    mode: () => mode,
    commands,
    clientCommand,
    editor: () => undefined,
    queueScroll() {},
    addToHistory: (prompt) =>
      history.push(`add:${prompt.map((part) => ("content" in part ? part.content : part.type)).join("")}`),
    removeFromHistory: (prompt) =>
      history.push(`remove:${prompt.map((part) => ("content" in part ? part.content : part.type)).join("")}`),
    resetHistory() {},
    setMode() {},
    closePopover() {},
    notify,
    comments: { capture: () => [], clear() {}, restore() {} },
  })
}

function session(input: {
  calls: string[]
  prompt?: (value: Parameters<ComposerSession["data"]["session"]["prompt"]>[0]) => Promise<void>
  handoff?: ComposerSession["handoff"]
  statuses?: ("idle" | "running")[]
  current?: ComposerSession["current"]
  admitted?: (messageID: string) => boolean
  shell?: ComposerSession["api"]["shell"]
  command?: ComposerSession["api"]["command"]
  switchAgent?: ComposerSession["api"]["switchAgent"]
  switchModel?: ComposerSession["api"]["switchModel"]
}) {
  const api = OpenCode.make({ baseUrl: "http://opencode.test" })
  const data = createRoot((dispose) => {
    disposers.push(dispose)
    return createData({
      directory: "C:/repo",
      event: { on: () => () => {}, listen: () => () => {} },
      api: () => ({
        ...api,
        session: {
          ...api.session,
          prompt: async (value) => {
            if (!value.id) throw new Error("Client admission must supply a message ID")
            input.calls.push("prompt")
            await input.prompt?.(value)
            return {
              id: value.id,
              sessionID: value.sessionID,
              time: { created: Date.now() },
              type: "user",
              delivery: value.delivery ?? "steer",
              payload: { text: value.text },
            }
          },
        },
      }),
    })
  })
  return {
    id: "session-1",
    directory: "C:/repo",
    handoff: input.handoff,
    current: input.current ?? (() => undefined),
    admitted: input.admitted ?? (() => false),
    api: {
      switchAgent:
        input.switchAgent ??
        (async () => {
          input.calls.push("switch-agent")
        }),
      switchModel:
        input.switchModel ??
        (async () => {
          input.calls.push("switch-model")
        }),
      shell:
        input.shell ??
        (async () => {
          input.calls.push("shell")
        }),
      command: input.command ?? (async () => undefined),
    },
    data: {
      ...data,
      location: { command: { list: (): ReturnType<ComposerSession["data"]["location"]["command"]["list"]> => [] } },
      session: {
        ...data.session,
        setStatus: (_sessionID, status) => input.statuses?.push(status),
        mutate: data.session.mutate,
        prompt: data.session.prompt,
      },
    },
  } satisfies ComposerSession
}

describe("Composer submission", () => {
  test("admits a following prompt while a shell command is still running", async () => {
    const state = createMemoryComposerState({ prompt: "tail -f log" }).capture()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const admitted = Promise.withResolvers<void>()
    const target = session({
      calls: [],
      shell: async () => {
        started.resolve()
        await release.promise
      },
      prompt: async () => admitted.resolve(),
    })
    try {
      await submitInput(active(state, target), undefined, "shell").submit(new Event("submit"))
      await started.promise
      state.set([{ type: "text", content: "Continue", start: 0, end: 8 }])
      await submitInput(active(state, target)).submit(new Event("submit"))
      await admitted.promise
      expect(target.data.session.pending.list(target.id)).toMatchObject([
        { type: "user", payload: { text: "Continue" } },
      ])
    } finally {
      release.resolve()
    }
  })

  test.each([
    { mode: "normal" as const, text: "replace history", command: false, image: false },
    { mode: "normal" as const, text: "replace history", command: false, image: true },
    { mode: "normal" as const, text: "/review changes", command: true, image: true },
    { mode: "shell" as const, text: "echo hello", command: false, image: false },
  ])("reserves $mode admission before later mutations (command: $command, image: $image)", async (row) => {
    const state = createMemoryComposerState({ prompt: row.text }).capture()
    if (row.image)
      state.set([
        ...state.current(),
        {
          type: "image",
          id: "attachment",
          filename: "image.png",
          mime: "image/png",
          blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
        },
      ])
    const calls: string[] = []
    const target = session({
      calls,
      current: () => ({ agent: "build" }),
      prompt: async (value) => expect(value.files?.length ?? 0).toBe(row.image ? 1 : 0),
      command: async (value) => {
        expect(value.files).toHaveLength(1)
        calls.push("command")
      },
    })
    const submitted = submitInput(active(state, target), undefined, row.mode, () => [{ name: "review" }]).submit(
      new Event("submit"),
    )
    const redo = target.data.session.mutate(target.id, async () => {
      calls.push("redo")
    })
    await Promise.all([submitted, redo])
    expect(calls).toEqual(
      row.mode === "shell" ? ["shell", "redo"] : row.command ? ["switch-model", "command", "redo"] : ["prompt", "redo"],
    )
  })

  test("renders a follow-up immediately while its admission waits behind another prompt", async () => {
    const state = createMemoryComposerState({ prompt: "First" }).capture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const sent: string[] = []
    const target = session({
      calls: [],
      prompt: async (value) => {
        sent.push(value.text)
        if (value.text !== "First") return
        entered.resolve()
        await release.promise
      },
    })
    const submission = submitInput(active(state, target))
    await submission.submit(new Event("submit"))
    await entered.promise
    state.set([{ type: "text", content: "Second", start: 0, end: 6 }])
    await submission.submit(new Event("submit"))
    expect(
      target.data.session.pending.list(target.id).map((item) => item.type === "user" && item.payload.text),
    ).toEqual(["First", "Second"])
    expect(sent).toEqual(["First"])
    release.resolve()
    await target.data.session.mutate(target.id, async () => undefined)
    expect(sent).toEqual(["First", "Second"])
  })

  test("applies the selection and runs a client argument command without admitting it to the session", async () => {
    const state = createMemoryComposerState().capture()

    const image = {
      type: "image" as const,
      id: "attachment",
      filename: "diagram.png",
      mime: "image/png",
      blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
    }

    state.set([{ type: "text", content: "/btw why this approach?", start: 0, end: 23 }, image])
    state.context.add({ type: "file", path: "src/retry.ts" })
    const calls: string[] = []
    const history: string[] = []

    await submitInput(active(state, session({ calls })), undefined, "normal", undefined, history, (text) => {
      expect(text).toBe("/btw why this approach?")

      return () => {
        calls.push("btw")
      }
    }).submit(new Event("submit"))

    // Client commands such as /btw generate with the session's model, so the composer's selection commits first.
    expect(calls).toEqual(["switch-agent", "switch-model", "btw"])
    expect(history).toEqual([])
    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }, image])
    expect(state.context.items()).toHaveLength(1)
  })

  test.each([
    { current: { agent: "plan", model: { id: "old", providerID: "old" } } },
    {
      current: { agent: "build", model: { providerID: "provider-1", id: "model-1", variant: "balanced" } },
    },
    // A prompt commits a staged revert, which would delete the model switch made after its boundary.
    {
      current: { agent: "plan", model: { id: "old", providerID: "old" }, revert: { messageID: "msg_reverted" } },
    },
  ])("admits one captured selection atomically instead of switching or committing first: $current", async (row) => {
    const state = createMemoryComposerState({ prompt: "ship it" }).capture()
    state.context.add({ type: "file", path: "notes.md", description: "the failing version" })
    const calls: string[] = []
    const admitted = Promise.withResolvers<Parameters<ComposerSession["data"]["session"]["prompt"]>[0]>()
    const target = session({ calls, current: () => row.current, prompt: async (value) => admitted.resolve(value) })

    await submitInput(active(state, target)).submit(new Event("submit"))
    const request = await admitted.promise

    expect(calls).toEqual(["prompt"])
    expect(request.selection).toEqual({
      agent: "build",
      model: { providerID: "provider-1", id: "model-1", variant: "balanced" },
    })
    expect(request.delivery).toBe("steer")
    expect(request.text).toBe("ship it")
    expect(request.id).toMatch(/^msg_/)
    expect(request.metadata).toMatchObject({
      displayText: "ship it",
      agent: "build",
      model: { providerID: "provider-1", modelID: "model-1", variant: "balanced" },
    })
    // A file chip goes with this prompt only, like the TUI's mentionless files.
    expect(request.files).toMatchObject([{ name: "notes.md", description: "the failing version" }])
    expect(request.files?.[0]?.mention).toBeUndefined()
    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(state.context.items()).toEqual([])
  })

  test("applies the captured agent and model before a custom command without passing over its overrides", async () => {
    const state = createMemoryComposerState({ prompt: "/review changes" }).capture()
    const calls: string[] = []
    const selected = controls()
    const agent = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const committed = Promise.withResolvers<void>()
    const completed = Promise.withResolvers<void>()

    const target = session({
      calls,
      switchAgent: async (request) => {
        expect(request.agent).toBe("build")
        calls.push("agent")
        started.resolve()
        await agent.promise
      },
      switchModel: async (request) => {
        expect(request.model).toEqual({ providerID: "provider-1", id: "model-1", variant: "balanced" })
        calls.push("model")
        await committed.promise
      },
      command: async (request) => {
        expect(request).toMatchObject({ name: "review", text: "changes", delivery: "steer" })
        expect(request).not.toHaveProperty("model")
        expect(request).not.toHaveProperty("agent")
        calls.push("command")
        completed.resolve()
      },
    })

    selected.model.selection = {
      ...selection,
      trackSessionCommit: (_id, value) => {
        expect(value).toEqual({
          agent: "build",
          model: { providerID: "provider-1", modelID: "model-1" },
          variant: "balanced",
        })
        calls.push("track")

        return () => calls.push("cancel")
      },
    }
    await submitInput(
      active(state, target, () => selected),
      undefined,
      "normal",
      () => [{ name: "review" }],
    ).submit(new Event("submit"))
    await started.promise
    expect(calls).toEqual(["track", "agent"])
    selected.agents.current = "plan"
    selected.model.selection = { ...selection, variant: { ...selection.variant, current: () => "high" } }
    agent.resolve()
    committed.resolve()
    await completed.promise
    expect(calls).toEqual(["track", "agent", "model", "command"])
  })

  test("cancels selection tracking and does not execute a command when selection fails", async () => {
    const state = createMemoryComposerState({ prompt: "/review changes" }).capture()
    const calls: string[] = []
    const selected = controls()
    const failed = Promise.withResolvers<unknown>()
    const error = new Error("model unavailable")

    const target = session({
      calls,
      switchModel: async () => {
        throw error
      },
      command: async () => {
        calls.push("command")
      },
    })

    selected.model.selection = {
      ...selection,
      trackSessionCommit: () => {
        calls.push("track")

        return () => {
          calls.push("cancel")
        }
      },
    }
    await submitInput(
      active(state, target, () => selected),
      { missingSelection() {}, unqueueable() {}, failed: (_kind, error) => failed.resolve(error) },
      "normal",
      () => [{ name: "review" }],
    ).submit(new Event("submit"))
    expect(await failed.promise).toBe(error)
    expect(calls).toEqual(["track", "switch-agent", "cancel"])
    expect(state.current()[0]).toMatchObject({ content: "/review changes" })
  })

  test("restores and retries an unacknowledged admission", async () => {
    const state = createMemoryComposerState().capture()

    const prompt: Prompt = [
      { type: "text", content: "retry ", start: 0, end: 6 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 6, end: 17 },
      {
        type: "image",
        id: "attachment",
        filename: "image.png",
        mime: "image/png",
        blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
      },
    ]

    state.set(prompt)
    state.context.add({ type: "file", path: "notes.md", description: "the failing version" })
    const attempts: string[] = []
    const statuses: ("idle" | "running")[] = []
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()

    const target = session({
      calls: [],
      statuses,
      prompt: async (value) => {
        attempts.push(value.id ?? "")
        throw new Error("network unavailable")
      },
    })

    const notify = {
      missingSelection() {},
      unqueueable() {},
      failed: () => (attempts.length === 2 ? first.resolve() : second.resolve()),
    }

    const history: string[] = []
    const submission = submitInput(active(state, target), notify, "normal", () => [], history)

    await submission.submit(new Event("submit"))
    await first.promise
    await submission.submit(new Event("submit"))
    await second.promise

    expect(attempts).toHaveLength(4)
    expect(new Set(attempts).size).toBe(1)
    expect(statuses).toEqual(["running", "idle", "running", "idle"])
    expect(state.current()).toEqual(prompt)
    expect(state.context.items()).toMatchObject([
      { type: "file", path: "notes.md", description: "the failing version" },
    ])
    // The caret returns after the mention text; attachments take no caret positions.
    expect(state.cursor()).toBe(17)
    // The restored prompt is the draft again, so history does not also keep it (and its attachments).
    const entry = "retry @src/app.tsimage"
    expect(history).toEqual([`add:${entry}`, `remove:${entry}`, `add:${entry}`, `remove:${entry}`])
  })

  test("restores first-prompt comments into the promoted Session", async () => {
    const draft = createMemoryComposerState({ prompt: "first prompt" }).capture()
    draft.store[1]("context", "items", [
      {
        key: "file:src/app.ts:1:1:comment",
        type: "file",
        path: "src/app.ts",
        comment: "Keep this comment",
        selection: { startLine: 1, startChar: 0, endLine: 1, endChar: 4 },
      },
    ])
    expect(draft.context.items()).toHaveLength(1)
    const promoted = createMemoryComposerState().capture()
    const failed = Promise.withResolvers<void>()
    const target = session({ calls: [], shell: async () => Promise.reject(new Error("send failed")) })

    const adapter = fresh(draft, async (_selection, submission) => {
      submission.retarget(promoted)

      return { session: target, cleanupReady: Promise.resolve() }
    })

    await submitInput(
      adapter,
      { missingSelection() {}, unqueueable() {}, failed: () => failed.resolve() },
      "shell",
    ).submit(new Event("submit"))
    await failed.promise

    expect(promoted.current()).toMatchObject([{ type: "text", content: "first prompt" }])
    expect(promoted.context.items()).toMatchObject([{ type: "file", path: "src/app.ts", comment: "Keep this comment" }])
    expect(promoted.mode.current()).toBe("shell")
  })

  test("does not restore a prompt already acknowledged by the durable inbox", async () => {
    const state = createMemoryComposerState({ prompt: "admitted prompt" }).capture()
    const checked = Promise.withResolvers<void>()
    const attempts: string[] = []

    const target = session({
      calls: [],
      admitted: () => {
        checked.resolve()

        return true
      },
      prompt: async (value) => {
        attempts.push(value.id ?? "")
        throw new Error("response lost")
      },
    })

    await submitInput(active(state, target)).submit(new Event("submit"))
    await checked.promise

    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts).size).toBe(1)
  })

  test("hands off image-only first prompts and admits them before cleanup is ready", async () => {
    const draft = createMemoryComposerState().capture()

    const prompt: Prompt = [
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "attachment",
        filename: "image.png",
        mime: "image/png",
        blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
      },
    ]

    draft.set(prompt)
    const handedOff = Promise.withResolvers<SessionMessageUser>()
    const admitted = Promise.withResolvers<void>()
    const cleanup = Promise.withResolvers<void>()

    const target = session({
      calls: [],
      handoff: { set: handedOff.resolve, clear() {} },
      prompt: async () => admitted.resolve(),
    })

    const submitted = submitInput(
      fresh(draft, async () => ({ session: target, cleanupReady: cleanup.promise })),
    ).submit(new Event("submit"))

    await admitted.promise
    expect(draft.current()).toEqual(prompt)
    cleanup.resolve()
    await submitted
    expect(draft.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])

    expect(await handedOff.promise).toMatchObject({
      type: "user",
      text: "",
      files: [
        {
          data: "",
          mime: "image/png",
          source: { type: "uri", uri: "data:image/png;base64,YQ==" },
          name: "image.png",
        },
      ],
    })
  })

  test("preserves extension notes through failed admission and same-ID retry", async () => {
    const state = createMemoryComposerState({ prompt: "Update this button" }).capture()
    const comment = {
      type: "note" as const,
      origin: "browser",
      label: "button#save",
      icon: "select-element",
      subject: 'the "button#save" element',
      comment: "Rename this",
    }
    state.context.add({ ...comment, commentID: "element-comment" })
    const requests: Parameters<ComposerSession["data"]["session"]["prompt"]>[0][] = []
    const failed = Promise.withResolvers<void>()
    const accepted = Promise.withResolvers<void>()
    const target = session({
      calls: [],
      prompt: async (value) => {
        requests.push(value)
        if (requests.length <= 2) throw new Error("network unavailable")
        accepted.resolve()
      },
    })
    const adapter: ActiveComposerAdapter = {
      kind: "active-session",
      state,
      ready: () => true,
      controls,
      working: () => false,
      session: () => target,
      interrupt: async () => undefined,
      submitted() {},
      setEditor() {},
    }
    const submission = submitInput(adapter, { missingSelection() {}, unqueueable() {}, failed: () => failed.resolve() })

    await submission.submit(new Event("submit"))
    await failed.promise
    expect(state.current()).toMatchObject([{ type: "text", content: "Update this button" }])
    expect(state.context.items()).toMatchObject([{ ...comment, commentID: "element-comment" }])

    await submission.submit(new Event("submit"))
    await accepted.promise
    expect(requests).toHaveLength(3)
    expect(new Set(requests.map((request) => request.id)).size).toBe(1)
    requests.forEach((request) => {
      expect(request.metadata?.comments).toEqual([comment])
      expect(request.text).toContain(comment.subject)
      expect(request.text).toContain("Rename this")
    })
    expect(state.context.items()).toEqual([])
  })

  test("forwards structured mentions to custom commands", async () => {
    const state = createMemoryComposerState().capture()
    state.set([
      { type: "text", content: "/review ", start: 0, end: 8 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 8, end: 19 },
      { type: "text", content: " ", start: 19, end: 20 },
      { type: "agent", name: "review", content: "@review", start: 20, end: 27 },
      { type: "text", content: " ", start: 27, end: 28 },
      {
        type: "skill",
        id: Skill.ID.make("effect"),
        name: Skill.Name.make("Effect"),
        content: "@effect",
        start: 28,
        end: 35,
      },
    ])
    const sent = Promise.withResolvers<Parameters<ComposerSession["api"]["command"]>[0]>()
    const target = session({ calls: [], command: async (value) => sent.resolve(value) })

    await submitInput(active(state, target), undefined, "normal", () => [{ name: "review" }]).submit(
      new Event("submit"),
    )
    const request = await sent.promise

    expect(request.files).toMatchObject([{ name: "app.ts", mention: { text: "@src/app.ts" } }])
    expect(request.agents).toMatchObject([{ name: "review", mention: { text: "@review" } }])
    expect(request.skills).toMatchObject([{ id: "effect", name: "Effect", mention: { text: "@effect" } }])
    expect(request.delivery).toBe("steer")
  })

  test("captures commands before creating a session in a new worktree", async () => {
    const state = createMemoryComposerState({ prompt: "/review https://github.com/example/repo/pull/1" }).capture()
    const catalog = [{ name: "review" }]
    const sent = Promise.withResolvers<"prompt" | "command">()
    const requests: Parameters<ComposerSession["api"]["command"]>[0][] = []

    const target = session({
      calls: [],
      prompt: async () => sent.resolve("prompt"),
      command: async (value) => {
        requests.push(value)
        sent.resolve("command")
      },
    })

    target.directory = "C:/new-worktree"
    target.data.location.command.list = () => undefined

    const adapter = fresh(state, async () => {
      // The destination catalog has not loaded, and the source composer is leaving.
      catalog.splice(0)

      return { session: target, cleanupReady: Promise.resolve() }
    })

    await submitInput(adapter, undefined, "normal", () => catalog).submit(new Event("submit"))

    expect(await sent.promise).toBe("command")
    expect(requests).toEqual([
      {
        sessionID: target.id,
        name: "review",
        text: "https://github.com/example/repo/pull/1",
        files: [],
        agents: [],
        skills: [],
        delivery: "steer",
      },
    ])
  })

  test("does not run an empty shell command from hidden attachments", async () => {
    const state = createMemoryComposerState().capture()
    state.set([
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "attachment",
        filename: "notes.txt",
        mime: "text/plain",
        blob: { id: "attachment", url: "data:text/plain;base64,bm90ZXM=" },
      },
    ])
    const calls: string[] = []

    await submitInput(active(state, session({ calls })), undefined, "shell").submit(new Event("submit"))

    expect(calls).toEqual([])
    expect(state.current().some((part) => part.type === "image")).toBe(true)
  })
})
