import { mediaHashFromUri, type OpenCodeClient } from "@opencode/client/promise"

export { mediaHashFromUri }

export type MediaCache = {
  peek(uri: string, mime?: string): string | undefined
  load(uri: string, mime?: string, signal?: AbortSignal): Promise<string | undefined>
  dispose(): void
}

// Object URLs stay valid until dispose. Rendered attachments, image previews and composer drafts keep the URL they
// were given without releasing it, so revoking one earlier would break an image that is still on screen.
export function createMediaCache(getApi: () => Pick<OpenCodeClient, "experimental">): MediaCache {
  const urls = new Map<string, string>()
  const inflight = new Map<string, ReturnType<typeof start>>()
  let disposed = false

  function start(hash: string, mime: string) {
    const controller = new AbortController()
    const promise = getApi()
      .experimental.media.get({ hash }, { signal: controller.signal })
      .then((bytes) => {
        if (disposed || controller.signal.aborted) return undefined

        const url =
          urls.get(hash) ??
          URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime || "application/octet-stream" }))

        urls.set(hash, url)

        return url
      })
      .catch((error) => {
        if (!controller.signal.aborted) throw error
        return undefined
      })
      .finally(() => {
        if (inflight.get(hash)?.promise === promise) inflight.delete(hash)
      })
    return { controller, promise, readers: 0 }
  }

  const read = (hash: string, mime: string) => {
    const pending = inflight.get(hash) ?? start(hash, mime)

    inflight.set(hash, pending)

    return pending
  }

  return {
    peek(uri) {
      const hash = mediaHashFromUri(uri)

      if (disposed || !hash) return undefined

      return urls.get(hash)
    },
    load(uri, mime = "application/octet-stream", signal) {
      const hash = mediaHashFromUri(uri)

      if (disposed || signal?.aborted) return Promise.resolve(undefined)

      if (!hash) return Promise.resolve(uri)
      const cached = urls.get(hash)

      if (cached) return Promise.resolve(cached)
      const pending = read(hash, mime)
      pending.readers++
      const release = () => {
        if (--pending.readers !== 0 || inflight.get(hash) !== pending) return
        inflight.delete(hash)
        pending.controller.abort()
      }

      if (!signal) return pending.promise.finally(release)

      return new Promise<string | undefined>((resolve, reject) => {
        const onAbort = () => resolve(undefined)

        signal.addEventListener("abort", onAbort, { once: true })
        pending.promise.then(
          (url) => {
            signal.removeEventListener("abort", onAbort)
            resolve(signal.aborted ? undefined : url)
          },
          (error) => {
            signal.removeEventListener("abort", onAbort)

            if (signal.aborted) resolve(undefined)
            else reject(error)
          },
        )
      }).finally(release)
    },
    dispose() {
      disposed = true
      inflight.forEach((pending) => pending.controller.abort())
      inflight.clear()
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}
