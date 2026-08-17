import type { IntegrationInfo, IntegrationMethod } from "@opencode/client/promise"

export { ServerProvider, useServer } from "../../../../../app/src/runtime/server/current"

type ProviderAuthMethod = Extract<IntegrationMethod, { type: "key" | "oauth" }>

const data = {
  provider: {
    all: new Map(),
    connected: [],
    default: {},
  },
  provider_auth: {} as Record<string, ProviderAuthMethod[]>,
  config: { disabled_providers: [] as string[] },
  location: {
    integration: {
      list: (): IntegrationInfo[] => [],
    },
  },
}

export function useData() {
  return data
}

export function mockProviderAuth(provider: string, methods: ProviderAuthMethod[]) {
  const previous = data.provider_auth[provider]
  data.provider_auth[provider] = methods
  return () => {
    if (previous) {
      data.provider_auth[provider] = previous
      return
    }
    delete data.provider_auth[provider]
  }
}
