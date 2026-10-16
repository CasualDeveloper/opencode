import { describe, expect, setDefaultTimeout } from "bun:test"
import path from "path"
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// These cases include real Location and plugin startup, not just callbacks.
setDefaultTimeout(15_000)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

const project = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

const pluginSession = Effect.fnUntraced(function* (setup: string) {
  const tmp = yield* project
  yield* Effect.promise(() =>
    Bun.write(path.join(tmp.path, ".opencode/plugins/admission.ts"), `export default { id: "admission", ${setup} }`),
  )
  const sessions = yield* Session.Service
  const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
  return { sessions, session }
})

describe("Ordered plugin admission", () => {
  it.live("waits for local setup before plain-text prompt admission", () =>
    Effect.gen(function* () {
      const s = yield* pluginSession(`async setup(ctx) {
        await ctx.session.hook("prompt", (event) => { event.prompt.text = "Prepared by plugin" })
      }`)
      const admitted = yield* s.sessions.prompt({ sessionID: s.session.id, text: "Original", resume: false })
      expect(admitted.payload.text).toBe("Prepared by plugin")
    }),
  )

  it.live("allows cold plugin setup synthetic admission during revert staging", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/admission.ts"),
          `export default { id: "cold-admission", async setup(ctx) {
            await ctx.session.synthetic({ sessionID: "${session.id}", text: "Plugin activated", resume: false })
          } }`,
        ),
      )
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const boundaryID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        inboxID: boundaryID,
        sessionID: session.id,
        item: SessionInbox.Item.make({ type: "user", payload: { text: "Boundary" }, delivery: "steer" }),
      })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")
      yield* sessions.revert.stage({ sessionID: session.id, messageID: boundaryID, files: false })
      expect((yield* sessions.get(session.id)).revert?.messageID).toBe(boundaryID)
      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { type: "synthetic", payload: { text: "Plugin activated" } },
      ])
    }),
  )

  it.live("allows a Promise prompt hook to await same-Session synthetic admission", () =>
    Effect.gen(function* () {
      const s = yield* pluginSession(`async setup(ctx) {
        await ctx.session.hook("prompt", async (event) => {
          await ctx.session.switchModel({ sessionID: event.sessionID, model: { providerID: "provider", id: "hook-model" } })
          await ctx.session.synthetic({ sessionID: event.sessionID, text: "Hook", resume: false })
          event.prompt.text += " prepared"
        })
      }`)
      const prompt = yield* s.sessions.prompt({ sessionID: s.session.id, text: "Original", resume: false })
      expect(yield* s.sessions.inbox(s.session.id)).toMatchObject([
        { type: "synthetic", payload: { text: "Hook" } },
        { id: prompt.id, type: "user", payload: { text: "Original prepared" } },
      ])
    }),
  )

  it.live("keeps concurrent same-Session Promise hooks reentrant and ordered", () =>
    Effect.gen(function* () {
      const s = yield* pluginSession(`async setup(ctx) {
        let entered = 0
        let release
        const ready = new Promise((resolve) => release = resolve)
        await ctx.session.hook("prompt", async (event) => {
          if (++entered === 2) release()
          await ready
          await ctx.session.synthetic({ sessionID: event.sessionID, text: "Hook: " + event.prompt.text, resume: false })
        })
      }`)
      yield* Effect.all(
        [
          s.sessions.prompt({ sessionID: s.session.id, text: "First", resume: false }),
          s.sessions.prompt({ sessionID: s.session.id, text: "Second", resume: false }),
        ],
        { concurrency: "unbounded" },
      )
      const inbox = yield* s.sessions.inbox(s.session.id)
      const text = inbox.map((item) => ("text" in item.payload ? item.payload.text : undefined))
      expect(inbox.map((item) => item.type)).toEqual(["synthetic", "user", "synthetic", "user"])
      expect(text[0]).toBe(`Hook: ${text[1]}`)
      expect(text[2]).toBe(`Hook: ${text[3]}`)
    }),
  )

  it.live("drains detached Promise hook admissions before capability expiration", () =>
    Effect.gen(function* () {
      const s = yield* pluginSession(`async setup(ctx) {
        await ctx.session.hook("prompt", (event) => {
          void ctx.session.synthetic({ sessionID: event.sessionID, text: "Detached", resume: false })
        })
      }`)
      const prompt = yield* s.sessions.prompt({ sessionID: s.session.id, text: "Prompt", resume: false })
      expect(yield* s.sessions.inbox(s.session.id)).toMatchObject([
        { type: "synthetic", payload: { text: "Detached" } },
        { id: prompt.id, type: "user" },
      ])
    }),
  )

  it.live("expires Promise hook admission after success and failure", () =>
    Effect.gen(function* () {
      const s = yield* pluginSession(`async setup(ctx) {
        await ctx.session.hook("prompt", (event) => {
          queueMicrotask(() => queueMicrotask(() => void ctx.session.synthetic({
            sessionID: event.sessionID, text: "Late: " + event.prompt.text, resume: false,
          })))
          if (event.prompt.text === "Fail") throw new Error("Hook failed")
        })
      }`)
      const prompt = yield* s.sessions.prompt({ sessionID: s.session.id, text: "Success", resume: false })
      const first = yield* s.sessions.synthetic({ sessionID: s.session.id, text: "First barrier", resume: false })
      expect(
        (yield* s.sessions.prompt({ sessionID: s.session.id, text: "Fail", resume: false }).pipe(Effect.exit))._tag,
      ).toBe("Failure")
      const second = yield* s.sessions.synthetic({ sessionID: s.session.id, text: "Second barrier", resume: false })
      expect(yield* s.sessions.inbox(s.session.id)).toMatchObject([
        { id: prompt.id, type: "user" },
        { type: "synthetic", payload: { text: "Late: Success" } },
        { id: first.id, type: "synthetic" },
        { type: "synthetic", payload: { text: "Late: Fail" } },
        { id: second.id, type: "synthetic" },
      ])
    }),
  )

  for (const phase of ["callback", "success drain", "failure drain"] as const) {
    it.live(`cancels detached hook admission during ${phase} before preparation expires`, () =>
      Effect.gen(function* () {
        const signalID = Session.ID.make("ses_hook_signal")
        const s = yield* pluginSession(`async setup(ctx) {
        await ctx.session.hook("prompt", async (event) => {
          if (event.prompt.text !== "Second") return
          void ctx.session.synthetic({ sessionID: event.sessionID, text: "Detached", resume: false })
          ${
            phase === "callback"
              ? `await ctx.session.synthetic({ sessionID: "${signalID}", text: "Hook started", resume: false }); await new Promise(() => {})`
              : `setTimeout(() => void ctx.session.synthetic({ sessionID: "${signalID}", text: "Hook returned", resume: false }), 0);
               ${phase === "failure drain" ? 'throw new Error("Hook failed")' : "return"}`
          }
        })
      }`)
        yield* s.sessions.create({ id: signalID, location: s.session.location })
        const hooks = yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          return yield* PluginHooks.Service
        }).pipe(Effect.provide(LocationServiceMap.Service.get(s.session.location)))
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* hooks.register("session", "prompt", (event) =>
          event.prompt.text === "First"
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
        )
        const bus = yield* Bus.Service
        const started = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
          Stream.filter((event) => event.data.sessionID === signalID),
          Stream.runHead,
          Effect.forkScoped({ startImmediately: true }),
        )
        try {
          const first = yield* s.sessions
            .prompt({ sessionID: s.session.id, text: "First", resume: false })
            .pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          const second = yield* s.sessions
            .prompt({ sessionID: s.session.id, text: "Second", resume: false })
            .pipe(Effect.forkChild)
          yield* Fiber.join(started)
          const interrupted = yield* Fiber.interrupt(second).pipe(Effect.timeout("1 second"), Effect.exit)
          expect(Exit.isSuccess(interrupted)).toBe(true)
          const exit = yield* Fiber.await(second)
          expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
          expect(yield* Deferred.isDone(release)).toBe(false)
          yield* Deferred.succeed(release, undefined)
          const admitted = yield* Fiber.join(first)
          const barrier = yield* s.sessions.synthetic({ sessionID: s.session.id, text: "Barrier", resume: false })
          expect(yield* s.sessions.inbox(s.session.id)).toMatchObject([
            { id: admitted.id, type: "user", payload: { text: "First" } },
            { id: barrier.id, type: "synthetic", payload: { text: "Barrier" } },
          ])
        } finally {
          yield* Deferred.succeed(release, undefined)
        }
      }),
    )
  }

  it.live("does not bridge unrelated Promise work while a hook is active", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/admission.ts"),
          `export default { id: "unrelated", async setup(ctx) {
            let start
            const started = new Promise((resolve) => start = resolve)
            void started.then(() => ctx.session.synthetic({ sessionID: "${session.id}", text: "Unrelated", resume: false }))
            await ctx.session.hook("prompt", async () => {
              start()
              await new Promise((resolve) => setTimeout(resolve, 50))
            })
          } }`,
        ),
      )
      const prompt = yield* sessions.prompt({ sessionID: session.id, text: "Prompt", resume: false })
      const barrier = yield* sessions.synthetic({ sessionID: session.id, text: "Barrier", resume: false })
      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { id: prompt.id, type: "user" },
        { type: "synthetic", payload: { text: "Unrelated" } },
        { id: barrier.id, type: "synthetic" },
      ])
    }),
  )
})
