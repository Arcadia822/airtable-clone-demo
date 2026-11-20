"use client"

import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardCopy,
  Eye,
  FileText,
  ListChecks,
  Loader2,
  Lock,
  Plus,
  Rocket,
  Settings2,
  Trash2,
  Unlock,
  Users,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { ConditionalLogicEditor } from "@/components/forms/conditional-logic-editor"
import { PublicForm } from "@/components/forms/public-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type {
  FieldConfig,
  FieldDefinition,
  FieldType,
  FormDefinition,
  FormTheme,
  FormVisibilityRule,
} from "@/lib/domain"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import { cn } from "@/lib/utils"

export interface FormStudioProps {
  baseId: string
  formId: string
}

interface FormSettingsDto {
  allowMultipleSubmissions: boolean
  submitLabel: string
  showPoweredBy: boolean
}

interface FormThankYouDto {
  title: string
  message: string
  redirectUrl?: string
}

interface FormRecordDto {
  id: string
  orgId: string
  baseId: string
  tableId: string
  name: string
  description: string
  slug: string
  status: "draft" | "published" | "closed"
  settings: FormSettingsDto
  theme: FormTheme
  thankYou: FormThankYouDto
  analyticsTimeZone: string
  publishedVersionId: string | null
  createdAt: string
  updatedAt: string
}

interface TableFieldDto {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
  rank: string
  isPrimary: boolean
  eligible: boolean
}

interface DraftFieldDto {
  id: string
  formId: string
  targetFieldId: string
  label: string
  helpText: string
  placeholder: string
  required: boolean
  hidden: boolean
  rank: string
  mode: string
  visibilityRule: FormVisibilityRule | null
}

interface FormDetailDto {
  form: FormRecordDto
  base: { id: string; name: string } | null
  table: { id: string; name: string } | null
  draftFields: DraftFieldDto[]
  tableFields: TableFieldDto[]
  publishedVersion: {
    id: string
    versionNumber: number
    title: string
    description: string
    publishedAt: string
  } | null
  submissionCount: number
}

interface SubmissionColumn {
  fieldId: string
  label: string
  type: FieldType
  config: FieldConfig
}

interface SubmissionRow {
  id: string
  submittedAt: string
  recordId: string | null
  versionNumber: number | null
  displayValues: Record<string, string>
}

interface SubmissionsDto {
  form: { id: string; name: string; slug: string }
  columns: SubmissionColumn[]
  submissions: SubmissionRow[]
  total: number
}

type StudioTab = "questions" | "preview" | "responses"

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | null
  if (!response.ok) {
    throw new Error(payload?.message ?? "The request failed. Try again.")
  }
  return payload as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "That action failed. Try again."
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function toPreview(
  detail: FormDetailDto,
  draft: DraftFieldDto[],
): {
  form: FormDefinition
  fields: FieldDefinition[]
} {
  const fieldsByQuestion = new Map(
    draft.map((row) => [
      row.id,
      detail.tableFields.find((field) => field.id === row.targetFieldId),
    ]),
  )
  const questions = draft.map((row) => ({
    id: row.id,
    fieldId: row.id,
    label: row.label,
    helpText: row.helpText,
    ...(row.placeholder ? { placeholder: row.placeholder } : {}),
    required: row.required,
    rank: row.rank,
    mode: row.hidden ? ("hidden" as const) : ("visible" as const),
    ...(row.visibilityRule ? { visibility: row.visibilityRule } : {}),
  }))
  const fields: FieldDefinition[] = draft.map((row) => {
    const field = fieldsByQuestion.get(row.id)
    return {
      id: row.id,
      name: row.label,
      type: field?.type ?? "singleLineText",
      config: field?.config ?? {},
      rank: row.rank,
      width: 180,
      isPrimary: false,
    }
  })
  return {
    form: {
      id: detail.form.id,
      baseId: detail.form.baseId,
      tableId: detail.form.tableId,
      name: detail.form.name,
      title: detail.form.name,
      description: detail.form.description,
      submitLabel: detail.form.settings.submitLabel,
      thankYouTitle: detail.form.thankYou.title,
      thankYouMessage: detail.form.thankYou.message,
      publicSlug: detail.form.slug,
      status: "draft",
      version: detail.publishedVersion?.versionNumber ?? 0,
      theme: detail.form.theme,
      questions,
    },
    fields,
  }
}

const STATUS_LABELS: Record<FormRecordDto["status"], string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
}

export function FormStudio({ baseId, formId }: FormStudioProps) {
  const [detail, setDetail] = useState<FormDetailDto>()
  const [draft, setDraft] = useState<DraftFieldDto[]>([])
  const [pickedFieldIds, setPickedFieldIds] = useState<string[]>([])
  const [generateMode, setGenerateMode] = useState<"replace" | "append">(
    "replace",
  )
  const [tab, setTab] = useState<StudioTab>("questions")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const [submissions, setSubmissions] = useState<SubmissionsDto>()
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsName, setSettingsName] = useState("")
  const [settingsDescription, setSettingsDescription] = useState("")
  const [settingsAccent, setSettingsAccent] = useState("#2563eb")
  const [settingsThankYouTitle, setSettingsThankYouTitle] = useState("")
  const [settingsThankYouMessage, setSettingsThankYouMessage] = useState("")
  const pickedInitialized = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const next = await api<FormDetailDto>(`/api/forms/${formId}`)
      setDetail(next)
      setDraft(next.draftFields)
      setDirty(false)
      if (!pickedInitialized.current) {
        setPickedFieldIds(
          next.draftFields.map((field) => field.targetFieldId),
        )
        pickedInitialized.current = true
      }
      setSettingsName(next.form.name)
      setSettingsDescription(next.form.description)
      setSettingsAccent(next.form.theme.accent)
      setSettingsThankYouTitle(next.form.thankYou.title)
      setSettingsThankYouMessage(next.form.thankYou.message)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [formId])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [load])

  const eligibleFields = useMemo(
    () => (detail?.tableFields ?? []).filter((field) => field.eligible),
    [detail],
  )
  const fieldsByTarget = useMemo(
    () =>
      new Map(
        (detail?.tableFields ?? []).map((field) => [field.id, field]),
      ),
    [detail],
  )
  const preview = useMemo(
    () => (detail ? toPreview(detail, draft) : null),
    [detail, draft],
  )

  function markDirty() {
    setDirty(true)
    setNotice(undefined)
  }

  function updateDraftField(id: string, patch: Partial<DraftFieldDto>) {
    setDraft((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
    markDirty()
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
    markDirty()
  }

  function removeQuestion(index: number) {
    setDraft((current) => current.filter((_, position) => position !== index))
    markDirty()
  }

  function togglePickedField(fieldId: string) {
    setPickedFieldIds((current) =>
      current.includes(fieldId)
        ? current.filter((id) => id !== fieldId)
        : [...current, fieldId],
    )
  }

  async function saveDraft(options: { silent?: boolean } = {}): Promise<boolean> {
    setSaving(true)
    setError(undefined)
    try {
      const result = await api<{ fields: DraftFieldDto[] }>(
        `/api/forms/${formId}/draft`,
        {
          method: "PATCH",
          body: JSON.stringify({
            fields: draft.map((row) => ({
              id: row.id,
              targetFieldId: row.targetFieldId,
              label: row.label,
              helpText: row.helpText,
              placeholder: row.placeholder,
              required: row.required,
              hidden: row.hidden,
              mode: row.hidden ? "hidden" : "input",
              visibilityRule: row.visibilityRule,
            })),
          }),
        },
      )
      setDraft(result.fields)
      setDirty(false)
      setPickedFieldIds(result.fields.map((field) => field.targetFieldId))
      if (!options.silent) setNotice("Questions saved")
      return true
    } catch (saveError) {
      setError(errorMessage(saveError))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function generateFromFields() {
    setSaving(true)
    setError(undefined)
    try {
      const result = await api<{ fields: DraftFieldDto[] }>(
        `/api/forms/${formId}/draft/from-fields`,
        {
          method: "POST",
          body: JSON.stringify({
            fieldIds: pickedFieldIds,
            mode: generateMode,
          }),
        },
      )
      setDraft(result.fields)
      setPickedFieldIds(result.fields.map((field) => field.targetFieldId))
      setDirty(false)
      setNotice("Questions generated from the selected fields")
    } catch (generateError) {
      setError(errorMessage(generateError))
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setPublishing(true)
    setError(undefined)
    try {
      if (dirty) {
        const saved = await saveDraft({ silent: true })
        if (!saved) return
      }
      const result = await api<{
        form: FormRecordDto
        version: { versionNumber: number }
        publicUrl: string
      }>(`/api/forms/${formId}/publish`, { method: "POST" })
      setNotice(`Published version ${result.version.versionNumber}`)
      await load()
    } catch (publishError) {
      setError(errorMessage(publishError))
    } finally {
      setPublishing(false)
    }
  }

  async function changeStatus(status: "published" | "closed" | "draft") {
    setError(undefined)
    try {
      const next = await api<FormDetailDto>(`/api/forms/${formId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      setDetail(next)
      setNotice(
        status === "closed"
          ? "Form closed. Submissions are no longer accepted."
          : status === "published"
            ? "Form reopened"
            : "Form moved back to draft",
      )
    } catch (statusError) {
      setError(errorMessage(statusError))
    }
  }

  async function saveSettings() {
    setSaving(true)
    setError(undefined)
    try {
      const next = await api<FormDetailDto>(`/api/forms/${formId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: settingsName,
          description: settingsDescription,
          theme: { accent: settingsAccent },
          thankYou: {
            title: settingsThankYouTitle,
            message: settingsThankYouMessage,
          },
        }),
      })
      setDetail(next)
      setSettingsName(next.form.name)
      setSettingsDescription(next.form.description)
      setSettingsAccent(next.form.theme.accent)
      setSettingsThankYouTitle(next.form.thankYou.title)
      setSettingsThankYouMessage(next.form.thankYou.message)
      setNotice("Form settings saved")
    } catch (settingsError) {
      setError(errorMessage(settingsError))
    } finally {
      setSaving(false)
    }
  }

  const loadSubmissions = useCallback(async () => {
    setLoadingSubmissions(true)
    setError(undefined)
    try {
      setSubmissions(
        await api<SubmissionsDto>(`/api/forms/${formId}/submissions`),
      )
    } catch (submissionsError) {
      setError(errorMessage(submissionsError))
    } finally {
      setLoadingSubmissions(false)
    }
  }, [formId])

  async function copyPublicLink() {
    if (!detail) return
    const url = `${window.location.origin}/f/${detail.form.slug}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice("Public link copied")
    } catch {
      setNotice(url)
    }
  }

  useEffect(() => {
    if (tab !== "responses" || submissions) return
    const handle = window.setTimeout(() => {
      void loadSubmissions()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [loadSubmissions, submissions, tab])

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-muted/20 px-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading form…
        </div>
      </div>
    )
  }

  if (!detail || !preview) {
    return (
      <div className="grid min-h-dvh place-items-center bg-muted/20 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>This form could not be opened</CardTitle>
            <CardDescription>
              {error ?? "The form does not exist or was deleted."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const publicPath = `/f/${detail.form.slug}`

  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {detail.base?.name ?? baseId} / {detail.table?.name ?? "Table"} /
              Form
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {detail.form.name}
              </h1>
              <Badge
                variant={
                  detail.form.status === "published"
                    ? "default"
                    : detail.form.status === "closed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {STATUS_LABELS[detail.form.status]}
              </Badge>
              {detail.publishedVersion ? (
                <span className="text-xs text-muted-foreground">
                  Version {detail.publishedVersion.versionNumber}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyPublicLink()}
            >
              <ClipboardCopy className="size-4" />
              Copy link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={
                <a href={publicPath} target="_blank" rel="noreferrer" />
              }
            >
              <Eye className="size-4" />
              Open
            </Button>
            {detail.form.status === "published" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void changeStatus("closed")}
              >
                <Lock className="size-4" />
                Close form
              </Button>
            ) : null}
            {detail.form.status === "closed" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void changeStatus("published")}
              >
                <Unlock className="size-4" />
                Reopen form
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={publishing || !draft.length}
              onClick={() => void publish()}
            >
              {publishing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              {detail.form.status === "published" ? "Publish new version" : "Publish form"}
            </Button>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 pb-3 text-sm sm:px-6">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
            {publicPath}
          </code>
          {detail.form.status === "published" ? (
            <span className="text-xs text-muted-foreground">
              Anyone with the link can fill this in
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              The public link goes live after you publish
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {detail.submissionCount}{" "}
            {detail.submissionCount === 1 ? "response" : "responses"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="mb-4 rounded-lg border border-emerald-600/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800"
          >
            {notice}
          </p>
        ) : null}

        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(
            [
              ["questions", ListChecks, "Questions"],
              ["preview", Eye, "Live preview"],
              ["responses", Users, "Responses"],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              variant={tab === value ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(value)}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings2 className="size-4" />
              Form settings
            </Button>
            <Button
              size="sm"
              disabled={saving || !dirty}
              onClick={() => void saveDraft()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save changes
            </Button>
          </div>
        </div>

        {settingsOpen ? (
          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Form settings</CardTitle>
              <CardDescription>
                Title, description, accent colour, and thank-you copy ship with the next version.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="form-name">Form name</Label>
                <Input
                  id="form-name"
                  value={settingsName}
                  onChange={(event) => setSettingsName(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="form-accent">Accent colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="form-accent"
                    type="color"
                    value={
                      /^#[0-9a-fA-F]{6}$/.test(settingsAccent)
                        ? settingsAccent
                        : "#2563eb"
                    }
                    onChange={(event) => setSettingsAccent(event.target.value)}
                    className="h-8 w-12 rounded border"
                  />
                  <Input
                    value={settingsAccent}
                    onChange={(event) => setSettingsAccent(event.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="form-description">Description</Label>
                <Textarea
                  id="form-description"
                  value={settingsDescription}
                  rows={3}
                  onChange={(event) =>
                    setSettingsDescription(event.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="form-thank-you-title">Thank-you title</Label>
                <Input
                  id="form-thank-you-title"
                  value={settingsThankYouTitle}
                  onChange={(event) =>
                    setSettingsThankYouTitle(event.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="form-thank-you-message">Thank-you message</Label>
                <Input
                  id="form-thank-you-message"
                  value={settingsThankYouMessage}
                  onChange={(event) =>
                    setSettingsThankYouMessage(event.target.value)
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => void saveSettings()}
                >
                  Save settings
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "questions" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,290px)_minmax(0,1fr)]">
            <Card className="h-fit lg:sticky lg:top-4">
              <CardHeader>
                <CardTitle>Choose fields</CardTitle>
                <CardDescription>
                  Tick the table fields this form should collect, then generate questions in one click.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{eligibleFields.length} fillable fields</span>
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline"
                    onClick={() =>
                      setPickedFieldIds(
                        pickedFieldIds.length === eligibleFields.length
                          ? []
                          : eligibleFields.map((field) => field.id),
                      )
                    }
                  >
                    {pickedFieldIds.length === eligibleFields.length
                      ? "Clear all"
                      : "Select all"}
                  </button>
                </div>

                <div className="grid max-h-[320px] gap-1 overflow-y-auto pr-1">
                  {eligibleFields.map((field) => {
                    const checked = pickedFieldIds.includes(field.id)
                    return (
                      <label
                        key={field.id}
                        htmlFor={`pick-${field.id}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                          checked && "bg-muted/70",
                        )}
                      >
                        <Checkbox
                          id={`pick-${field.id}`}
                          checked={checked}
                          onCheckedChange={() => togglePickedField(field.id)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {field.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {getFieldTypeLabel(field.type)}
                            {field.isPrimary ? " · Primary field" : ""}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label htmlFor="generate-mode">Generate mode</Label>
                  <Select
                    value={generateMode}
                    onValueChange={(value) =>
                      setGenerateMode(value as "replace" | "append")
                    }
                  >
                    <SelectTrigger id="generate-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replace">Replace existing questions</SelectItem>
                      <SelectItem value="append">Append to existing questions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  disabled={saving || pickedFieldIds.length === 0}
                  onClick={() => void generateFromFields()}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Generate from selected fields
                </Button>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              {draft.length === 0 ? (
                <Card>
                  <CardContent className="grid place-items-center gap-2 py-12 text-center">
                    <FileText className="size-8 text-muted-foreground" />
                    <p className="font-medium">No questions yet</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Select fields on the left to generate questions, or append to the existing ones.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                draft.map((question, index) => {
                  const field = fieldsByTarget.get(question.targetFieldId)
                  return (
                    <Card key={question.id}>
                      <CardHeader className="gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Q{index + 1}</Badge>
                          <CardTitle className="text-base">
                            {question.label || field?.name || "Untitled question"}
                          </CardTitle>
                          <span className="text-xs text-muted-foreground">
                            {field
                              ? getFieldTypeLabel(field.type)
                              : "Field unavailable"}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move up"
                              disabled={index === 0}
                              onClick={() => moveQuestion(index, -1)}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Move down"
                              disabled={index === draft.length - 1}
                              onClick={() => moveQuestion(index, 1)}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Remove question"
                              onClick={() => removeQuestion(index)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                        <CardDescription>
                          Writes to column:
                          {field?.name ?? "Removed field"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="grid gap-2">
                            <Label htmlFor={`label-${question.id}`}>
                              Question label
                            </Label>
                            <Input
                              id={`label-${question.id}`}
                              value={question.label}
                              onChange={(event) =>
                                updateDraftField(question.id, {
                                  label: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor={`placeholder-${question.id}`}>
                              Placeholder
                            </Label>
                            <Input
                              id={`placeholder-${question.id}`}
                              value={question.placeholder}
                              onChange={(event) =>
                                updateDraftField(question.id, {
                                  placeholder: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="grid gap-2 sm:col-span-2">
                            <Label htmlFor={`help-${question.id}`}>
                              Help text
                            </Label>
                            <Input
                              id={`help-${question.id}`}
                              value={question.helpText}
                              onChange={(event) =>
                                updateDraftField(question.id, {
                                  helpText: event.target.value,
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-6">
                          <label className="flex items-center gap-2 text-sm">
                            <Switch
                              checked={question.required}
                              onCheckedChange={(checked) =>
                                updateDraftField(question.id, {
                                  required: checked,
                                })
                              }
                            />
                            Required
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <Switch
                              checked={question.hidden}
                              onCheckedChange={(checked) =>
                                updateDraftField(question.id, {
                                  hidden: checked,
                                })
                              }
                            />
                            Hide this question
                          </label>
                        </div>

                        <Separator />

                        <div className="grid gap-2">
                          <p className="text-sm font-medium">Show when</p>
                          <p className="text-xs text-muted-foreground">
                            Only show this field when the conditions below are met.
                          </p>
                          <ConditionalLogicEditor
                            disabled={saving}
                            fields={detail.tableFields.map((item) => ({
                              id: item.id,
                              name: item.name,
                              type: item.type,
                              config: item.config,
                            }))}
                            onChange={(visibility) =>
                              updateDraftField(question.id, {
                                visibilityRule: visibility ?? null,
                              })
                            }
                            question={{
                              id: question.id,
                              targetFieldId: question.targetFieldId,
                              label: question.label,
                              visibility: question.visibilityRule ?? undefined,
                            }}
                            questions={draft.map((item) => ({
                              id: item.id,
                              targetFieldId: item.targetFieldId,
                              label: item.label,
                              visibility: item.visibilityRule ?? undefined,
                            }))}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </div>
          </div>
        ) : null}

        {tab === "preview" ? (
          <div
            className="rounded-xl border bg-background p-4 sm:p-8"
            style={{ background: detail.form.theme.background }}
          >
            <PublicForm
              form={preview.form}
              fields={preview.fields}
              embedded
            />
            <p className="mx-auto mt-4 max-w-xl text-center text-xs text-muted-foreground">
              Preview submissions only show the thank-you copy. No record is written.
            </p>
          </div>
        ) : null}

        {tab === "responses" ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Responses</CardTitle>
                <Badge variant="secondary">{submissions?.total ?? 0}</Badge>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={
                      <a
                        href={`/api/forms/${formId}/submissions?format=csv`}
                        download
                      />
                    }
                  >
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadSubmissions()}
                    disabled={loadingSubmissions}
                  >
                    {loadingSubmissions ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Users className="size-4" />
                    )}
                    Refresh
                  </Button>
                </div>
              </div>
              <CardDescription>
                Every submission creates a real record in this table.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSubmissions && !submissions ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Loading responses…
                </p>
              ) : !submissions || submissions.submissions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No responses yet. Publish the form and share the link; responses appear here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Version</TableHead>
                        {submissions.columns.map((column) => (
                          <TableHead key={column.fieldId}>
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {submissions.submissions.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDateTime(row.submittedAt)}
                          </TableCell>
                          <TableCell>
                            {row.versionNumber ? `v${row.versionNumber}` : "—"}
                          </TableCell>
                          {submissions.columns.map((column) => (
                            <TableCell key={column.fieldId}>
                              {row.displayValues[column.fieldId] || (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  )
}
