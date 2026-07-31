export type AssistantAnalysisSectionKind =
  | "facts"
  | "interpretation"
  | "limitations"

export type AssistantAnalysisSection = {
  body: string
  kind: AssistantAnalysisSectionKind
  label: string
}

const SECTION_LABELS: Record<AssistantAnalysisSectionKind, string> = {
  facts: "Facts from workspace data",
  interpretation: "Interpretation",
  limitations: "Limitations",
}

const HEADING_PATTERN =
  /^(?:#{1,4}\s*)?(?:\*\*)?(facts(?:\s+from\s+workspace\s+data)?|interpretation|limitations)(?:\*\*)?\s*:?\s*$/i

export function parseAssistantAnalysis(
  value: string,
): AssistantAnalysisSection[] | undefined {
  const sections: AssistantAnalysisSection[] = []
  let currentKind: AssistantAnalysisSectionKind | undefined
  let currentLines: string[] = []

  const flush = () => {
    const body = currentLines.join("\n").trim()
    if (currentKind && body) {
      sections.push({
        body,
        kind: currentKind,
        label: SECTION_LABELS[currentKind],
      })
    }
    currentLines = []
  }

  for (const line of value.split(/\r?\n/)) {
    const match = line.trim().match(HEADING_PATTERN)
    if (match) {
      flush()
      currentKind = sectionKind(match[1] ?? "")
      continue
    }
    if (currentKind) currentLines.push(line)
  }
  flush()

  const kinds = new Set(sections.map((section) => section.kind))
  return kinds.has("facts") && kinds.has("interpretation")
    ? sections
    : undefined
}

function sectionKind(value: string): AssistantAnalysisSectionKind {
  const normalized = value.toLowerCase()
  if (normalized.startsWith("facts")) return "facts"
  if (normalized === "limitations") return "limitations"
  return "interpretation"
}
