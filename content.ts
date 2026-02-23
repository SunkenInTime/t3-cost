import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://t3.chat/*"],
  run_at: "document_start",
  world: "MAIN"
}

const FETCH_TARGET_PATH = "/api/trpc/getCustomerData"
const BRIDGE_REQUEST_TYPE = "__t3_usage_overlay_bridge_request_state"
const BRIDGE_RESPONSE_TYPE = "__t3_usage_overlay_bridge_state"
const CHAT_FORM_SELECTOR = "#chat-input-form"
const INLINE_BADGE_ID = "__t3-usage-inline-badge"
const INLINE_BADGE_ROW_ID = "__t3-usage-inline-badge-row"
const DEBUG = true

type UsagePayload = {
  subTier: string | null
  usageBand: string | null
  billingNextResetAt: number | string | null
  subscription: {
    productId: string | null
    productName: string | null
    status: string | null
    currentPeriodStart: number | string | null
    currentPeriodEnd: number | string | null
    canceledAt: number | string | null
    trialEndsAt: number | string | null
  } | null
  usagePeriodPercentage: number
  lifetimeBalance: number | string
  usageWindowNextResetAt: number | string | null
}

type OverlayState = {
  subTier: string | null
  usageBand: string | null
  billingNextResetAt: number | string | null
  subscription: {
    productId: string | null
    productName: string | null
    status: string | null
    currentPeriodStart: number | string | null
    currentPeriodEnd: number | string | null
    canceledAt: number | string | null
    trialEndsAt: number | string | null
  } | null
  usagePeriodPercentage: number
  lifetimeBalance: number | string
  usageWindowNextResetAt: number | string | null
  deltaPercentage: number | null
}

declare global {
  interface Window {
    __t3UsageOverlayFetchPatched?: boolean
    __t3UsageOverlayBridgePatched?: boolean
    __t3UsageOverlayDebug?: {
      bootedAtIso: string
      matchedRequestCount: number
      lastMatchedUrl: string | null
      lastStatus: string
      lastError: string | null
      latestState: OverlayState | null
    }
  }
}

let lastUsagePeriodPercentage: number | null = null
let latestState: OverlayState | null = null
let inlineBadgeElement: HTMLDivElement | null = null
let inlineBadgeRowElement: HTMLDivElement | null = null
let matchedRequestCount = 0
let lastMatchedUrl: string | null = null
let lastStatus = "Booting..."
let lastError: string | null = null
const bootedAtIso = new Date().toISOString()
let reattachTimer: number | null = null

const debugLog = (...args: unknown[]): void => {
  if (!DEBUG) {
    return
  }

  console.log("[t3-usage-overlay]", ...args)
}

const syncDebugState = (): void => {
  window.__t3UsageOverlayDebug = {
    bootedAtIso,
    matchedRequestCount,
    lastMatchedUrl,
    lastStatus,
    lastError,
    latestState
  }
}

const setStatus = (status: string, error?: unknown): void => {
  lastStatus = status
  if (error === undefined) {
    lastError = null
  } else if (error instanceof Error) {
    lastError = `${error.name}: ${error.message}`
  } else if (typeof error === "string") {
    lastError = error
  } else {
    lastError = String(error)
  }

  syncDebugState()
  debugLog(status, error ?? "")
  renderUsageBadge()
}

const parseNumericValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const parseUsagePayload = (jsonValue: unknown): UsagePayload | null => {
  const toUsagePayload = (value: unknown): UsagePayload | null => {
    if (!value || typeof value !== "object") {
      return null
    }

    const usageRecord = value as Record<string, unknown>
    const subTier = typeof usageRecord.subTier === "string" ? usageRecord.subTier : null
    const usageBand =
      typeof usageRecord.usageBand === "string" ? usageRecord.usageBand : null
    const billingNextResetAt =
      typeof usageRecord.billingNextResetAt === "number" ||
      typeof usageRecord.billingNextResetAt === "string"
        ? usageRecord.billingNextResetAt
        : null

    const rawSubscription = usageRecord.subscription
    const subscription =
      rawSubscription && typeof rawSubscription === "object"
        ? (() => {
            const subscriptionRecord = rawSubscription as Record<string, unknown>
            const productId =
              typeof subscriptionRecord.productId === "string"
                ? subscriptionRecord.productId
                : null
            const productName =
              typeof subscriptionRecord.productName === "string"
                ? subscriptionRecord.productName
                : null
            const status =
              typeof subscriptionRecord.status === "string" ? subscriptionRecord.status : null
            const currentPeriodStart =
              typeof subscriptionRecord.currentPeriodStart === "number" ||
              typeof subscriptionRecord.currentPeriodStart === "string"
                ? subscriptionRecord.currentPeriodStart
                : null
            const currentPeriodEnd =
              typeof subscriptionRecord.currentPeriodEnd === "number" ||
              typeof subscriptionRecord.currentPeriodEnd === "string"
                ? subscriptionRecord.currentPeriodEnd
                : null
            const canceledAt =
              typeof subscriptionRecord.canceledAt === "number" ||
              typeof subscriptionRecord.canceledAt === "string"
                ? subscriptionRecord.canceledAt
                : null
            const trialEndsAt =
              typeof subscriptionRecord.trialEndsAt === "number" ||
              typeof subscriptionRecord.trialEndsAt === "string"
                ? subscriptionRecord.trialEndsAt
                : null

            return {
              productId,
              productName,
              status,
              currentPeriodStart,
              currentPeriodEnd,
              canceledAt,
              trialEndsAt
            }
          })()
        : null
    const usagePeriodPercentage = parseNumericValue(usageRecord.usagePeriodPercentage)
    const lifetimeBalance = usageRecord.lifetimeBalance
    const usageWindowNextResetAt =
      typeof usageRecord.usageWindowNextResetAt === "number" ||
      typeof usageRecord.usageWindowNextResetAt === "string"
        ? usageRecord.usageWindowNextResetAt
        : usageRecord.usageWindowNextResetAt === null
          ? null
          : undefined

    if (
      usagePeriodPercentage === null ||
      (typeof lifetimeBalance !== "number" && typeof lifetimeBalance !== "string") ||
      usageWindowNextResetAt === undefined
    ) {
      return null
    }

    return {
      subTier,
      usageBand,
      billingNextResetAt,
      subscription,
      usagePeriodPercentage,
      lifetimeBalance,
      usageWindowNextResetAt
    }
  }

  // Preferred path for tRPC response shape.
  if (Array.isArray(jsonValue)) {
    const directPayload = toUsagePayload(jsonValue?.[2]?.[2]?.[0])
    if (directPayload) {
      return directPayload
    }
  }

  // Fallback: scan nested structures for the target keys.
  const queue: unknown[] = [jsonValue]
  const seen = new WeakSet<object>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== "object") {
      continue
    }

    const payload = toUsagePayload(current)
    if (payload) {
      return payload
    }

    if (seen.has(current)) {
      continue
    }
    seen.add(current)

    if (Array.isArray(current)) {
      for (const item of current) {
        if (item && typeof item === "object") {
          queue.push(item)
        }
      }
      continue
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        queue.push(value)
      }
    }
  }

  return null
}

const parseJsonFromLine = (line: string): unknown | null => {
  try {
    return JSON.parse(line) as unknown
  } catch {
    // Some streaming formats prefix JSON with metadata before the JSON payload.
    const jsonStart = Math.min(
      ...[line.indexOf("{"), line.indexOf("[")].filter((idx) => idx >= 0)
    )
    if (!Number.isFinite(jsonStart)) {
      return null
    }

    const candidate = line.slice(jsonStart)
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      return null
    }
  }
}

const parsePayloadFromBody = (bodyText: string): UsagePayload | null => {
  const lines = bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  let latestPayload: UsagePayload | null = null
  for (const line of lines) {
    const parsed = parseJsonFromLine(line)
    if (!parsed) {
      continue
    }

    const payload = parseUsagePayload(parsed)
    if (payload) {
      latestPayload = payload
    }
  }

  return latestPayload
}

const parsePayloadFromBodyAsJson = (bodyText: string): UsagePayload | null => {
  try {
    const parsed = JSON.parse(bodyText) as unknown
    return parseUsagePayload(parsed)
  } catch {
    return null
  }
}

const parseResetTimeMs = (value: number | string): number | null => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null
    }

    return value > 1_000_000_000_000 ? value : value * 1000
  }

  const numericValue = Number.parseFloat(value)
  if (Number.isFinite(numericValue) && /^\d+(\.\d+)?$/.test(value)) {
    return numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000
  }

  const parsedDate = Date.parse(value)
  return Number.isNaN(parsedDate) ? null : parsedDate
}

const formatPercent = (value: number): string => `${value.toFixed(2)}%`

const formatSignedPercent = (value: number | null): string =>
  value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`

const formatBalance = (value: number | string): string =>
  typeof value === "number" ? value.toLocaleString() : value

const formatResetDateTime = (resetAt: number | string | null): string => {
  if (resetAt === null) {
    return "Unknown"
  }

  const resetTimeMs = parseResetTimeMs(resetAt)
  if (resetTimeMs === null) {
    return "Unknown"
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })

  return formatter.format(new Date(resetTimeMs))
}

const getBadgeAnchorElement = (): HTMLElement | null => {
  const chatForm = document.querySelector(CHAT_FORM_SELECTOR) as HTMLElement | null
  if (!chatForm) {
    return null
  }

  return (
    (chatForm.closest("div.pointer-events-auto") as HTMLElement | null) ?? chatForm
  )
}

const ensureUsageBadge = (): HTMLDivElement | null => {
  const anchorElement = getBadgeAnchorElement()
  const anchorParent = anchorElement?.parentElement
  if (!anchorElement || !anchorParent) {
    return null
  }

  if (!inlineBadgeRowElement) {
    inlineBadgeRowElement = document.createElement("div")
    inlineBadgeRowElement.id = INLINE_BADGE_ROW_ID
    Object.assign(inlineBadgeRowElement.style, {
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: "6px",
      pointerEvents: "none"
    } satisfies Partial<CSSStyleDeclaration>)
  }

  if (
    !inlineBadgeRowElement.isConnected ||
    inlineBadgeRowElement.parentElement !== anchorParent ||
    inlineBadgeRowElement.nextElementSibling !== anchorElement
  ) {
    anchorParent.insertBefore(inlineBadgeRowElement, anchorElement)
  }

  if (!inlineBadgeElement) {
    inlineBadgeElement = document.createElement("div")
    inlineBadgeElement.id = INLINE_BADGE_ID
    Object.assign(inlineBadgeElement.style, {
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      lineHeight: "1.2",
      fontWeight: "600",
      letterSpacing: "0.01em",
      background: "var(--chat-input-background, rgba(31, 26, 36, 0.9))",
      color: "var(--foreground, #f9f8fb)",
      border: "1px solid var(--chat-border, rgba(255, 255, 255, 0.12))",
      boxShadow:
        "0 4px 12px rgba(0, 0, 0, 0.24), inset 0 0 0 1px var(--chat-input-gradient, rgba(67, 45, 72, 0.5))",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      backdropFilter: "blur(6px)"
    } satisfies Partial<CSSStyleDeclaration>)
  }

  if (
    !inlineBadgeElement.isConnected ||
    inlineBadgeElement.parentElement !== inlineBadgeRowElement
  ) {
    inlineBadgeRowElement.appendChild(inlineBadgeElement)
  }

  return inlineBadgeElement
}

const renderUsageBadge = (): void => {
  const badge = ensureUsageBadge()
  if (!badge) {
    return
  }

  const lastMessageUsage = latestState ? formatSignedPercent(latestState.deltaPercentage) : "-"
  const currentUsage = latestState ? formatPercent(latestState.usagePeriodPercentage) : "..."

  badge.textContent = `Last: ${lastMessageUsage} | Current: ${currentUsage}`

  if (DEBUG) {
    const debugTitle = [
      `Status: ${lastStatus}`,
      `Matches: ${matchedRequestCount}`,
      `Lifetime: ${latestState ? formatBalance(latestState.lifetimeBalance) : "n/a"}`,
      `Resets at: ${
        latestState ? formatResetDateTime(latestState.usageWindowNextResetAt) : "n/a"
      }`,
      `URL: ${lastMatchedUrl ?? "n/a"}`,
      `Error: ${lastError ?? "none"}`
    ].join("\n")
    badge.title = debugTitle
  }
}

const ensureReattachTick = (): void => {
  if (reattachTimer !== null) {
    return
  }

  // Lightweight periodic reattach instead of a global mutation observer.
  reattachTimer = window.setInterval(() => {
    const anchorElement = getBadgeAnchorElement()
    const shouldReattach =
      !inlineBadgeElement ||
      !inlineBadgeElement.isConnected ||
      !inlineBadgeRowElement ||
      !inlineBadgeRowElement.isConnected ||
      !anchorElement ||
      inlineBadgeRowElement.parentElement !== anchorElement.parentElement ||
      inlineBadgeRowElement.nextElementSibling !== anchorElement

    if (shouldReattach) {
      renderUsageBadge()
    }
  }, 2000)
}

const resolveRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === "AbortError"
  }

  if (error instanceof Error) {
    return error.name === "AbortError"
  }

  return false
}

const processTargetResponse = async (
  response: Response,
  requestUrl: string,
  originalFetch: typeof window.fetch
): Promise<void> => {
  let bodyText = ""
  try {
    bodyText = await response.text()
  } catch (error) {
    if (isAbortError(error)) {
      setStatus("Response body aborted; trying fallback fetch")
      try {
        const retryResponse = await originalFetch(requestUrl, {
          credentials: "include",
          cache: "no-store"
        })
        bodyText = await retryResponse.text()
      } catch (retryError) {
        setStatus("Fallback fetch failed", retryError)
        return
      }
    } else {
      setStatus("Failed reading response body", error)
      return
    }
  }

  if (!bodyText) {
    setStatus("Response body was empty")
    return
  }

  let latestPayload = parsePayloadFromBody(bodyText)
  if (!latestPayload) {
    latestPayload = parsePayloadFromBodyAsJson(bodyText)
  }

  if (!latestPayload) {
    setStatus("Matched request without usage payload (likely warm-up response)")
    return
  }

  const deltaPercentage =
    lastUsagePeriodPercentage === null
      ? null
      : latestPayload.usagePeriodPercentage - lastUsagePeriodPercentage

  lastUsagePeriodPercentage = latestPayload.usagePeriodPercentage
  latestState = {
    subTier: latestPayload.subTier,
    usageBand: latestPayload.usageBand,
    billingNextResetAt: latestPayload.billingNextResetAt,
    subscription: latestPayload.subscription,
    usagePeriodPercentage: latestPayload.usagePeriodPercentage,
    lifetimeBalance: latestPayload.lifetimeBalance,
    usageWindowNextResetAt: latestPayload.usageWindowNextResetAt,
    deltaPercentage
  }

  setStatus("Usage payload parsed successfully")
}

const installFetchPatch = (): void => {
  if (window.__t3UsageOverlayFetchPatched) {
    setStatus("Fetch patch already installed")
    return
  }

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)

    let requestUrl = ""
    try {
      requestUrl = resolveRequestUrl(input)
    } catch (error) {
      setStatus("Could not resolve request URL", error)
    }

    if (requestUrl.includes(FETCH_TARGET_PATH)) {
      matchedRequestCount += 1
      lastMatchedUrl = requestUrl
      setStatus("Matched target request")
      void processTargetResponse(response.clone(), requestUrl, originalFetch)
    }

    return response
  }

  window.__t3UsageOverlayFetchPatched = true
  setStatus("Fetch patch installed in MAIN world")
}

const installBridgeHandler = (): void => {
  if (window.__t3UsageOverlayBridgePatched) {
    return
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || typeof event.data !== "object") {
      return
    }

    const messageRecord = event.data as Record<string, unknown>
    if (
      messageRecord.type !== BRIDGE_REQUEST_TYPE ||
      typeof messageRecord.requestId !== "string"
    ) {
      return
    }

    window.postMessage(
      {
        type: BRIDGE_RESPONSE_TYPE,
        requestId: messageRecord.requestId,
        payload: {
          ok: true,
          state: latestState,
          status: lastStatus,
          error: lastError
        }
      },
      "*"
    )
  })

  window.__t3UsageOverlayBridgePatched = true
}

ensureReattachTick()
renderUsageBadge()
setStatus("Content script loaded")
installFetchPatch()
installBridgeHandler()
