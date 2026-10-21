import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber } from "effect"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionInbox } from "@opencode/core/session/inbox"
import { PluginActivation } from "@opencode/plugin/effect/activation"
import { define } from "@opencode/plugin/promise/plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { host } from "./host"

const it = testEffect(PluginTestLayer)

const admitted = () =>
  SessionInbox.Synthetic.make({
    id: SessionMessage.ID.make("msg_setup"),
    sessionID: Session.ID.make("ses_setup"),
    type: "synthetic",
    payload: { text: "Setup work" },
    delivery: "steer",
    time: { created: DateTime.makeUnsafe(0) },
  })

describe("Promise setup admission", () => {
  for (const failure of [false, true]) {
    it.effect(`drains detached synthetic admission before setup ${failure ? "failure" : "success"}`, () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const activation: PluginActivation.State = {
          active: true,
          fiberID: yield* Effect.fiberId,
          token: {},
          directory: "/workspace",
        }
        const context = host({
          session: {
            synthetic: () =>
              Effect.gen(function* () {
                expect(yield* PluginActivation.Bridged).toBe(activation.token)
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
                return admitted()
              }).pipe(Effect.uninterruptible),
          },
        })
        const setup = yield* PluginPromise.fromPromise(
          define({
            id: "setup-drain",
            setup: (ctx) => {
              void ctx.session.synthetic({ sessionID: "ses_setup", text: "Setup work", resume: false })
              if (failure) throw new Error("Setup failed")
            },
          }),
        )
          .effect(context)
          .pipe(Effect.provideService(PluginActivation.Current, activation), Effect.exit, Effect.forkChild)
        yield* Effect.gen(function* () {
          yield* Deferred.await(entered)
          yield* Effect.yieldNow
          const beforeRelease = setup.pollUnsafe()
          yield* Deferred.succeed(release, undefined)
          const result = yield* Fiber.join(setup)
          expect(beforeRelease).toBeUndefined()
          expect(result._tag).toBe(failure ? "Failure" : "Success")
        }).pipe(
          Effect.ensuring(
            Deferred.succeed(release, undefined).pipe(Effect.andThen(Effect.sync(() => (activation.active = false)))),
          ),
        )
      }),
    )
  }

  it.effect("does not bridge a host call released after setup has returned", () =>
    Effect.gen(function* () {
      const later = Promise.withResolvers<void>()
      const called = yield* Deferred.make<boolean>()
      const activation: PluginActivation.State = {
        active: true,
        fiberID: yield* Effect.fiberId,
        token: {},
        directory: "/workspace",
      }
      const context = host({
        session: {
          synthetic: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(called, (yield* PluginActivation.Bridged) === activation.token)
              return admitted()
            }),
        },
      })
      yield* PluginPromise.fromPromise(
        define({
          id: "late-setup-call",
          setup: (ctx) => {
            void later.promise.then(() =>
              ctx.session.synthetic({ sessionID: "ses_setup", text: "Later", resume: false }),
            )
          },
        }),
      )
        .effect(context)
        .pipe(Effect.provideService(PluginActivation.Current, activation))
      later.resolve()
      expect(yield* Deferred.await(called).pipe(Effect.timeout("1 second"))).toBe(false)
      activation.active = false
    }),
  )
})
