import { SessionMessage } from "@opencode/schema/session-message"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { isDuplicateEntry, type PromptInfo } from "../../prompt/history"

export type PromptRetry = {
  id: SessionMessage.ID
  contextID?: SessionMessage.ID
  prompt: PromptInfo
  agent: string
  providerID: string
  modelID: string
  variant?: string
  delivery: SessionInbox.Delivery
  contextKey?: string
  contextIncluded: boolean
  restored?: boolean
}

const retries = new Map<string, PromptRetry[]>()
const claims = new Map<string, Set<string>>()
const acknowledgements = new Map<string, Set<string>>()
let order: Array<{ sessionID: string; id: SessionMessage.ID }> = []
const acknowledged: Array<{ sessionID: string; id: string }> = []

export function rememberPromptRetry(sessionID: string, retry: PromptRetry) {
  if (acknowledgements.get(sessionID)?.has(retry.id)) return false
  const current = retries.get(sessionID) ?? []
  const stored = { ...retry, prompt: structuredClone(retry.prompt) }
  const exists = current.some((item) => item.id === retry.id)
  retries.set(sessionID, exists ? current.map((item) => (item.id === retry.id ? stored : item)) : [...current, stored])
  releasePromptRetry(sessionID, retry.id)
  if (!exists) order.push({ sessionID, id: retry.id })
  while ((retries.get(sessionID)?.length ?? 0) > 10) {
    const oldest = retries.get(sessionID)?.find((item) => !claims.get(sessionID)?.has(item.id))
    if (!oldest) break
    remove(sessionID, oldest.id)
  }
  while (order.length > 20) {
    const oldest = order.find((item) => !claims.get(item.sessionID)?.has(item.id))
    if (!oldest) break
    remove(oldest.sessionID, oldest.id)
  }
  return true
}

export function takePromptRetry(
  sessionID: string,
  input: Omit<PromptRetry, "id" | "contextID" | "contextIncluded" | "restored">,
) {
  const claimed = claims.get(sessionID) ?? new Set<string>()
  const retry = retries
    .get(sessionID)
    ?.find(
      (item) =>
        !claimed.has(item.id) &&
        isDuplicateEntry(item.prompt, input.prompt) &&
        item.agent === input.agent &&
        item.providerID === input.providerID &&
        item.modelID === input.modelID &&
        (item.variant ?? "default") === (input.variant ?? "default") &&
        item.delivery === input.delivery &&
        item.contextKey === input.contextKey,
    )
  if (!retry) return
  claimed.add(retry.id)
  claims.set(sessionID, claimed)
  retries.set(
    sessionID,
    (retries.get(sessionID) ?? []).map((item) => (item.id === retry.id ? { ...item, restored: false } : item)),
  )
  return { ...retry, restored: false }
}

export function releasePromptRetry(sessionID: string, id: string) {
  const current = claims.get(sessionID)
  current?.delete(id)
  if (current?.size === 0) claims.delete(sessionID)
}

export function markPromptRetryRestored(sessionID: string, id: SessionMessage.ID) {
  const current = retries.get(sessionID)
  if (current)
    retries.set(
      sessionID,
      current.map((item) => (item.id === id ? { ...item, restored: true } : item)),
    )
}

export function acknowledgePromptRetry(sessionID: string, id: string) {
  const retry = remove(sessionID, id)
  const current = acknowledgements.get(sessionID) ?? new Set<string>()
  if (current.has(id)) return retry
  current.add(id)
  acknowledgements.set(sessionID, current)
  acknowledged.push({ sessionID, id })
  const oldest = acknowledged.length > 100 ? acknowledged.shift() : undefined
  if (oldest) {
    const remaining = acknowledgements.get(oldest.sessionID)
    remaining?.delete(oldest.id)
    if (remaining?.size === 0) acknowledgements.delete(oldest.sessionID)
  }
  return retry
}

export function clearPromptRetry(sessionID: string) {
  retries.delete(sessionID)
  claims.delete(sessionID)
  acknowledgements.delete(sessionID)
  order = order.filter((item) => item.sessionID !== sessionID)
  for (let index = acknowledged.length - 1; index >= 0; index--) {
    if (acknowledged[index].sessionID === sessionID) acknowledged.splice(index, 1)
  }
}

function remove(sessionID: string, id: string) {
  const current = retries.get(sessionID)
  const retry = current?.find((item) => item.id === id)
  releasePromptRetry(sessionID, id)
  const remaining = current?.filter((item) => item.id !== id)
  if (remaining?.length) retries.set(sessionID, remaining)
  if (!remaining?.length) retries.delete(sessionID)
  order = order.filter((item) => item.sessionID !== sessionID || item.id !== id)
  return retry
}
