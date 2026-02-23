import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://t3.chat/*"],
  run_at: "document_start"
}

const POPUP_REQUEST_TYPE = "__t3_usage_overlay_get_state"
const BRIDGE_REQUEST_TYPE = "__t3_usage_overlay_bridge_request_state"
const BRIDGE_RESPONSE_TYPE = "__t3_usage_overlay_bridge_state"

type UsageState = {
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

type PopupMessageResponse = {
  ok: boolean
  state: UsageState | null
  status: string
  error: string | null
}

declare global {
  interface Window {
    __t3UsageOverlayPopupBridgePatched?: boolean
  }
}

const requestMainWorldState = async (): Promise<PopupMessageResponse> => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return await new Promise<PopupMessageResponse>((resolve) => {
    let isResolved = false
    const cleanup = (): void => {
      window.removeEventListener("message", onMessage)
      clearTimeout(timeoutId)
    }

    const resolveOnce = (response: PopupMessageResponse): void => {
      if (isResolved) {
        return
      }
      isResolved = true
      cleanup()
      resolve(response)
    }

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || !event.data || typeof event.data !== "object") {
        return
      }

      const message = event.data as Record<string, unknown>
      if (
        message.type !== BRIDGE_RESPONSE_TYPE ||
        message.requestId !== requestId ||
        !message.payload ||
        typeof message.payload !== "object"
      ) {
        return
      }

      const payload = message.payload as Record<string, unknown>
      resolveOnce({
        ok: payload.ok === true,
        state: (payload.state as UsageState | null) ?? null,
        status: typeof payload.status === "string" ? payload.status : "No status from page",
        error: typeof payload.error === "string" ? payload.error : null
      })
    }

    const timeoutId = setTimeout(() => {
      resolveOnce({
        ok: false,
        state: null,
        status: "Timed out reading usage state",
        error: "The page did not respond in time."
      })
    }, 1200)

    window.addEventListener("message", onMessage)
    window.postMessage({ type: BRIDGE_REQUEST_TYPE, requestId }, "*")
  })
}

const installPopupBridge = (): void => {
  if (window.__t3UsageOverlayPopupBridgePatched) {
    return
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false
    }

    const messageRecord = message as Record<string, unknown>
    if (messageRecord.type !== POPUP_REQUEST_TYPE) {
      return false
    }

    void requestMainWorldState().then(sendResponse)
    return true
  })

  window.__t3UsageOverlayPopupBridgePatched = true
}

installPopupBridge()
