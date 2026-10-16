export * as SessionInput from "./session-input.js"

import type { SessionApi } from "./api.js"
import { isMessageNotFoundError } from "./generated/index.js"

/** Cancel acknowledgement alone cannot distinguish withdrawal from prior delivery. */
export async function withdraw(
  api: Pick<SessionApi, "inbox" | "message">,
  input: { sessionID: string; inboxID: string },
  options?: { signal?: AbortSignal },
) {
  await api.inbox.cancel(input, options)
  return api.message.get({ sessionID: input.sessionID, messageID: input.inboxID }, options).then(
    () => "delivered" as const,
    (error: unknown) => {
      if (isMessageNotFoundError(error)) return "withdrawn" as const
      throw error
    },
  )
}
