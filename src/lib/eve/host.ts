type EveHostInput = {
  configuredHost?: string
  currentUrl?: string
  explicitHost?: string
  nodeEnv?: string
}

export function resolveEveHost({
  configuredHost,
  currentUrl,
  explicitHost,
  nodeEnv,
}: EveHostInput): string | undefined {
  const selectedHost = normalizeHost(explicitHost) ?? normalizeHost(configuredHost)
  if (selectedHost) {
    return cookieFreeLoopbackOrigin(selectedHost, currentUrl, nodeEnv)
  }
  if (nodeEnv === "production" || !currentUrl) return undefined

  const current = new URL(currentUrl)
  if (current.hostname === "localhost") {
    current.hostname = "127.0.0.1"
  } else if (current.hostname === "127.0.0.1") {
    current.hostname = "localhost"
  } else {
    return undefined
  }
  current.pathname = "/"
  current.search = ""
  current.hash = ""
  return current.origin
}

function cookieFreeLoopbackOrigin(
  selectedHost: string,
  currentUrl: string | undefined,
  nodeEnv: string | undefined,
): string {
  if (nodeEnv === "production" || !currentUrl) return selectedHost

  const selected = new URL(selectedHost)
  const current = new URL(currentUrl)
  if (selected.origin !== current.origin) return selectedHost

  if (selected.hostname === "localhost") {
    selected.hostname = "127.0.0.1"
  } else if (selected.hostname === "127.0.0.1") {
    selected.hostname = "localhost"
  } else {
    return selectedHost
  }
  return selected.origin
}

function normalizeHost(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}
