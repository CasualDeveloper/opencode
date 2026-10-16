import { expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import {
  acknowledgePromptRetry,
  clearPromptRetry,
  markPromptRetryRestored,
  releasePromptRetry,
  rememberPromptRetry,
  takePromptRetry,
  type PromptRetry,
} from "../src/component/prompt/retry"

const sessionID = "ses_retry_test"
const retry = (): PromptRetry => ({
  id: SessionMessage.ID.make("msg_retry_test"),
  contextID: SessionMessage.ID.make("msg_context_test"),
  prompt: { text: "retry", files: [], agents: [], skills: [], pasted: [] },
  agent: "build",
  providerID: "provider",
  modelID: "model",
  delivery: "steer",
  contextKey: "editor",
  contextIncluded: true,
})

test("reuses a captured identity once and releases it on another failure", () => {
  clearPromptRetry(sessionID)
  const entry = retry()
  rememberPromptRetry(sessionID, entry)
  entry.prompt.text = "later edit"
  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: entry.id, contextID: entry.contextID })
  expect(takePromptRetry(sessionID, retry())).toBeUndefined()
  releasePromptRetry(sessionID, entry.id)
  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: entry.id })
  clearPromptRetry(sessionID)
})

test.each([
  { agent: "plan" },
  { providerID: "other" },
  { modelID: "other" },
  { variant: "high" },
  { delivery: "queue" as const },
  { contextKey: "other" },
  { prompt: { ...retry().prompt, text: "changed" } },
])("changed submission intent does not consume a retry: %j", (change) => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  expect(takePromptRetry(sessionID, { ...retry(), ...change })).toBeUndefined()
  expect(takePromptRetry(sessionID, retry())?.id).toBe(retry().id)
  clearPromptRetry(sessionID)
})

test.each([false, true])("acknowledgement clears restoration ownership, resubmitted=%s", (submitted) => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  markPromptRetryRestored(sessionID, retry().id)
  if (submitted) takePromptRetry(sessionID, retry())
  expect(acknowledgePromptRetry(sessionID, retry().id)?.restored).toBe(!submitted)
  expect(rememberPromptRetry(sessionID, retry())).toBe(false)
  expect(takePromptRetry(sessionID, retry())).toBeUndefined()
  clearPromptRetry(sessionID)
})

test("retains separate failure identities and evicts idle retries rather than an active claim", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  takePromptRetry(sessionID, retry())
  for (let index = 0; index < 11; index++)
    rememberPromptRetry(sessionID, {
      ...retry(),
      id: SessionMessage.ID.make(`msg_other_${index}`),
      prompt: { ...retry().prompt, text: String(index) },
    })
  releasePromptRetry(sessionID, retry().id)
  expect(takePromptRetry(sessionID, retry())?.id).toBe(retry().id)
  expect(takePromptRetry(sessionID, { ...retry(), prompt: { ...retry().prompt, text: "0" } })).toBeUndefined()
  clearPromptRetry(sessionID)
})
