import type { Message } from "@opencode-ai/sdk/v2"

export const windowOldest = (messages: Message[], pinned?: string) => {
  if (!pinned) return messages.at(0)?.id
  for (const msg of messages) {
    if (msg.id !== pinned) return msg.id
  }
  return undefined
}

export const windowNewest = (messages: Message[], pinned?: string) => {
  if (!pinned) return messages.at(-1)?.id
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg && msg.id !== pinned) return msg.id
  }
  return undefined
}

export const evictFromStart = (messages: Message[], count: number, pinned?: string) => {
  const evicted: Message[] = []
  if (count <= 0) return evicted
  let index = 0
  while (index < messages.length && evicted.length < count) {
    const msg = messages[index]
    if (!msg) break
    if (msg.id !== pinned) {
      evicted.push(msg)
      messages.splice(index, 1)
      continue
    }
    index += 1
  }
  return evicted
}

export const evictFromEnd = (messages: Message[], count: number, pinned?: string) => {
  const evicted: Message[] = []
  if (count <= 0) return evicted
  let index = messages.length - 1
  while (index >= 0 && evicted.length < count) {
    const msg = messages[index]
    if (!msg) break
    if (msg.id !== pinned) {
      evicted.push(msg)
      messages.splice(index, 1)
    }
    index -= 1
  }
  return evicted
}
