export type AnalyticsDeviceCategory =
  | "desktop"
  | "tablet"
  | "mobile"
  | "unknown"

export type AnalyticsTrafficSource =
  | "direct"
  | "search"
  | "social"
  | "email"
  | "campaign"
  | "referral"
  | "unknown"

export type AnalyticsRange = {
  fromDay: string
  toDay: string
}

type AnalyticsCsvReport = {
  form: { name: string }
  fromDay: string
  toDay: string
  comparison: {
    metrics: Array<{
      label: string
      current: number
      previous: number
      change: number
      percentChange: number | null
    }>
  }
  series: Array<{
    date: string
    views: number
    starts: number
    submissions: number
    validationErrors: number
    abandonments: number
  }>
  breakdowns: {
    devices: {
      items: Array<{ label: string; count: number; share: number }>
    }
    trafficSources: {
      items: Array<{ label: string; count: number; share: number }>
    }
  }
  questionAbandonment: {
    items: Array<{ question: string; count: number; share: number }>
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000

const SEARCH_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.",
  "baidu.com",
  "ecosia.org",
]

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "tiktok.com",
  "t.co",
  "twitter.com",
  "x.com",
  "youtube.com",
]

const EMAIL_HOSTS = [
  "mail.google.",
  "outlook.live.com",
  "outlook.office.com",
  "mail.yahoo.",
  "proton.me",
]

export function resolvedAnalyticsTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

export function analyticsDay(
  date: Date,
  timeZone = resolvedAnalyticsTimeZone(),
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const parsed = Date.parse(`${day}T00:00:00.000Z`)
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === day
  )
}

export function analyticsRange(
  days: number,
  now = new Date(),
  timeZone = resolvedAnalyticsTimeZone(),
): AnalyticsRange {
  const boundedDays = Math.min(90, Math.max(1, Math.floor(days)))
  const to = Date.parse(`${analyticsDay(now, timeZone)}T00:00:00.000Z`)
  return {
    fromDay: analyticsDay(
      new Date(to - (boundedDays - 1) * DAY_MS),
    ),
    toDay: analyticsDay(new Date(to)),
  }
}

export function customAnalyticsRangeIssue(
  range: AnalyticsRange,
  today = analyticsDay(new Date()),
): string | null {
  if (!validDay(range.fromDay) || !validDay(range.toDay)) {
    return "Choose both a start date and an end date."
  }
  const from = Date.parse(`${range.fromDay}T00:00:00.000Z`)
  const to = Date.parse(`${range.toDay}T00:00:00.000Z`)
  if (to < from) return "The end date must be on or after the start date."
  if (Math.floor((to - from) / DAY_MS) + 1 > 90) {
    return "Choose a date range of 90 days or less."
  }
  if (range.toDay > today) {
    return "The end date cannot be in the future."
  }
  return null
}

export function analyticsDeviceCategory(
  viewportWidth: number | undefined,
): AnalyticsDeviceCategory {
  if (
    viewportWidth === undefined ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    return "unknown"
  }
  if (viewportWidth < 768) return "mobile"
  if (viewportWidth < 1_024) return "tablet"
  return "desktop"
}

function hostMatches(hostname: string, candidates: readonly string[]) {
  return candidates.some(
    (candidate) =>
      hostname === candidate ||
      hostname.endsWith(`.${candidate}`) ||
      hostname.includes(candidate),
  )
}

export function analyticsTrafficSource({
  currentUrl,
  referrer,
}: {
  currentUrl: string
  referrer: string
}): AnalyticsTrafficSource {
  let current: URL
  try {
    current = new URL(currentUrl)
  } catch {
    return "unknown"
  }
  const campaignParameters = [
    "utm_campaign",
    "utm_medium",
    "utm_source",
    "gclid",
    "fbclid",
    "msclkid",
  ]
  if (campaignParameters.some((name) => current.searchParams.has(name))) {
    return "campaign"
  }
  if (!referrer) return "direct"

  let referringUrl: URL
  try {
    referringUrl = new URL(referrer)
  } catch {
    return "unknown"
  }
  const hostname = referringUrl.hostname.toLowerCase().replace(/^www\./, "")
  const currentHostname = current.hostname.toLowerCase().replace(/^www\./, "")
  if (hostname === currentHostname) return "direct"
  if (hostMatches(hostname, SEARCH_HOSTS)) return "search"
  if (hostMatches(hostname, SOCIAL_HOSTS)) return "social"
  if (hostMatches(hostname, EMAIL_HOSTS)) return "email"
  return "referral"
}

function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(",")
}

function shareValue(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

export function createFormAnalyticsCsv(report: AnalyticsCsvReport): string {
  const rows = [
    csvRow([
      "Section",
      "Metric",
      "Date",
      "Current period",
      "Previous period",
      "Change",
      "Rate or share",
    ]),
  ]

  for (const metric of report.comparison.metrics) {
    rows.push(
      csvRow([
        "Overview",
        metric.label,
        "",
        metric.current,
        metric.previous,
        metric.change,
        metric.percentChange === null
          ? ""
          : shareValue(metric.percentChange),
      ]),
    )
  }
  for (const day of report.series) {
    for (const [label, value] of [
      ["Views", day.views],
      ["Starts", day.starts],
      ["Submissions", day.submissions],
      ["Validation errors", day.validationErrors],
      ["Tracked exits", day.abandonments],
    ] as const) {
      rows.push(csvRow(["Daily activity", label, day.date, value, "", "", ""]))
    }
  }
  for (const item of report.breakdowns.devices.items) {
    rows.push(
      csvRow(["Device category", item.label, "", item.count, "", "", shareValue(item.share)]),
    )
  }
  for (const item of report.breakdowns.trafficSources.items) {
    rows.push(
      csvRow(["Traffic source", item.label, "", item.count, "", "", shareValue(item.share)]),
    )
  }
  for (const item of report.questionAbandonment.items) {
    rows.push(
      csvRow(["Question exits", item.question, "", item.count, "", "", shareValue(item.share)]),
    )
  }
  return rows.join("\r\n")
}

export function formAnalyticsCsvFileName(report: {
  form: { name: string }
  fromDay: string
  toDay: string
}): string {
  const name = report.form.name
    .trim()
    .replaceAll(/[^a-zA-Z0-9._ -]+/g, "")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[.-]+|[.-]+$/g, "")
    .toLowerCase()
  return `${name || "form"}-analytics-${report.fromDay}-to-${report.toDay}.csv`
}
