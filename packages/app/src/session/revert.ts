import type { SessionMessageUser } from "@opencode/client/promise"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { promptLength } from "@/composer/prompt-parts"
import { showToast } from "@/shell/notifications/toast"
import type { SessionModel } from "./model"
import { loadUndoTarget, selectSessionUserMessages } from "./session-domain"

export function createSessionRevert(input: {
  session: SessionModel
  setActiveMessage: (message: SessionMessageUser | undefined) => void
}) {
  const prompt = useComposerState()
  const server = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  const failed = (error: Error) => showToast({ title: language.t("common.requestFailed"), description: error.message })
  const request = async <A>(action: () => Promise<A>) =>
    action().then(
      () => true,
      (error) => {
        failed(error instanceof Error ? error : new Error(String(error)))
        return false
      },
    )

  // Capture route-owned state before entering the mutation chain: navigation can happen while it waits.
  const capture = () => {
    const sessionID = input.session.identity.params.id
    if (!sessionID) return
    const messages = data.session.message.capture(sessionID)
    return {
      sessionID,
      owner: input.session.ownership.capture(),
      target: prompt.capture(),
      directory: location().directory,
      messages: () => selectSessionUserMessages(messages()),
    }
  }

  const restore = (operation: NonNullable<ReturnType<typeof capture>>, message: SessionMessageUser) => {
    const restored = extractPromptFromMessage(message, {
      directory: operation.directory,
      attachmentName: language.t("common.attachment"),
    })
    const context = extractPromptContext(message, { directory: operation.directory })
    operation.target.set(restored, promptLength(restored))
    operation.target.context.replace([...context.comments, ...context.files])
  }

  const stage = async (
    operation: NonNullable<ReturnType<typeof capture>>,
    message: SessionMessageUser,
    previous: SessionMessageUser | undefined,
  ) => {
    const sessionID = operation.sessionID
    // Undelivered input has no history to rewind; withdraw it without interrupting active work.
    if (data.session.input.has(sessionID, message.id)) {
      if (!(await request(() => server.api.session.inbox.cancel({ sessionID, inboxID: message.id })))) return
      restore(operation, message)
      operation.owner.run(() => input.setActiveMessage(previous))
      return
    }
    // Interruption acknowledges before execution settles; local status may lag either way.
    if (!(await request(() => server.api.session.interrupt({ sessionID })))) return
    if (!(await request(() => server.api.session.wait({ sessionID })))) return
    if (
      !(await request(async () => {
        const revert = await server.api.session.revert.stage({ sessionID, messageID: message.id })
        const current = data.session.get(sessionID)
        if (current) data.session.remember({ ...current, revert })
      }))
    )
      return
    // Pending inputs stay parked until replacement commits the boundary or redo clears it.
    restore(operation, message)
    operation.owner.run(() => input.setActiveMessage(previous))
  }

  const to = async (messageID: string) => {
    const operation = capture()
    if (!operation) return
    await data.session.mutate(operation.sessionID, async () => {
      const messages = operation.messages()
      const index = messages.findIndex((message) => message.id === messageID)
      const message = messages[index]
      if (message) await stage(operation, message, messages[index - 1])
    })
  }

  const undo = async () => {
    const operation = capture()
    if (!operation) return
    await data.session.mutate(operation.sessionID, async () => {
      const reverted = data.session.get(operation.sessionID)?.revert?.messageID
      const messages = operation.messages()
      if (!reverted) {
        const message = messages.at(-1)
        if (message) await stage(operation, message, messages.at(-2))
        return
      }
      const target = await loadUndoTarget({
        messageID: reverted,
        messages: operation.messages,
        more: () => data.session.message.more(operation.sessionID),
        loadMore: () => data.session.message.loadMore(operation.sessionID),
      }).catch((error) => {
        failed(error instanceof Error ? error : new Error(String(error)))
        return undefined
      })
      if (target) await stage(operation, target.message, target.previous)
    })
  }

  const redo = async () => {
    const operation = capture()
    if (!operation) return
    await data.session.mutate(operation.sessionID, async () => {
      if (!data.session.get(operation.sessionID)?.revert) return
      // Redo restores all history without changing the composer's draft or context.
      if (!(await request(() => server.api.session.revert.clear({ sessionID: operation.sessionID })))) return
      const current = data.session.get(operation.sessionID)
      if (current) data.session.remember({ ...current, revert: undefined })
      operation.owner.run(() =>
        input.setActiveMessage(
          operation
            .messages()
            .filter((message) => !data.session.input.has(operation.sessionID, message.id))
            .at(-1),
        ),
      )
    })
  }

  return { to, undo, redo }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
