export type ContrastForeground = "#000000" | "#ffffff"

interface RgbColor {
  red: number
  green: number
  blue: number
}

function parseHexColor(value: string): RgbColor | undefined {
  const normalized = value.trim()
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized)
  const hex = match?.[1]
  if (!hex) return undefined

  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : hex

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

function linearChannel(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * linearChannel(color.red) +
    0.7152 * linearChannel(color.green) +
    0.0722 * linearChannel(color.blue)
  )
}

export function hexContrastRatio(
  first: string,
  second: string,
): number | undefined {
  const firstColor = parseHexColor(first)
  const secondColor = parseHexColor(second)
  if (!firstColor || !secondColor) return undefined

  const firstLuminance = relativeLuminance(firstColor)
  const secondLuminance = relativeLuminance(secondColor)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function readableForegroundColor(
  background: string,
): ContrastForeground {
  const blackContrast = hexContrastRatio(background, "#000000")
  const whiteContrast = hexContrastRatio(background, "#ffffff")

  if (blackContrast === undefined || whiteContrast === undefined) {
    return "#ffffff"
  }
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff"
}
