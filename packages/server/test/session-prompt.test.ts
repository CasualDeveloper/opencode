import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const InboxResponse = Schema.Struct({ data: Schema.Array(Schema.toEncoded(SessionInbox.Info)) })

it.live("admits selection and context through HTTP, preserving state on rejection and retry", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )
    const created = yield* post("/api/session", { agent: "build", model: { providerID: "test", id: "initial" } })
    expect(created.status).toBe(200)
    const session = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => created.json())).data
    const selection = { agent: "review", model: { providerID: "test", id: "selected", variant: "high" } }
    const context = {
      id: "msg_http_context",
      text: "editor context",
      description: "editor",
      metadata: { source: "editor" },
    }
    const prompt = `/api/session/${session.id}/prompt`
    const current = () =>
      Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/session/${session.id}`)).then((response) => response.json()),
      ).pipe(Effect.map(Schema.decodeUnknownSync(SessionResponse)))
    const inbox = () =>
      Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/session/${session.id}/inbox`)).then((response) =>
          response.json(),
        ),
      ).pipe(Effect.map(Schema.decodeUnknownSync(InboxResponse)))
    const rejected = yield* post(prompt, {
      text: "rejected",
      selection,
      context,
      files: [{ uri: "data:image/png;base64,invalid" }],
      resume: false,
    })
    expect(rejected.status).toBe(400)
    expect((yield* current()).data).toMatchObject({ agent: "build", model: { id: "initial" } })
    expect((yield* inbox()).data).toEqual([])
    const queued = yield* post(prompt, { text: "queued", selection, context, delivery: "queue", resume: false })
    expect(queued.status).toBe(400)
    expect(yield* Effect.promise(() => queued.json())).toMatchObject({ _tag: "InvalidRequestError", field: "delivery" })
    expect((yield* current()).data).toMatchObject({ agent: "build", model: { id: "initial" } })
    expect((yield* inbox()).data).toEqual([])
    const accepted = yield* post(prompt, { id: "msg_http_prompt", text: "accepted", selection, context, resume: false })
    expect(accepted.status).toBe(200)
    expect((yield* current()).data).toMatchObject(selection)
    expect((yield* inbox()).data).toMatchObject([
      {
        id: context.id,
        type: "synthetic",
        payload: { text: context.text, description: context.description, metadata: context.metadata },
      },
      { id: "msg_http_prompt", type: "user", payload: { text: "accepted" } },
    ])
    const retry = yield* post(prompt, {
      id: "msg_http_prompt",
      text: "ignored",
      selection: { ...selection, agent: "build" },
      context: { ...context, id: "msg_http_ignored" },
      resume: false,
    })
    expect(retry.status).toBe(200)
    expect((yield* current()).data).toMatchObject(selection)
    expect((yield* inbox()).data.map((item) => item.id)).toEqual([context.id, "msg_http_prompt"])
  }).pipe(Effect.scoped),
)
