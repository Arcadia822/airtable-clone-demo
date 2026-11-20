import { getDb } from "@/db/client"
import { clientIp, enforceRateLimit, jsonError, jsonOk } from "@/server/http"
import { recordPublicFormMetric } from "@/server/services/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ slug: string }>
}

/** Page views fire on load, so the metric budget is looser than submissions. */
const METRIC_LIMIT = 60
const METRIC_WINDOW_MS = 60_000

/** Closed set of breakdown dimensions the analytics pipeline understands. */
const BREAKDOWN_KINDS: Record<string, true> = {
  total: true,
  device: true,
  source: true,
}

/** Breakdown keys are opaque labels: bounded length, plain characters only. */
const BREAKDOWN_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/

function clampedMetricBody(raw: unknown): Record<string, unknown> {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const breakdownKind =
    typeof body.breakdownKind === "string" &&
    BREAKDOWN_KINDS[body.breakdownKind] === true
      ? body.breakdownKind
      : undefined
  const breakdownKey =
    typeof body.breakdownKey === "string" &&
    BREAKDOWN_KEY_PATTERN.test(body.breakdownKey)
      ? body.breakdownKey
      : undefined

  return {
    metric: body.metric,
    ...(breakdownKind ? { breakdownKind } : {}),
    ...(breakdownKey ? { breakdownKey } : {}),
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params
    enforceRateLimit({
      key: `public-metric:${clientIp(request)}:${slug}`,
      limit: METRIC_LIMIT,
      windowMs: METRIC_WINDOW_MS,
    })

    let body: unknown = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const db = await getDb()
    return jsonOk(await recordPublicFormMetric(db, slug, clampedMetricBody(body)))
  } catch (error) {
    return jsonError(error)
  }
}
