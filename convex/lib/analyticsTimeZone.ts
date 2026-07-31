import { ConvexError } from "convex/values";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeAnalyticsTimeZone(value: string): string {
  const candidate = value.trim();
  if (!candidate || candidate.length > 100) {
    throw new ConvexError({ code: "INVALID_ANALYTICS_TIME_ZONE" });
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: candidate,
    }).resolvedOptions().timeZone;
  } catch {
    throw new ConvexError({ code: "INVALID_ANALYTICS_TIME_ZONE" });
  }
}

export function analyticsDayAt(
  timestamp: number,
  timeZone: string,
): string {
  const normalized = normalizeAnalyticsTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalized,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function shiftAnalyticsDay(day: string, amount: number): string {
  if (!DAY_PATTERN.test(day) || !Number.isInteger(amount)) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
  return new Date(timestamp + amount * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function offsetAt(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  );
  return representedAsUtc - timestamp;
}

export function startOfAnalyticsDay(day: string, timeZone: string): number {
  const normalized = normalizeAnalyticsTimeZone(timeZone);
  if (!DAY_PATTERN.test(day)) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
  const [year, month, date] = day.split("-").map(Number);
  const nominal = Date.UTC(year!, month! - 1, date!);
  let result = nominal - offsetAt(nominal, normalized);
  result = nominal - offsetAt(result, normalized);
  if (analyticsDayAt(result, normalized) !== day) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
  return result;
}
