import { blobDataUrl, pinMediaBlob } from "@/runtime/persistence/drafts"
import { mediaHashFromUri } from "@/runtime/server/media"
import type { Prompt } from "./state"

/** {@link pinMediaBlob} for every `media:<hash>` image and file in a prompt, before its server copy can be swept. */
export async function pinPromptMedia(prompt: Prompt, signal?: AbortSignal): Promise<Prompt> {
  signal?.throwIfAborted()
  const pinned = Promise.all(
    prompt.map(async (part) => {
      if (part.type === "image") return { ...part, blob: await pinMediaBlob(part.blob, signal) }
      const url = part.type === "file" ? part.url : undefined

      if (part.type !== "file" || !url || !mediaHashFromUri(url)) return part
      const pinned = await pinMediaBlob({ id: url, url }, signal)

      return { ...part, url: await blobDataUrl(pinned, part.mime ?? "application/octet-stream") }
    }),
  )
  if (!signal) return pinned
  // Loaders and local blob reads can be shared with previews. Stop waiting without cancelling their other readers.
  return new Promise<Prompt>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    pinned.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
  })
}
