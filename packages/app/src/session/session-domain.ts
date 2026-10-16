import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"

export function selectSessionUserMessages(messages: SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

export function selectVisibleSessionUserMessages(messages: SessionMessageUser[], revertMessageID?: string) {
  if (!revertMessageID) return messages

  const boundary = messages.findIndex((message) => message.id === revertMessageID)
  return boundary < 0 ? [] : messages.slice(0, boundary)
}

export async function loadUndoTarget(input: {
  messageID: string
  messages: () => SessionMessageUser[]
  more: () => boolean
  loadMore: () => Promise<void>
}): Promise<{ message: SessionMessageUser; previous?: SessionMessageUser } | undefined> {
  const messages = input.messages()
  const boundary = messages.findIndex((message) => message.id === input.messageID)
  if (boundary >= 2 || (boundary === 1 && !input.more()))
    return { message: messages[boundary - 1], previous: messages[boundary - 2] }
  if (!input.more()) return
  await input.loadMore()
  return loadUndoTarget(input)
}
