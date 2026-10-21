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
  const data = useData()
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  const request = async <A>(action: () => Promise<A>) =>
    action()
      .then(() => true)
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })

        return false
      })

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
    // The restored prompt replaces the draft, so chips from an earlier restore do not ride along.
    operation.target.context.replace([...context.comments, ...context.files])
  }

  const to = async (messageID: string) => {
    const operation = capture()
    if (!operation) return
    await request(() =>
      data.session.mutate(operation.sessionID, async (reservation) => {
        const messages = operation.messages()
        const index = messages.findIndex((message) => message.id === messageID)
        const message = messages[index]
        if (!message) return
        await reservation.undo(message.id)
        restore(operation, message)
        operation.owner.run(() => input.setActiveMessage(messages[index - 1]))
      }),
    )
  }

  const undo = async () => {
    const operation = capture()
    if (!operation) return
    await request(() =>
      data.session.mutate(operation.sessionID, async (reservation) => {
        const reverted = (await server.api.session.get({ sessionID: operation.sessionID })).revert?.messageID
        const messages = operation.messages()
        const target = reverted
          ? await loadUndoTarget({
              messageID: reverted,
              messages: operation.messages,
              more: () => data.session.message.more(operation.sessionID),
              loadMore: () => data.session.message.loadMore(operation.sessionID),
            })
          : { message: messages.at(-1), previous: messages.at(-2) }
        if (!target?.message) return
        await reservation.undo(target.message.id)
        restore(operation, target.message)
        operation.owner.run(() => input.setActiveMessage(target.previous))
      }),
    )
  }

  const redo = async () => {
    const operation = capture()
    if (!operation) return

    // Like the TUI, redo restores every reverted message at once and leaves the composer alone.
    if (!(await request(() => data.session.revert.clear({ sessionID: operation.sessionID })))) return
    operation.owner.run(() =>
      input.setActiveMessage(
        operation
          .messages()
          .filter((message) => !data.session.input.has(operation.sessionID, message.id))
          .at(-1),
      ),
    )
  }

  /** Puts a sent prompt back in the composer without rewinding the Session. */
  const recall = (message: SessionMessageUser) => {
    const operation = capture()
    if (operation) restore(operation, message)
  }

  return { to, undo, redo, recall }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
