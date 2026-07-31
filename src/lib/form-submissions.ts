export type FormSubmissionExport = {
  formName: string
  columns: string[]
  rows: {
    submittedAt: number
    version: number
    responseLabel: string
    answers: string[]
  }[]
  truncated: boolean
}

function csvCell(value: string | number): string {
  const text = String(value)
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function safeFilePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "form"
}

export function createFormSubmissionsCsv(
  report: FormSubmissionExport,
): string {
  const header = [
    "Submitted at",
    "Created record",
    "Form version",
    ...report.columns,
  ]
  const rows = report.rows.map((row) => [
    new Date(row.submittedAt).toISOString(),
    row.responseLabel,
    row.version,
    ...report.columns.map((_, index) => row.answers[index] ?? ""),
  ])

  return [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
}

export function formSubmissionsCsvFileName(
  report: Pick<FormSubmissionExport, "formName">,
): string {
  return `${safeFilePart(report.formName)}-responses.csv`
}
