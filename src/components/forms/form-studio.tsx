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
    throw new Error(payload?.message ?? "请求失败，请重试。")
  }
  return payload as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "操作失败，请重试。"
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
  draft: "草稿",
  published: "已发布",
  closed: "已关闭",
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
      if (!options.silent) setNotice("问题已保存")
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
      setNotice("已根据勾选字段生成问题")
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
      setNotice(`已发布第 ${result.version.versionNumber} 版`)
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
          ? "表单已关闭，不再接受提交"
          : status === "published"
            ? "表单已重新开放"
            : "表单已移回草稿",
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
      setNotice("表单设置已保存")
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
      setNotice("公开链接已复制")
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
          正在载入表单…
        </div>
      </div>
    )
  }

  if (!detail || !preview) {
    return (
      <div className="grid min-h-dvh place-items-center bg-muted/20 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>无法打开表单</CardTitle>
            <CardDescription>{error ?? "表单不存在或已被删除。"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void load()}>
              重试
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
              {detail.base?.name ?? baseId} / {detail.table?.name ?? "数据表"} /
              表单
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
                  第 {detail.publishedVersion.versionNumber} 版
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
              复制链接
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
              打开
            </Button>
            {detail.form.status === "published" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void changeStatus("closed")}
              >
                <Lock className="size-4" />
                关闭表单
              </Button>
            ) : null}
            {detail.form.status === "closed" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void changeStatus("published")}
              >
                <Unlock className="size-4" />
                重新开放
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
              {detail.form.status === "published" ? "发布新版本" : "发布表单"}
            </Button>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 pb-3 text-sm sm:px-6">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
            {publicPath}
          </code>
          {detail.form.status === "published" ? (
            <span className="text-xs text-muted-foreground">
              任何拿到链接的人都可以填写
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              发布后公开链接才会生效
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {detail.submissionCount} 份回复
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
              ["questions", ListChecks, "问题编辑"],
              ["preview", Eye, "实时预览"],
              ["responses", Users, "回复"],
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
              表单设置
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
              保存修改
            </Button>
          </div>
        </div>

        {settingsOpen ? (
          <Card className="mb-5">
            <CardHeader>
              <CardTitle>表单设置</CardTitle>
              <CardDescription>
                标题、说明、主色和提交成功文案都会随下一个版本一起发布。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="form-name">表单名称</Label>
                <Input
                  id="form-name"
                  value={settingsName}
                  onChange={(event) => setSettingsName(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="form-accent">主色</Label>
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
                <Label htmlFor="form-description">说明</Label>
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
                <Label htmlFor="form-thank-you-title">提交成功标题</Label>
                <Input
                  id="form-thank-you-title"
                  value={settingsThankYouTitle}
                  onChange={(event) =>
                    setSettingsThankYouTitle(event.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="form-thank-you-message">提交成功说明</Label>
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
                  保存设置
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "questions" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,290px)_minmax(0,1fr)]">
            <Card className="h-fit lg:sticky lg:top-4">
              <CardHeader>
                <CardTitle>选择字段</CardTitle>
                <CardDescription>
                  勾选要出现在表单里的数据表字段，然后一键生成问题。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{eligibleFields.length} 个可填写字段</span>
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
                      ? "取消全选"
                      : "全选"}
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
                            {field.isPrimary ? " · 主字段" : ""}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label htmlFor="generate-mode">生成方式</Label>
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
                      <SelectItem value="replace">替换现有问题</SelectItem>
                      <SelectItem value="append">追加到现有问题</SelectItem>
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
                  从勾选字段一键生成
                </Button>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              {draft.length === 0 ? (
                <Card>
                  <CardContent className="grid place-items-center gap-2 py-12 text-center">
                    <FileText className="size-8 text-muted-foreground" />
                    <p className="font-medium">还没有问题</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      在左侧勾选字段并生成问题，或从已有字段追加。
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
                            {question.label || field?.name || "未命名问题"}
                          </CardTitle>
                          <span className="text-xs text-muted-foreground">
                            {field
                              ? getFieldTypeLabel(field.type)
                              : "字段不可用"}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="上移"
                              disabled={index === 0}
                              onClick={() => moveQuestion(index, -1)}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="下移"
                              disabled={index === draft.length - 1}
                              onClick={() => moveQuestion(index, 1)}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="删除问题"
                              onClick={() => removeQuestion(index)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                        <CardDescription>
                          写入数据表列：
                          {field?.name ?? "已移除的字段"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="grid gap-2">
                            <Label htmlFor={`label-${question.id}`}>问题标题</Label>
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
                              占位提示
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
                              帮助文字
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
                            必填
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
                            隐藏问题
                          </label>
                        </div>

                        <Separator />

                        <div className="grid gap-2">
                          <p className="text-sm font-medium">显示条件</p>
                          <p className="text-xs text-muted-foreground">
                            满足条件时才向填写者显示这个字段。
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
              预览模式下提交只会显示成功文案，不会写入记录。
            </p>
          </div>
        ) : null}

        {tab === "responses" ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>回复</CardTitle>
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
                    导出 CSV
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
                    刷新
                  </Button>
                </div>
              </div>
              <CardDescription>
                每次提交都会在当前数据表里创建一条真实记录。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSubmissions && !submissions ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  正在载入回复…
                </p>
              ) : !submissions || submissions.submissions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  还没有收到回复。发布表单并分享链接后，回复会出现在这里。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>提交时间</TableHead>
                        <TableHead>版本</TableHead>
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
