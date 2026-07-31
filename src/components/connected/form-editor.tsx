"use client"

import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  FileInput,
  GripVertical,
  ImageIcon,
  Loader2,
  LockKeyhole,
  Monitor,
  Palette,
  Plus,
  Save,
  Settings2,
  Smartphone,
  Sparkles,
  Trash2,
} from "lucide-react"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ConnectedAssistantSheet } from "@/components/connected/assistant-sheet"
import { useLiveConnectionHealth } from "@/components/connected/connection-status"
import { FormBreadcrumbs } from "@/components/connected/form-breadcrumbs"
import {
  FormWriteStatus,
  formWriteRetryGuidance,
} from "@/components/connected/form-write-status"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import {
  ConnectedLoading,
  ConnectedTopBar,
} from "@/components/connected/org-states"
import { PublicForm } from "@/components/forms/public-form"
import { ConditionalLogicEditor } from "@/components/forms/conditional-logic-editor"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type {
  FieldConfig,
  FieldDefinition,
  FieldType,
  FormConditionOperator,
  FormConditionValue,
  FormDefinition,
  FormQuestion,
  FormVisibilityRule,
} from "@/lib/domain"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import {
  formPrefillParameterIssue,
  suggestedFormPrefillName,
} from "@/lib/form-prefill"
import {
  summarizeFormPublication,
  type FormPublishSnapshot,
  type FormPublishSummary,
} from "@/lib/form-publish-summary"
import { resolvedAnalyticsTimeZone } from "@/lib/form-analytics"
import { defaultFormConditionForField } from "@/lib/form-conditional-logic"
import { cn } from "@/lib/utils"

type FormStatus = "draft" | "published" | "closed"

const FORM_COLOR_PRESETS = [
  { label: "Violet", value: "#6d5dfc" },
  { label: "Blue", value: "#2563eb" },
  { label: "Teal", value: "#0f766e" },
  { label: "Orange", value: "#c2410c" },
  { label: "Pink", value: "#be185d" },
  { label: "Charcoal", value: "#111827" },
  { label: "White", value: "#ffffff" },
] as const
const MAX_FORM_APPEARANCE_IMAGE_BYTES = 8 * 1024 * 1024
const FORM_APPEARANCE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

interface FormDoc {
  _id: Id<"forms">
  baseId: Id<"bases">
  tableId: Id<"tables">
  name: string
  slug: string
  title: string
  description: string
  status: FormStatus
  appearance: {
    primaryColor: string
    backgroundColor: string
    submitLabel: string
    showPoweredBy: boolean
    layout: "card" | "plain"
    logoUrl: string | null
    coverUrl: string | null
    logoFingerprint: string | null
    coverFingerprint: string | null
  }
  thankYou: {
    title: string
    message: string
    redirectUrl?: string
  }
  draftRevision: number
  currentPublishedVersionId?: Id<"formVersions">
}

interface DraftFieldDoc {
  _id: Id<"formDraftFields">
  targetFieldId: Id<"fields">
  label: string
  description?: string
  placeholder?: string
  required: boolean
  rank: string
  mode?: "visible" | "hidden"
  fixedValue?: FormConditionValue
  prefillParameter?: string
  visibility?: {
    conjunction: "and" | "or"
    conditions: {
      id: string
      sourceFieldId: Id<"fields">
      operator: FormConditionOperator
      value?: FormConditionValue
    }[]
  }
}

interface FieldDoc {
  _id: Id<"fields">
  name: string
  type: FieldType
  config: FieldConfig
  rank: string
  width: number
  isPrimary: boolean
  status: "active" | "deleted"
}

interface DraftPayload {
  form: FormDoc
  fields: DraftFieldDoc[]
  liveVersion: LiveVersionDoc | null
}

interface LiveVersionDoc {
  version: number
  publishedAt: number
  title: string
  description: string
  appearance: FormDoc["appearance"]
  thankYou: FormDoc["thankYou"]
  fields: Array<{
    targetFieldId: Id<"fields">
    label: string
    description?: string
    placeholder?: string
    required: boolean
    mode: "visible" | "hidden"
    fixedValue?: FormConditionValue
    prefillParameter?: string
    visibility?: {
      conjunction: "and" | "or"
      conditions: Array<{
        id: string
        sourceQuestionId: Id<"formVersionFields">
        sourceFieldId: Id<"fields">
        operator: FormConditionOperator
        value?: FormConditionValue
      }>
    }
  }>
}

interface EditorQuestion {
  id: string
  targetFieldId: Id<"fields">
  label: string
  description: string
  placeholder: string
  required: boolean
  mode: "visible" | "hidden"
  fixedValue?: FormConditionValue
  prefillParameter: string
  visibility?: FormVisibilityRule
}

interface EditorState {
  name: string
  title: string
  description: string
  primaryColor: string
  backgroundColor: string
  submitLabel: string
  showPoweredBy: boolean
  layout: "card" | "plain"
  logoUrl?: string
  coverUrl?: string
  logoFingerprint?: string
  coverFingerprint?: string
  thankYouTitle: string
  thankYouMessage: string
  redirectUrl: string
  status: FormStatus
  questions: EditorQuestion[]
}

function editorStateFromDraft(
  draft: DraftPayload,
  canBrand: boolean,
): EditorState {
  const questionIdByTargetFieldId = new Map(
    draft.fields.map((field) => [field.targetFieldId, field._id]),
  )
  return {
    name: draft.form.name,
    title: draft.form.title,
    description: draft.form.description,
    primaryColor: canBrand
      ? draft.form.appearance.primaryColor
      : "#2563eb",
    backgroundColor: canBrand
      ? draft.form.appearance.backgroundColor
      : "#ffffff",
    submitLabel: canBrand
      ? draft.form.appearance.submitLabel
      : "Submit",
    showPoweredBy: canBrand
      ? draft.form.appearance.showPoweredBy
      : true,
    layout: canBrand
      ? draft.form.appearance.layout ?? "card"
      : "card",
    logoUrl: canBrand
      ? draft.form.appearance.logoUrl ?? undefined
      : undefined,
    coverUrl: canBrand
      ? draft.form.appearance.coverUrl ?? undefined
      : undefined,
    logoFingerprint: canBrand
      ? draft.form.appearance.logoFingerprint ?? undefined
      : undefined,
    coverFingerprint: canBrand
      ? draft.form.appearance.coverFingerprint ?? undefined
      : undefined,
    thankYouTitle: draft.form.thankYou.title,
    thankYouMessage: draft.form.thankYou.message,
    redirectUrl: canBrand
      ? draft.form.thankYou.redirectUrl ?? ""
      : "",
    status: draft.form.status,
    questions: draft.fields.map((field) => ({
      id: field._id,
      targetFieldId: field.targetFieldId,
      label: field.label,
      description: field.description ?? "",
      placeholder: field.placeholder ?? "",
      required: field.required,
      mode: field.mode ?? "visible",
      fixedValue: field.fixedValue,
      prefillParameter: field.prefillParameter ?? "",
      visibility: field.visibility?.conditions.length
        ? {
            conjunction: field.visibility.conjunction,
            conditions: field.visibility.conditions.map((condition) => ({
              ...condition,
              sourceQuestionId:
                questionIdByTargetFieldId.get(condition.sourceFieldId) ??
                "",
            })),
          }
        : undefined,
    })),
  }
}

function editorPublishSnapshot(editor: EditorState): FormPublishSnapshot {
  return {
    title: editor.title.trim(),
    description: editor.description.trim(),
    appearance: {
      primaryColor: editor.primaryColor,
      backgroundColor: editor.backgroundColor,
      submitLabel: editor.submitLabel.trim(),
      showPoweredBy: editor.showPoweredBy,
      layout: editor.layout,
      logoFingerprint: editor.logoFingerprint,
      coverFingerprint: editor.coverFingerprint,
    },
    thankYou: {
      title: editor.thankYouTitle.trim(),
      message: editor.thankYouMessage.trim(),
      ...(editor.redirectUrl.trim()
        ? { redirectUrl: editor.redirectUrl.trim() }
        : {}),
    },
    questions: editor.questions.map((question) => ({
      identity: question.targetFieldId,
      label: question.label.trim(),
      description: question.description.trim() || undefined,
      placeholder:
        question.mode === "visible"
          ? question.placeholder.trim() || undefined
          : undefined,
      required: question.mode === "hidden" ? true : question.required,
      mode: question.mode,
      fixedValue:
        question.mode === "hidden" ? question.fixedValue : undefined,
      prefillName:
        question.mode === "visible"
          ? question.prefillParameter || undefined
          : undefined,
      visibility:
        question.mode === "visible"
          ? comparableVisibility(question.visibility)
          : undefined,
    })),
  }
}

function livePublishSnapshot(
  liveVersion: LiveVersionDoc | null,
): FormPublishSnapshot | null {
  if (!liveVersion) return null
  return {
    title: liveVersion.title,
    description: liveVersion.description,
    appearance: {
      primaryColor: liveVersion.appearance.primaryColor,
      backgroundColor: liveVersion.appearance.backgroundColor,
      submitLabel: liveVersion.appearance.submitLabel,
      showPoweredBy: liveVersion.appearance.showPoweredBy,
      layout: liveVersion.appearance.layout,
      logoFingerprint: liveVersion.appearance.logoFingerprint ?? undefined,
      coverFingerprint: liveVersion.appearance.coverFingerprint ?? undefined,
    },
    thankYou: {
      title: liveVersion.thankYou.title,
      message: liveVersion.thankYou.message,
      ...(liveVersion.thankYou.redirectUrl
        ? { redirectUrl: liveVersion.thankYou.redirectUrl }
        : {}),
    },
    questions: liveVersion.fields.map((question) => ({
      identity: question.targetFieldId,
      label: question.label,
      description: question.description,
      placeholder:
        question.mode === "visible" ? question.placeholder : undefined,
      required: question.mode === "hidden" ? true : question.required,
      mode: question.mode,
      fixedValue:
        question.mode === "hidden" ? question.fixedValue : undefined,
      prefillName:
        question.mode === "visible"
          ? question.prefillParameter
          : undefined,
      visibility:
        question.mode === "visible"
          ? comparableVisibility(question.visibility)
          : undefined,
    })),
  }
}

function comparableVisibility(
  visibility:
    | {
        conjunction: "and" | "or"
        conditions: ReadonlyArray<{
          id: string
          sourceQuestionId: string
          sourceFieldId?: string
          operator: FormConditionOperator
          value?: FormConditionValue
        }>
      }
    | undefined,
): FormVisibilityRule | undefined {
  if (!visibility?.conditions.length) return undefined
  return {
    conjunction: visibility.conjunction,
    conditions: visibility.conditions.map((condition) => {
      const sourceIdentity =
        condition.sourceFieldId ?? condition.sourceQuestionId
      return {
        id: condition.id,
        sourceQuestionId: sourceIdentity,
        sourceFieldId: sourceIdentity,
        operator: condition.operator,
        value: condition.value,
      }
    }),
  }
}

function moveItem<T>(items: T[], index: number, nextIndex: number): T[] {
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

function rankFor(index: number) {
  return index.toString().padStart(6, "0")
}

function defaultFixedValueForField(
  field: FieldDoc,
): FormConditionValue {
  if (field.type === "checkbox") return false
  if (field.type === "number" || field.type === "currency") return 0
  if (field.type === "percent") return 0
  if (field.type === "rating") return 1
  if (field.type === "multiSelect") return []
  if (field.type === "singleSelect") {
    return field.config.options?.[0]?.id ?? ""
  }
  return ""
}

function availableFormPrefillName(
  questions: readonly EditorQuestion[],
  questionId: string,
  questionLabel: string,
  columnName: string,
) {
  const base = suggestedFormPrefillName(questionLabel, columnName)
  const otherNames = questions
    .filter(
      (question) =>
        question.id !== questionId && Boolean(question.prefillParameter),
    )
    .map((question) => question.prefillParameter)

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const suffix = attempt === 1 ? "" : `_${attempt}`
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`
    if (!formPrefillParameterIssue(candidate, otherNames)) return candidate
  }

  return "answer"
}

function shareLinkAnswer(
  field: FieldDoc,
  rawValue: string,
): { issue?: string; value?: string } {
  const value = rawValue.trim()
  if (!value) return { issue: "Enter a starting answer." }
  if (field.type === "attachment") {
    return { issue: "File uploads cannot be filled in by a share link." }
  }

  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const requested =
      field.type === "multiSelect"
        ? value.split(",").map((item) => item.trim()).filter(Boolean)
        : [value]
    const options = requested.map((item) =>
      field.config.options?.find(
        (option) =>
          option.label.toLocaleLowerCase() === item.toLocaleLowerCase(),
      ),
    )
    if (options.some((option) => !option)) {
      return {
        issue:
          field.type === "multiSelect"
            ? "Enter choice names separated by commas."
            : "Enter one of the available choice names.",
      }
    }
    return {
      value: options
        .map((option) => option?.label)
        .filter((label): label is string => Boolean(label))
        .join(","),
    }
  }

  if (field.type === "checkbox") {
    const normalized = value.toLocaleLowerCase()
    if (["yes", "true", "1"].includes(normalized)) return { value: "yes" }
    if (["no", "false", "0"].includes(normalized)) return { value: "no" }
    return { issue: "Enter Yes or No." }
  }

  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const numericValue = Number(value)
    const storedValue =
      field.type === "percent" ? numericValue / 100 : numericValue
    if (!Number.isFinite(storedValue)) {
      return { issue: "Enter a valid number." }
    }
    if (
      field.type === "rating" &&
      (!Number.isInteger(storedValue) ||
        storedValue < 1 ||
        storedValue > 5)
    ) {
      return { issue: "Enter a whole-number rating from 1 to 5." }
    }
    if (
      field.config.min !== undefined &&
      storedValue < field.config.min
    ) {
      const minimum =
        field.type === "percent"
          ? field.config.min * 100
          : field.config.min
      return { issue: `Enter ${minimum} or more.` }
    }
    if (
      field.config.max !== undefined &&
      storedValue > field.config.max
    ) {
      const maximum =
        field.type === "percent"
          ? field.config.max * 100
          : field.config.max
      return { issue: `Enter ${maximum} or less.` }
    }
    return { value }
  }

  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { issue: "Enter a complete email address." }
  }
  if (field.type === "url") {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { issue: "Enter a web address beginning with http or https." }
      }
    } catch {
      return { issue: "Enter a complete web address." }
    }
  }
  if (
    field.type === "date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)))
  ) {
    return { issue: "Enter a date in YYYY-MM-DD format." }
  }

  const maxLength = Math.min(
    field.config.maxLength ??
      (field.type === "longText" ? 100_000 : 10_000),
    field.type === "longText" ? 100_000 : 10_000,
  )
  if (value.length > maxLength) {
    return {
      issue: `Keep the starting answer to ${maxLength.toLocaleString()} characters or fewer.`,
    }
  }
  return { value }
}

function shareLinkAnswerHint(field: FieldDoc | undefined) {
  if (!field) return "Choose where this answer is saved first."
  if (field.type === "singleSelect") {
    return "Enter a choice exactly as it appears in the form."
  }
  if (field.type === "multiSelect") {
    return "Enter choice names separated by commas."
  }
  if (field.type === "checkbox") return "Enter Yes or No."
  if (field.type === "percent") return "Enter a percentage from 0 to 100."
  if (field.type === "rating") return "Enter a rating from 1 to 5."
  if (field.type === "date") return "Enter a date in YYYY-MM-DD format."
  return "This answer will already be filled in when someone opens the link."
}

function fixedValueIssue(
  field: FieldDoc | undefined,
  value: FormConditionValue | undefined,
): string | null {
  if (!field) return "Choose a destination column."
  if (field.type === "attachment") {
    return "File columns need a visible upload question."
  }
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return `Enter the value to save in “${field.name}”.`
  }
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `Enter a valid number for “${field.name}”.`
    }
    if (
      field.type === "rating" &&
      (!Number.isInteger(value) || value < 1 || value > 5)
    ) {
      return "Choose a whole-number rating from 1 to 5."
    }
    if (field.config.min !== undefined && value < field.config.min) {
      return `Use ${field.config.min} or more for “${field.name}”.`
    }
    if (field.config.max !== undefined && value > field.config.max) {
      return `Use ${field.config.max} or less for “${field.name}”.`
    }
    return null
  }
  if (field.type === "checkbox") {
    return typeof value === "boolean"
      ? null
      : `Choose yes or no for “${field.name}”.`
  }
  if (field.type === "singleSelect") {
    return typeof value === "string" &&
      field.config.options?.some(
        (option) => option.id === value,
      )
      ? null
      : `Choose an available option for “${field.name}”.`
  }
  if (field.type === "multiSelect") {
    return Array.isArray(value) &&
      value.every(
        (selected) =>
          typeof selected === "string" &&
          field.config.options?.some(
            (option) => option.id === selected,
          ),
      )
      ? null
      : `Choose available options for “${field.name}”.`
  }
  if (typeof value !== "string") {
    return `Enter a valid value for “${field.name}”.`
  }
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a complete email address."
  }
  if (field.type === "url") {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return "Enter a web address beginning with http or https."
      }
    } catch {
      return "Enter a complete web address."
    }
  }
  if (field.type === "date" && Number.isNaN(Date.parse(value))) {
    return "Choose a valid date."
  }
  return null
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (/UNAUTHENTICATED|EVE_SESSION_FORBIDDEN/i.test(message)) {
    return "Your session has expired. Refresh the page and sign in again."
  }
  if (/ORG_ADMIN_REQUIRED|FORBIDDEN/i.test(message)) {
    return "Ask an organization admin to make this change."
  }
  if (/LIMIT|QUOTA/i.test(message)) {
    return "Your organization has reached its current plan limit."
  }
  if (/REVISION|UPDATED_OR_CLOSED|CONFLICT/i.test(message)) {
    return "This form changed elsewhere. Load the latest changes and try again."
  }
  if (/PREFILL_PARAMETER/i.test(message)) {
    return "Turn link autofill off and back on for the affected question, then save again."
  }
  if (/HIDDEN_FORM_VALUE|VISIBLE_FORM_VALUE|INVALID_CELL_VALUE/i.test(message)) {
    return "Check the automatic values and try again."
  }
  return "Please try again. If this continues, refresh the page."
}

export function ConnectedFormEditor({
  baseId,
  formId,
}: {
  baseId: string
  formId: string
}) {
  return (
    <OrganizationAuthGate>
      {({ auth }) => (
        <FormEditorData
          baseId={baseId as Id<"bases">}
          formId={formId as Id<"forms">}
          canManage={
            auth.orgRole?.replace(/^org:/, "") === "admin"
          }
          canBrand={auth.has({
            feature: "custom_form_branding",
          })}
          canUseAi={auth.has({ feature: "ai_assistant" })}
        />
      )}
    </OrganizationAuthGate>
  )
}

function FormEditorData({
  baseId,
  formId,
  canManage,
  canBrand,
  canUseAi,
}: {
  baseId: Id<"bases">
  formId: Id<"forms">
  canManage: boolean
  canBrand: boolean
  canUseAi: boolean
}) {
  const draft = useQuery(api.forms.getDraft, { formId }) as
    | DraftPayload
    | undefined
  const fields = useQuery(
    api.fields.list,
    draft ? { tableId: draft.form.tableId } : "skip",
  ) as FieldDoc[] | undefined

  if (draft === undefined || fields === undefined) {
    return <ConnectedLoading label="Loading form editor…" />
  }

  if (draft.form.baseId !== baseId) {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/20 px-5">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Form not found in this base</CardTitle>
            <CardDescription>
              The requested form does not belong to this base.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={`/bases/${baseId}/forms`} />}>
              <ArrowLeft />
              Back to forms
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <FormEditorWorkspace
      key={draft.form._id}
      baseId={baseId}
      canBrand={canBrand}
      canManage={canManage}
      canUseAi={canUseAi}
      draft={draft}
      fields={fields}
    />
  )
}

function FormEditorWorkspace({
  baseId,
  canBrand,
  canManage,
  canUseAi,
  draft,
  fields,
}: {
  baseId: Id<"bases">
  canBrand: boolean
  canManage: boolean
  canUseAi: boolean
  draft: DraftPayload
  fields: FieldDoc[]
}) {
  const fieldMappingId = useId()
  const saveDraftMutation = useMutation(api.forms.saveDraft)
  const publishForm = useMutation(api.forms.publish)
  const closeForm = useMutation(api.forms.close)
  const createAppearanceUploadUrl = useMutation(
    api.forms.createAppearanceUploadUrl,
  )
  const setAppearanceAsset = useMutation(api.forms.setAppearanceAsset)
  const [editor, setEditor] = useState(() =>
    editorStateFromDraft(draft, canBrand),
  )
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    editor.questions[0]?.id,
  )
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [appearanceAssetBusy, setAppearanceAssetBusy] = useState<
    "logo" | "cover"
  >()
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [reloadDialogOpen, setReloadDialogOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [shareLinkAnswers, setShareLinkAnswers] = useState<
    Record<string, string>
  >({})
  const [draggedQuestionId, setDraggedQuestionId] = useState<string>()
  const [dropQuestionId, setDropQuestionId] = useState<string>()
  const [localPublished, setLocalPublished] = useState<{
    version: number
    snapshot: FormPublishSnapshot
  }>()
  const [expectedRevision, setExpectedRevision] = useState(
    draft.form.draftRevision,
  )
  const pendingWriteCount =
    Number(saving) +
    Number(publishing) +
    Number(closing) +
    Number(Boolean(appearanceAssetBusy))
  const connectionHealth = useLiveConnectionHealth(pendingWriteCount)
  const connectionHealthRef = useRef(connectionHealth)

  useEffect(() => {
    connectionHealthRef.current = connectionHealth
  }, [connectionHealth])

  useEffect(() => {
    if (!dirty) return

    function preventUnsavedExit(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", preventUnsavedExit)
    return () => window.removeEventListener("beforeunload", preventUnsavedExit)
  }, [dirty])

  const activeFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.status === "active" &&
          field.type !== "createdTime" &&
          field.type !== "createdBy",
      ),
    [fields],
  )
  const selectedQuestion = editor.questions.find(
    (question) => question.id === selectedQuestionId,
  )
  const fieldById = useMemo(
    () => new Map(activeFields.map((field) => [field._id, field])),
    [activeFields],
  )
  const hasRemoteChanges = draft.form.draftRevision > expectedRevision
  const draftPublishSnapshot = useMemo(
    () => editorPublishSnapshot(editor),
    [editor],
  )
  const serverLiveSnapshot = useMemo(
    () => livePublishSnapshot(draft.liveVersion),
    [draft.liveVersion],
  )
  const serverLiveVersion = draft.liveVersion?.version ?? 0
  const effectiveLiveSnapshot =
    localPublished && localPublished.version > serverLiveVersion
      ? localPublished.snapshot
      : serverLiveSnapshot
  const effectiveLiveVersion =
    localPublished && localPublished.version > serverLiveVersion
      ? localPublished.version
      : draft.liveVersion?.version
  const publishSummary = useMemo(
    () =>
      summarizeFormPublication(
        draftPublishSnapshot,
        effectiveLiveSnapshot,
        editor.status === "closed" && effectiveLiveSnapshot !== null,
      ),
    [draftPublishSnapshot, editor.status, effectiveLiveSnapshot],
  )

  function updateEditor(patch: Partial<EditorState>) {
    setEditor((current) => ({ ...current, ...patch }))
    setDirty(true)
  }

  function canStartFormWrite(action: string) {
    const latestHealth = connectionHealthRef.current
    if (latestHealth.canStartWrite) return true
    toast.error(`${action} is paused`, {
      description: formWriteRetryGuidance(latestHealth, dirty),
    })
    return false
  }

  async function changeAppearanceAsset(
    kind: "logo" | "cover",
    file?: File,
  ) {
    if (!canManage || !canBrand || appearanceAssetBusy) return
    if (!canStartFormWrite(file ? "Uploading the image" : "Removing the image")) {
      return
    }
    if (file && !FORM_APPEARANCE_IMAGE_TYPES.has(file.type)) {
      toast.error("Choose a PNG, JPG, WebP, or GIF image")
      return
    }
    if (file && file.size > MAX_FORM_APPEARANCE_IMAGE_BYTES) {
      toast.error("Choose an image smaller than 8 MB")
      return
    }

    setAppearanceAssetBusy(kind)
    try {
      let storageId: Id<"_storage"> | null = null
      if (file) {
        const uploadUrl = await createAppearanceUploadUrl({
          formId: draft.form._id,
        })
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "content-type": file.type || "application/octet-stream",
          },
          body: file,
        })
        if (!response.ok) {
          throw new Error("UPLOAD_FAILED")
        }
        const upload = (await response.json()) as {
          storageId?: string
        }
        if (!upload.storageId) {
          throw new Error("UPLOAD_FAILED")
        }
        storageId = upload.storageId as Id<"_storage">
      }
      const result = await setAppearanceAsset({
        formId: draft.form._id,
        expectedRevision,
        kind,
        storageId,
      })
      setExpectedRevision(result.draftRevision)
      setEditor((current) => ({
        ...current,
        ...(kind === "logo"
          ? {
              logoUrl: result.url ?? undefined,
              logoFingerprint: result.fingerprint ?? undefined,
            }
          : {
              coverUrl: result.url ?? undefined,
              coverFingerprint: result.fingerprint ?? undefined,
            }),
      }))
      toast.success(
        file
          ? `${kind === "logo" ? "Logo" : "Cover image"} added`
          : `${kind === "logo" ? "Logo" : "Cover image"} removed`,
        {
          description:
            "Publish when you are ready to make this design live.",
        },
      )
    } catch (error) {
      toast.error(
        `Could not ${file ? "upload" : "remove"} the ${kind === "logo" ? "logo" : "cover image"}`,
        { description: errorMessage(error) },
      )
    } finally {
      setAppearanceAssetBusy(undefined)
    }
  }

  function updateQuestion(
    questionId: string,
    patch: Partial<EditorQuestion>,
  ) {
    setEditor((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    }))
    setDirty(true)
  }

  function addQuestion() {
    const mappedIds = new Set(
      editor.questions.map((question) => question.targetFieldId),
    )
    const field = activeFields.find((candidate) => !mappedIds.has(candidate._id))
    if (!field) {
      toast.info("Every available column is already used")
      return
    }
    const question: EditorQuestion = {
      id: `new:${crypto.randomUUID()}`,
      targetFieldId: field._id,
      label: field.name,
      description: "",
      placeholder: "",
      required: false,
      mode: "visible",
      prefillParameter: "",
    }
    updateEditor({ questions: [...editor.questions, question] })
    setSelectedQuestionId(question.id)
  }

  function removeQuestion(questionId: string) {
    if (editor.questions.length === 1) {
      toast.error("A form needs at least one question")
      return
    }
    const index = editor.questions.findIndex(
      (question) => question.id === questionId,
    )
    const nextQuestions = editor.questions.filter(
      (question) => question.id !== questionId,
    ).map((question) => {
      const nextConditions = question.visibility?.conditions.filter(
        (condition) => condition.sourceQuestionId !== questionId,
      )
      return {
        ...question,
        visibility: nextConditions?.length
          ? {
              conjunction: question.visibility?.conjunction ?? "and",
              conditions: nextConditions,
            }
          : undefined,
      }
    })
    updateEditor({ questions: nextQuestions })
    setSelectedQuestionId(
      nextQuestions[Math.min(index, nextQuestions.length - 1)]?.id,
    )
  }

  function moveQuestion(index: number, nextIndex: number) {
    updateEditor({
      questions: moveItem(editor.questions, index, nextIndex),
    })
  }

  function dropQuestion(
    event: DragEvent<HTMLDivElement>,
    targetQuestionId: string,
  ) {
    event.preventDefault()
    const sourceQuestionId =
      draggedQuestionId || event.dataTransfer.getData("text/plain")
    const sourceIndex = editor.questions.findIndex(
      (question) => question.id === sourceQuestionId,
    )
    const targetIndex = editor.questions.findIndex(
      (question) => question.id === targetQuestionId,
    )
    setDraggedQuestionId(undefined)
    setDropQuestionId(undefined)
    if (
      !canManage ||
      sourceIndex < 0 ||
      targetIndex < 0 ||
      sourceIndex === targetIndex
    ) {
      return
    }
    moveQuestion(sourceIndex, targetIndex)
  }

  function validateDraft() {
    if (!editor.name.trim()) return "Enter a form name."
    if (!editor.title.trim()) return "Enter the heading visitors will see."
    if (!editor.thankYouTitle.trim()) return "Enter a thank-you title."
    if (!editor.questions.length) return "Add at least one question."
    if (editor.questions.some((question) => !question.label.trim())) {
      return "Every question needs a label."
    }
    const questionIndexById = new Map(
      editor.questions.map((question, index) => [question.id, index]),
    )
    for (const [questionIndex, question] of editor.questions.entries()) {
      const field = fieldById.get(question.targetFieldId)
      if (question.mode === "hidden") {
        const issue = fixedValueIssue(field, question.fixedValue)
        if (issue) return issue
        if (question.visibility?.conditions.length) {
          return `Remove display rules from the hidden value “${question.label}”.`
        }
      } else if (question.prefillParameter) {
        const issue = formPrefillParameterIssue(
          question.prefillParameter,
          editor.questions
            .filter(
              (candidate) =>
                candidate.id !== question.id &&
                candidate.mode !== "hidden" &&
                Boolean(candidate.prefillParameter),
            )
            .map((candidate) => candidate.prefillParameter),
        )
        if (issue) {
          return `Turn link autofill off and back on for “${question.label}”, then save again.`
        }
      }
      for (const condition of question.visibility?.conditions ?? []) {
        const sourceIndex = questionIndexById.get(
          condition.sourceQuestionId,
        )
        if (sourceIndex === undefined || sourceIndex >= questionIndex) {
          return `Display logic for “${question.label || "Untitled question"}” must use an earlier question.`
        }
      }
    }
    if (
      canBrand &&
      (!/^#[0-9a-f]{6}$/i.test(editor.primaryColor) ||
        !/^#[0-9a-f]{6}$/i.test(editor.backgroundColor))
    ) {
      return "Choose an accent and page background color."
    }
    if (canBrand && !editor.submitLabel.trim()) {
      return "Enter text for the submit button."
    }
    if (editor.redirectUrl) {
      try {
        const parsed = new URL(editor.redirectUrl)
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return "The redirect must use http or https."
        }
      } catch {
        return "Enter a valid redirect URL or leave it blank."
      }
    }
    return null
  }

  async function save({ silent = false }: { silent?: boolean } = {}) {
    if (!canManage) return false
    if (!canStartFormWrite("Saving the form")) return false
    const validationError = validateDraft()
    if (validationError) {
      toast.error("Check the form before saving", {
        description: validationError,
      })
      return false
    }

    setSaving(true)
    try {
      if (hasRemoteChanges) {
        toast.error("Someone else updated this form", {
          description: "Load their changes before saving yours.",
        })
        return false
      }
      const result = await saveDraftMutation({
        formId: draft.form._id,
        expectedRevision,
        name: editor.name,
        title: editor.title,
        description: editor.description,
        appearance: canBrand
          ? {
              primaryColor: editor.primaryColor,
              backgroundColor: editor.backgroundColor,
              submitLabel: editor.submitLabel,
              showPoweredBy: editor.showPoweredBy,
              layout: editor.layout,
            }
          : {
              primaryColor: "#2563eb",
              backgroundColor: "#ffffff",
              submitLabel: "Submit",
              showPoweredBy: true,
              layout: "card",
            },
        thankYou: {
          title: editor.thankYouTitle,
          message: editor.thankYouMessage,
          ...(canBrand && editor.redirectUrl.trim()
            ? { redirectUrl: editor.redirectUrl.trim() }
            : {}),
        },
        fields: editor.questions.map((question, index) => {
          const visibility = question.visibility?.conditions.length
            ? {
                conjunction: question.visibility.conjunction,
                conditions: question.visibility.conditions.map(
                  (condition) => {
                    const source = editor.questions.find(
                      (candidate) =>
                        candidate.id === condition.sourceQuestionId,
                    )
                    if (!source) {
                      throw new Error(
                        `An earlier question used by “${question.label}” is unavailable.`,
                      )
                    }
                    return {
                      id: condition.id,
                      sourceFieldId: source.targetFieldId,
                      operator: condition.operator,
                      value: condition.value,
                    }
                  },
                ),
              }
            : undefined
          return {
            targetFieldId: question.targetFieldId,
            label: question.label,
            description: question.description || undefined,
            placeholder: question.placeholder || undefined,
            required:
              question.mode === "hidden" ? true : question.required,
            rank: rankFor(index),
            mode: question.mode,
            fixedValue:
              question.mode === "hidden"
                ? question.fixedValue
                : undefined,
            prefillParameter:
              question.mode === "visible" &&
              question.prefillParameter
                ? question.prefillParameter
                : undefined,
            visibility:
              question.mode === "visible" ? visibility : undefined,
          }
        }),
      })
      setExpectedRevision(result.draftRevision)
      setDirty(false)
      if (!silent) {
        toast.success("Changes saved", {
          description: "Your questions and form settings are up to date.",
        })
      }
      return true
    } catch (error) {
      toast.error("Could not save your changes", {
        description: errorMessage(error),
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  function loadLatestDraft() {
    const latest = editorStateFromDraft(draft, canBrand)
    setEditor(latest)
    setSelectedQuestionId(latest.questions[0]?.id)
    setExpectedRevision(draft.form.draftRevision)
    setDirty(false)
    setReloadDialogOpen(false)
    toast.success("Latest changes loaded")
  }

  async function publish() {
    if (!canManage || publishing) return
    if (!canStartFormWrite("Publishing the form")) return
    setPublishing(true)
    try {
      if (!(await save({ silent: true }))) return
      if (!canStartFormWrite("Publishing the form")) return
      const result = await publishForm({
        formId: draft.form._id,
        timeZone: resolvedAnalyticsTimeZone(),
      })
      setLocalPublished({
        version: result.version,
        snapshot: draftPublishSnapshot,
      })
      setEditor((current) => ({ ...current, status: "published" }))
      setPublishDialogOpen(false)
      toast.success("Form published", {
        description: "Your changes are live and ready to share.",
      })
    } catch (error) {
      toast.error("Could not publish the form", {
        description: errorMessage(error),
      })
    } finally {
      setPublishing(false)
    }
  }

  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/f/${draft.form.slug}`,
      )
      toast.success("Share link copied")
    } catch {
      toast.error("Could not copy the share link")
    }
  }

  async function copyLinkWithStartingAnswer(
    question: EditorQuestion,
    field: FieldDoc,
  ) {
    const answer = shareLinkAnswer(
      field,
      shareLinkAnswers[question.id] ?? "",
    )
    if (answer.issue || !answer.value) {
      toast.error("Check the starting answer", {
        description: answer.issue ?? "Enter a starting answer.",
      })
      return
    }
    if (!question.prefillParameter) {
      toast.error("Turn on link autofill first.")
      return
    }

    try {
      const url = new URL(`/f/${draft.form.slug}`, window.location.origin)
      url.searchParams.set(question.prefillParameter, answer.value)
      await navigator.clipboard.writeText(url.toString())
      toast.success("Prefilled link copied", {
        description: `“${question.label}” will open with your starting answer.`,
      })
    } catch {
      toast.error("Could not copy the prefilled link")
    }
  }

  async function closePublishedForm() {
    if (!canManage || closing) return
    if (!canStartFormWrite("Closing the form")) return
    setClosing(true)
    try {
      await closeForm({ formId: draft.form._id })
      setEditor((current) => ({ ...current, status: "closed" }))
      setCloseDialogOpen(false)
      toast.success("Form closed", {
        description: "The share link no longer accepts submissions.",
      })
    } catch (error) {
      toast.error("Could not close the form", {
        description: errorMessage(error),
      })
    } finally {
      setClosing(false)
    }
  }

  const previewFields: FieldDefinition[] = activeFields.map((field) => ({
    id: field._id,
    name: field.name,
    type: field.type,
    config: field.config,
    rank: field.rank,
    width: field.width,
    isPrimary: field.isPrimary,
  }))
  const previewQuestions: FormQuestion[] = editor.questions.map(
    (question, index) => ({
      id: question.id,
      fieldId: question.targetFieldId,
      label: question.label || "Untitled question",
      helpText: question.description,
      placeholder: question.placeholder,
      required: question.required,
      rank: rankFor(index),
      mode: question.mode,
      fixedValue: question.fixedValue,
      prefillParameter:
        question.prefillParameter || undefined,
      visibility: question.visibility,
    }),
  )
  const previewForm: FormDefinition = {
    id: draft.form._id,
    baseId,
    tableId: draft.form.tableId,
    name: editor.name,
    title: editor.title || "Untitled form",
    description: editor.description,
    submitLabel: editor.submitLabel,
    thankYouTitle: editor.thankYouTitle,
    thankYouMessage: editor.thankYouMessage,
    redirectUrl: editor.redirectUrl || undefined,
    publicSlug: draft.form.slug,
    status: editor.status,
    theme: {
      accent: editor.primaryColor,
      background: editor.backgroundColor,
      layout: editor.layout,
      logoUrl: editor.logoUrl,
      coverUrl: editor.coverUrl,
      hideBranding: !editor.showPoweredBy,
    },
    questions: previewQuestions,
    version: 0,
  }
  const hasPublishedLink = editor.status === "published"

  return (
    <main className="workspace-shell-offset min-h-dvh bg-muted/20">
      <ConnectedTopBar>
        <Button
          render={<Link href={`/bases/${baseId}/forms`} />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          All forms
        </Button>
      </ConnectedTopBar>

      <div className="border-b bg-background">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <div className="min-w-0">
            <FormBreadcrumbs
              className="mb-2"
              items={[
                {
                  href: `/bases/${baseId}/forms`,
                  label: "Forms",
                },
                { label: editor.name },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold">{editor.name}</h1>
              <StatusBadge status={editor.status} />
              {effectiveLiveVersion ? (
                <Badge
                  className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                  variant="outline"
                >
                  Live version {effectiveLiveVersion}
                </Badge>
              ) : (
                <Badge className="rounded-full" variant="outline">
                  Draft only
                </Badge>
              )}
              {dirty ? (
                <Badge className="rounded-full" variant="secondary">
                  Unsaved changes
                </Badge>
              ) : null}
              <FormWriteStatus
                hasUnsavedDraft={dirty}
                health={connectionHealth}
              />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Answers save in this table · {activeFields.length} columns available
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              onClick={() => setAssistantOpen(true)}
              size="sm"
              variant="ghost"
            >
              <Sparkles />
              AI assistant
            </Button>
            <Button
              render={
                <Link
                  href={`/bases/${baseId}/forms/${draft.form._id}/analytics`}
                />
              }
              size="sm"
              variant="ghost"
            >
              <BarChart3 />
              Analytics
            </Button>
            <Button
              render={
                <Link
                  href={`/bases/${baseId}/forms/${draft.form._id}/submissions`}
                />
              }
              size="sm"
              variant="ghost"
            >
              <FileInput />
              Responses
            </Button>
            <Button
              disabled={!hasPublishedLink}
              onClick={() => void copyPublicLink()}
              size="sm"
              variant="outline"
            >
              <Copy />
              Copy link
            </Button>
            {hasPublishedLink ? (
              <Button
                render={
                  <Link href={`/f/${draft.form.slug}`} target="_blank" />
                }
                size="sm"
                variant="outline"
              >
                <ExternalLink />
                Open
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {!canManage ? (
        <div className="border-b bg-amber-50 px-5 py-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="mx-auto flex max-w-[1600px] items-center gap-2">
            <LockKeyhole className="size-4 shrink-0" />
            This form is view only. An organization admin can edit and
            publish it.
          </div>
        </div>
      ) : null}

      {hasRemoteChanges ? (
        <div className="border-b bg-amber-50 px-5 py-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
            <span className="flex-1">
              Someone else updated this form. Load their changes before
              saving or publishing.
            </span>
            <Button
              onClick={() => setReloadDialogOpen(true)}
              size="sm"
              variant="outline"
            >
              Load latest
            </Button>
          </div>
        </div>
      ) : null}

      <div
        aria-label="Publication status"
        className="sticky top-0 z-20 border-b bg-background/95 px-4 py-2.5 text-sm shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur md:px-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              publishSummary.hasChanges
                ? "bg-amber-500"
                : "bg-emerald-500",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {!effectiveLiveSnapshot
                ? "Draft only"
                : publishSummary.hasChanges
                  ? `${publishSummary.changeCount} unpublished ${publishSummary.changeCount === 1 ? "change" : "changes"}`
                  : `Published · version ${effectiveLiveVersion}`}
            </p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {!effectiveLiveSnapshot
                ? "Save your work, then publish when the form is ready to share."
                : publishSummary.hasChanges
                  ? "Your draft is saved separately from the version visitors can see."
                  : "The editor matches the public form."}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              disabled={
                !canManage ||
                saving ||
                publishing ||
                hasRemoteChanges ||
                !connectionHealth.canStartWrite
              }
              onClick={() => void save()}
              size="sm"
              variant="outline"
            >
              {saving && !publishing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Save />
              )}
              Save changes
            </Button>
            <Button
              aria-label="Review publish changes"
              disabled={
                !canManage ||
                saving ||
                publishing ||
                hasRemoteChanges ||
                !connectionHealth.canStartWrite ||
                (!publishSummary.hasChanges &&
                  editor.status === "published")
              }
              onClick={() => setPublishDialogOpen(true)}
              size="sm"
            >
              {publishing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              Review & publish
            </Button>
          </div>
        </div>
      </div>

      <div className="grid w-full xl:h-[calc(100dvh-192px)] xl:min-h-[620px] xl:grid-cols-[260px_minmax(420px,1fr)_340px]">
        <aside className="min-h-0 border-b bg-background xl:flex xl:flex-col xl:border-r xl:border-b-0">
          <div className="flex items-center px-4 py-3.5">
            <div>
              <p className="text-sm font-semibold">Form outline</p>
              <p className="text-[11px] text-muted-foreground">
                Drag questions to reorder
              </p>
            </div>
            <Badge className="ml-2 rounded-full" variant="secondary">
              {editor.questions.length}
            </Badge>
            <Button
              aria-label="Add question"
              className="ml-auto"
              disabled={!canManage || editor.questions.length >= activeFields.length}
              onClick={addQuestion}
              size="icon-sm"
              variant="ghost"
            >
              <Plus />
            </Button>
          </div>
          <Separator />
          <ScrollArea className="max-h-72 xl:min-h-0 xl:max-h-none xl:flex-1">
            <div className="space-y-1 p-2.5">
              {editor.questions.map((question, index) => {
                const target = fieldById.get(question.targetFieldId)
                return (
                  <div
                    className={cn(
                      "group flex items-center gap-2 rounded-md border p-2.5 transition-colors",
                      selectedQuestionId === question.id
                        ? "border-primary/35 bg-primary/[0.045]"
                        : "border-transparent hover:border-border hover:bg-muted/30",
                      draggedQuestionId === question.id && "opacity-45",
                      dropQuestionId === question.id &&
                        draggedQuestionId !== question.id &&
                        "border-primary bg-primary/5",
                    )}
                    draggable={canManage}
                    key={question.id}
                    onDragEnd={() => {
                      setDraggedQuestionId(undefined)
                      setDropQuestionId(undefined)
                    }}
                    onDragOver={(event) => {
                      if (!canManage || draggedQuestionId === question.id) {
                        return
                      }
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      setDropQuestionId(question.id)
                    }}
                    onDragStart={(event) => {
                      if (!canManage) {
                        event.preventDefault()
                        return
                      }
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData("text/plain", question.id)
                      setDraggedQuestionId(question.id)
                    }}
                    onDrop={(event) => dropQuestion(event, question.id)}
                  >
                    <GripVertical
                      aria-hidden="true"
                      className="size-3.5 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
                    />
                    <button
                      className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      draggable={false}
                      onClick={() => setSelectedQuestionId(question.id)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                        <span className="truncate">
                          {question.label || "Untitled question"}
                        </span>
                        {question.mode === "hidden" ? (
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                            Hidden value
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="truncate">
                          Saves to {target?.name ?? "an unavailable column"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">
                          {getFieldTypeLabel(target?.type)}
                        </span>
                      </span>
                    </button>
                    <span className="flex flex-col opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        aria-label={`Move ${question.label || "question"} up`}
                        className="rounded p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        disabled={!canManage || index === 0}
                        draggable={false}
                        onClick={() => moveQuestion(index, index - 1)}
                        type="button"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        aria-label={`Move ${question.label || "question"} down`}
                        className="rounded p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        disabled={
                          !canManage || index === editor.questions.length - 1
                        }
                        draggable={false}
                        onClick={() => moveQuestion(index, index + 1)}
                        type="button"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
          <div className="border-t p-3">
            <Button
              className="w-full"
              disabled={!canManage || editor.questions.length >= activeFields.length}
              onClick={addQuestion}
              variant="outline"
            >
              <Plus />
              Add question
            </Button>
          </div>
        </aside>

        <section
          aria-label="Live form preview"
          className="min-h-[620px] overflow-auto bg-muted/30 p-4 sm:p-6"
          style={{ backgroundColor: editor.backgroundColor }}
        >
          <div className="mx-auto mb-4 flex max-w-2xl items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">
                Public form preview
              </p>
              <p className="text-[10px] text-muted-foreground">
                Updates as you edit
              </p>
            </div>
            <div
              aria-label="Preview size"
              className="flex items-center rounded-md border bg-background p-0.5"
              role="group"
            >
              <Button
                aria-label="Desktop preview"
                onClick={() => setDevice("desktop")}
                size="sm"
                variant={device === "desktop" ? "secondary" : "ghost"}
              >
                <Monitor />
                Desktop
              </Button>
              <Button
                aria-label="Mobile preview"
                onClick={() => setDevice("mobile")}
                size="sm"
                variant={device === "mobile" ? "secondary" : "ghost"}
              >
                <Smartphone />
                Mobile
              </Button>
            </div>
          </div>
          <div
            className={cn(
              "mx-auto transition-[max-width] duration-200",
              device === "mobile" ? "max-w-[390px]" : "max-w-2xl",
            )}
          >
            <PublicForm embedded fields={previewFields} form={previewForm} />
          </div>
        </section>

        <aside className="min-h-0 border-t bg-background xl:border-t-0 xl:border-l">
          <Tabs className="flex h-full min-h-0 flex-col" defaultValue="question">
            <div className="border-b px-3 py-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Inspector
              </p>
              <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="question">
                <Settings2 />
                Field
              </TabsTrigger>
              <TabsTrigger aria-label="Design" value="design">
                <Palette />
                Style
              </TabsTrigger>
              <TabsTrigger value="completion">
                <Sparkles />
                After submit
              </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent className="m-0 min-h-0 flex-1 overflow-auto p-4" value="question">
              {selectedQuestion ? (
                <div className="grid gap-5">
                  <div className="flex items-start gap-3 border-b pb-4">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
                      <FileInput className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        Editing question
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold">
                        {selectedQuestion.label || "Untitled question"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {getFieldTypeLabel(
                          fieldById.get(selectedQuestion.targetFieldId)
                            ?.type,
                        )}
                      </p>
                    </div>
                  </div>

                  <p className="-mb-3 text-xs font-medium text-muted-foreground">
                    Response destination
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor={fieldMappingId}>
                      Save answers in
                    </Label>
                    <Select
                      disabled={!canManage}
                      onValueChange={(targetFieldId) => {
                        if (!targetFieldId) return
                        const previous = fieldById.get(
                          selectedQuestion.targetFieldId,
                        )
                        const next = fieldById.get(
                          targetFieldId as Id<"fields">,
                        )
                        const nextTargetFieldId =
                          targetFieldId as Id<"fields">
                        const resetsDisplayConditions =
                          editor.questions.some((question) =>
                            question.visibility?.conditions.some(
                              (condition) =>
                                condition.sourceQuestionId ===
                                selectedQuestion.id,
                            ),
                          )
                        setEditor((current) => ({
                          ...current,
                          questions: current.questions.map((question) => ({
                            ...question,
                            ...(question.id === selectedQuestion.id
                              ? {
                                  targetFieldId: nextTargetFieldId,
                                  ...(next &&
                                  selectedQuestion.label ===
                                    (previous?.name ?? "")
                                    ? { label: next.name }
                                    : {}),
                                  ...(question.mode === "hidden"
                                    ? next?.type === "attachment"
                                      ? {
                                          mode: "visible" as const,
                                          fixedValue: undefined,
                                        }
                                      : {
                                          fixedValue: next
                                            ? defaultFixedValueForField(next)
                                            : undefined,
                                        }
                                    : {}),
                                }
                              : {}),
                            visibility: question.visibility
                              ? {
                                  ...question.visibility,
                                  conditions:
                                    question.visibility.conditions.map(
                                      (condition) =>
                                        condition.sourceQuestionId ===
                                        selectedQuestion.id
                                          ? {
                                              ...condition,
                                              sourceFieldId:
                                                nextTargetFieldId,
                                              ...defaultFormConditionForField(
                                                next,
                                              ),
                                            }
                                          : condition,
                                    ),
                                }
                              : undefined,
                          })),
                        }))
                        setDirty(true)
                        if (resetsDisplayConditions) {
                          toast.info("Display conditions updated", {
                            description:
                              "Rules that use this question now match its new answer type.",
                          })
                        }
                      }}
                      value={selectedQuestion.targetFieldId}
                    >
                      <SelectTrigger
                        className="w-full"
                        id={fieldMappingId}
                      >
                        <SelectValue>
                          {fieldById.get(selectedQuestion.targetFieldId)
                            ?.name ?? "Choose a column"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {activeFields.map((field) => {
                          const mappedElsewhere = editor.questions.some(
                            (question) =>
                              question.id !== selectedQuestion.id &&
                              question.targetFieldId === field._id,
                          )
                          return (
                            <SelectItem
                              disabled={mappedElsewhere}
                              key={field._id}
                              value={field._id}
                            >
                              {field.name} · {getFieldTypeLabel(field.type)}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Each answer will appear in this table column. A column
                      can only be used once on this form.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="connected-question-mode">
                      How this column is filled
                    </Label>
                    <Select
                      disabled={!canManage}
                      onValueChange={(mode) => {
                        if (mode !== "visible" && mode !== "hidden") return
                        const field = fieldById.get(
                          selectedQuestion.targetFieldId,
                        )
                        if (
                          mode === "hidden" &&
                          field?.type === "attachment"
                        ) {
                          toast.info("File uploads stay visible", {
                            description:
                              "Visitors need an upload control to add files.",
                          })
                          return
                        }
                        updateQuestion(selectedQuestion.id, {
                          mode,
                          fixedValue:
                            mode === "hidden" && field
                              ? defaultFixedValueForField(field)
                              : undefined,
                          prefillParameter:
                            mode === "hidden"
                              ? ""
                              : selectedQuestion.prefillParameter,
                          required:
                            mode === "hidden"
                              ? true
                              : selectedQuestion.required,
                          visibility:
                            mode === "hidden"
                              ? undefined
                              : selectedQuestion.visibility,
                        })
                      }}
                      value={selectedQuestion.mode}
                    >
                      <SelectTrigger
                        className="w-full"
                        id="connected-question-mode"
                      >
                        <SelectValue>
                          {selectedQuestion.mode === "hidden"
                            ? "Set automatically and hide"
                            : "Ask on the form"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="visible">
                          Ask on the form
                        </SelectItem>
                        <SelectItem
                          disabled={
                            fieldById.get(selectedQuestion.targetFieldId)
                              ?.type === "attachment"
                          }
                          value="hidden"
                        >
                          Set automatically and hide
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {selectedQuestion.mode === "hidden"
                        ? `Visitors will not see this question. Every response receives the value you choose for “${fieldById.get(selectedQuestion.targetFieldId)?.name ?? "this column"}”.`
                        : "Visitors answer this question themselves."}
                    </p>
                  </div>

                  <Separator />
                  <p className="-mb-3 text-xs font-medium text-muted-foreground">
                    Question content
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="connected-question-label">
                      {selectedQuestion.mode === "hidden"
                        ? "Builder label"
                        : "Question label"}
                    </Label>
                    <Input
                      disabled={!canManage}
                      id="connected-question-label"
                      maxLength={160}
                      onChange={(event) => {
                        const nextLabel = event.target.value
                        const columnName =
                          fieldById.get(
                            selectedQuestion.targetFieldId,
                          )?.name ?? "answer"
                        const currentSuggestedName =
                          suggestedFormPrefillName(
                            selectedQuestion.label,
                            columnName,
                          )
                        updateQuestion(selectedQuestion.id, {
                          label: nextLabel,
                          ...(selectedQuestion.prefillParameter ===
                            currentSuggestedName
                            ? {
                                prefillParameter:
                                  availableFormPrefillName(
                                    editor.questions,
                                    selectedQuestion.id,
                                    nextLabel,
                                    columnName,
                                  ),
                              }
                            : {}),
                        })
                      }}
                      value={selectedQuestion.label}
                    />
                    {selectedQuestion.mode === "hidden" ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Only form editors see this label.
                      </p>
                    ) : null}
                  </div>

                  {selectedQuestion.mode === "hidden" ? (
                    <FixedValueControl
                      disabled={!canManage}
                      field={fieldById.get(
                        selectedQuestion.targetFieldId,
                      )}
                      onChange={(fixedValue) =>
                        updateQuestion(selectedQuestion.id, {
                          fixedValue,
                        })
                      }
                      value={selectedQuestion.fixedValue}
                    />
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="connected-question-description">
                          Description
                        </Label>
                        <Textarea
                          disabled={!canManage}
                          id="connected-question-description"
                          onChange={(event) =>
                            updateQuestion(selectedQuestion.id, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Optional context shown below the question"
                          rows={3}
                          value={selectedQuestion.description}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="connected-question-placeholder">
                          Placeholder
                        </Label>
                        <Input
                          disabled={!canManage}
                          id="connected-question-placeholder"
                          onChange={(event) =>
                            updateQuestion(selectedQuestion.id, {
                              placeholder: event.target.value,
                            })
                          }
                          placeholder="Optional input hint"
                          value={selectedQuestion.placeholder}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <span>
                          <span className="block text-xs font-medium">
                            Required
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            A response must include this question.
                          </span>
                        </span>
                        <Switch
                          aria-label="Required"
                          checked={selectedQuestion.required}
                          disabled={!canManage}
                          onCheckedChange={(required) =>
                            updateQuestion(selectedQuestion.id, { required })
                          }
                        />
                      </div>
                      <p className="-mb-3 text-xs font-medium text-muted-foreground">
                        Conditions
                      </p>
                      <ConditionalLogicEditor
                        disabled={!canManage}
                        fields={activeFields.map((field) => ({
                          id: field._id,
                          name: field.name,
                          type: field.type,
                          config: field.config,
                        }))}
                        onChange={(visibility) =>
                          updateQuestion(selectedQuestion.id, { visibility })
                        }
                        question={selectedQuestion}
                        questions={editor.questions}
                      />
                      <p className="-mb-3 text-xs font-medium text-muted-foreground">
                        Share-link prefill
                      </p>
                      {fieldById.get(selectedQuestion.targetFieldId)
                        ?.type === "attachment" ? (
                        <div className="rounded-lg border border-dashed p-3 text-xs leading-5 text-muted-foreground">
                          File-upload questions cannot start with an answer
                          from a share link.
                        </div>
                      ) : (
                        <div className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span>
                              <span className="block text-xs font-medium">
                                Start with an answer filled in
                              </span>
                              <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                                Create a link that opens with an editable
                                starting answer.
                              </span>
                            </span>
                            <Switch
                              aria-label="Start with an answer filled in"
                              checked={Boolean(
                                selectedQuestion.prefillParameter,
                              )}
                              disabled={!canManage}
                              onCheckedChange={(enabled) =>
                                updateQuestion(selectedQuestion.id, {
                                  prefillParameter: enabled
                                    ? availableFormPrefillName(
                                        editor.questions,
                                        selectedQuestion.id,
                                        selectedQuestion.label,
                                        fieldById.get(
                                          selectedQuestion.targetFieldId,
                                        )?.name ?? "answer",
                                      )
                                    : "",
                                })
                              }
                            />
                          </div>
                          {selectedQuestion.prefillParameter ? (
                            <div className="mt-3 grid gap-2 border-t pt-3">
                              <Label
                                htmlFor={`share-link-answer-${selectedQuestion.id}`}
                              >
                                Starting answer
                              </Label>
                              <Input
                                disabled={!canManage}
                                id={`share-link-answer-${selectedQuestion.id}`}
                                onChange={(event) =>
                                  setShareLinkAnswers((current) => ({
                                    ...current,
                                    [selectedQuestion.id]:
                                      event.target.value,
                                  }))
                                }
                                placeholder="Enter the answer to fill in"
                                value={
                                  shareLinkAnswers[selectedQuestion.id] ?? ""
                                }
                              />
                              <p className="text-[10px] leading-4 text-muted-foreground">
                                {shareLinkAnswerHint(
                                  fieldById.get(
                                    selectedQuestion.targetFieldId,
                                  ),
                                )}
                              </p>
                              <Button
                                className="w-fit"
                                disabled={
                                  !canManage ||
                                  !hasPublishedLink ||
                                  publishSummary.hasChanges ||
                                  !shareLinkAnswers[
                                    selectedQuestion.id
                                  ]?.trim()
                                }
                                onClick={() => {
                                  const field = fieldById.get(
                                    selectedQuestion.targetFieldId,
                                  )
                                  if (field) {
                                    void copyLinkWithStartingAnswer(
                                      selectedQuestion,
                                      field,
                                    )
                                  }
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <Copy />
                                Copy link with this answer
                              </Button>
                              {!hasPublishedLink ||
                              publishSummary.hasChanges ? (
                                <p className="text-[10px] leading-4 text-muted-foreground">
                                  Publish your latest changes before copying
                                  this link.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </>
                  )}
                  <Button
                    className="justify-start"
                    disabled={!canManage || editor.questions.length === 1}
                    onClick={() => removeQuestion(selectedQuestion.id)}
                    variant="destructive"
                  >
                    <Trash2 />
                    Remove question
                  </Button>
                </div>
              ) : (
                <div className="py-12 text-center">
                  <FileInput className="mx-auto size-6 text-muted-foreground" />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Select a question to choose where its answers are saved.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent
              className="m-0 min-h-0 flex-1 overflow-auto p-4"
              value="design"
            >
              <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="connected-form-name">Form name</Label>
                <Input
                  disabled={!canManage}
                  id="connected-form-name"
                  maxLength={120}
                  onChange={(event) =>
                    updateEditor({ name: event.target.value })
                  }
                  value={editor.name}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Only your teammates see this name.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connected-form-title">Form heading</Label>
                <Input
                  disabled={!canManage}
                  id="connected-form-title"
                  maxLength={160}
                  onChange={(event) =>
                    updateEditor({ title: event.target.value })
                  }
                  value={editor.title}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Shown to everyone who opens the form.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connected-form-description">Description</Label>
                <Textarea
                  disabled={!canManage}
                  id="connected-form-description"
                  maxLength={5000}
                  onChange={(event) =>
                    updateEditor({ description: event.target.value })
                  }
                  rows={4}
                  value={editor.description}
                />
              </div>

              <Separator />

              {!canBrand ? (
                <div className="rounded-lg border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Custom branding is locked.
                  </span>{" "}
                  Upgrade the organization to customize colors, submit text,
                  and hide Basecraft branding.
                </div>
              ) : null}

              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Page layout</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      {
                        value: "card",
                        label: "Card",
                        description: "Centered panel",
                      },
                      {
                        value: "plain",
                        label: "Open",
                        description: "Flat page",
                      },
                    ] as const
                  ).map((option) => (
                    <button
                      aria-pressed={editor.layout === option.value}
                      className={cn(
                        "rounded-xl border p-3 text-left outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring",
                        editor.layout === option.value &&
                          "border-primary bg-primary/5",
                      )}
                      disabled={!canManage || !canBrand}
                      key={option.value}
                      onClick={() =>
                        updateEditor({ layout: option.value })
                      }
                      type="button"
                    >
                      <span className="block text-xs font-medium">
                        {option.label} layout
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <AppearanceAssetControl
                busy={appearanceAssetBusy === "logo"}
                disabled={
                  !canManage ||
                  !canBrand ||
                  Boolean(appearanceAssetBusy) ||
                  !connectionHealth.canStartWrite
                }
                kind="logo"
                onRemove={() => void changeAppearanceAsset("logo")}
                onSelect={(file) =>
                  void changeAppearanceAsset("logo", file)
                }
                url={editor.logoUrl}
              />
              <AppearanceAssetControl
                busy={appearanceAssetBusy === "cover"}
                disabled={
                  !canManage ||
                  !canBrand ||
                  Boolean(appearanceAssetBusy) ||
                  !connectionHealth.canStartWrite
                }
                kind="cover"
                onRemove={() => void changeAppearanceAsset("cover")}
                onSelect={(file) =>
                  void changeAppearanceAsset("cover", file)
                }
                url={editor.coverUrl}
              />

              <ColorControl
                disabled={!canManage || !canBrand}
                id="connected-primary-color"
                label="Accent color"
                onChange={(primaryColor) => updateEditor({ primaryColor })}
                value={editor.primaryColor}
              />
              <ColorControl
                disabled={!canManage || !canBrand}
                id="connected-background-color"
                label="Page background"
                onChange={(backgroundColor) =>
                  updateEditor({ backgroundColor })
                }
                value={editor.backgroundColor}
              />
              <div className="grid gap-2">
                <Label htmlFor="connected-submit-label">Submit button</Label>
                <Input
                  disabled={!canManage || !canBrand}
                  id="connected-submit-label"
                  maxLength={80}
                  onChange={(event) =>
                    updateEditor({ submitLabel: event.target.value })
                  }
                  value={editor.submitLabel}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span>
                  <span className="block text-xs font-medium">
                    Show Basecraft branding
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Keep the “Powered by” footer on the public form.
                  </span>
                </span>
                <Switch
                  aria-label="Show Basecraft branding"
                  checked={editor.showPoweredBy}
                  disabled={!canManage || !canBrand}
                  onCheckedChange={(showPoweredBy) =>
                    updateEditor({ showPoweredBy })
                  }
                />
              </div>
              </div>
            </TabsContent>

            <TabsContent
              className="m-0 min-h-0 flex-1 overflow-auto p-4"
              value="completion"
            >
              <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="connected-thank-you-title">
                  Thank-you title
                </Label>
                <Input
                  disabled={!canManage}
                  id="connected-thank-you-title"
                  maxLength={160}
                  onChange={(event) =>
                    updateEditor({ thankYouTitle: event.target.value })
                  }
                  value={editor.thankYouTitle}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connected-thank-you-message">
                  Thank-you message
                </Label>
                <Textarea
                  disabled={!canManage}
                  id="connected-thank-you-message"
                  maxLength={2000}
                  onChange={(event) =>
                    updateEditor({ thankYouMessage: event.target.value })
                  }
                  rows={4}
                  value={editor.thankYouMessage}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="connected-redirect-url">
                  Redirect URL (optional)
                </Label>
                <Input
                  disabled={!canManage || !canBrand}
                  id="connected-redirect-url"
                  onChange={(event) =>
                    updateEditor({ redirectUrl: event.target.value })
                  }
                  placeholder="https://example.com/next"
                  type="url"
                  value={editor.redirectUrl}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {canBrand
                    ? "Visitors see the thank-you message first, then redirect."
                    : "Redirects are available on Starter and Pro."}
                </p>
              </div>

              <Separator />

              <Button
                disabled={!hasPublishedLink}
                onClick={() => void copyPublicLink()}
                variant="outline"
              >
                <Copy />
                Copy share link
              </Button>
              {hasPublishedLink ? (
                <Button
                  render={
                    <Link href={`/f/${draft.form.slug}`} target="_blank" />
                  }
                variant="ghost"
              >
                <ExternalLink />
                Open live form
                </Button>
              ) : null}
              <Button
                className="justify-start"
                disabled={
                  !canManage ||
                  editor.status !== "published" ||
                  !connectionHealth.canStartWrite
                }
                onClick={() => setCloseDialogOpen(true)}
                variant="destructive"
              >
                <EyeOff />
                Stop accepting responses
              </Button>
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <AlertDialog
        onOpenChange={setPublishDialogOpen}
        open={publishDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {publishSummary.firstPublication
                ? "Publish this form?"
                : "Publish these draft changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {publishSummary.firstPublication
                ? "This creates the live form people receive through your share link."
                : `Visitors currently see live version ${effectiveLiveVersion}. Review what will change before replacing it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <PublishChangeList summary={publishSummary} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishing}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                publishing ||
                !publishSummary.hasChanges ||
                !connectionHealth.canStartWrite
              }
              onClick={() => void publish()}
            >
              {publishing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              {publishSummary.firstPublication
                ? "Publish form"
                : `Publish ${publishSummary.changeCount} ${publishSummary.changeCount === 1 ? "change" : "changes"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setCloseDialogOpen} open={closeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop accepting responses?</AlertDialogTitle>
            <AlertDialogDescription>
              The shared link will stop accepting submissions. Your saved
              setup and existing responses remain available, and an admin can publish it
              again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={closing || !connectionHealth.canStartWrite}
              onClick={() => void closePublishedForm()}
              variant="destructive"
            >
              {closing ? <Loader2 className="animate-spin" /> : <EyeOff />}
              Close form
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setReloadDialogOpen} open={reloadDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load the latest changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Another admin saved this form. Loading their changes will
              discard any unsaved changes currently shown in this editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction onClick={loadLatestDraft}>
              Load latest changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConnectedAssistantSheet
        canUseAi={canUseAi}
        context={{
          base: { id: baseId },
          table: { id: draft.form.tableId },
          form: { id: draft.form._id, name: editor.name },
        }}
        onOpenChange={setAssistantOpen}
        open={assistantOpen}
        title="Form analyst"
      />
    </main>
  )
}

function PublishChangeList({
  summary,
}: {
  summary: FormPublishSummary
}) {
  const groups = [
    {
      label: "Added questions",
      values: summary.addedQuestions,
    },
    {
      label: "Updated questions",
      values: summary.updatedQuestions,
    },
    {
      label: "Removed questions",
      values: summary.removedQuestions,
    },
    {
      label: "Page changes",
      values: summary.changedSections,
    },
  ].filter((group) => group.values.length)

  return (
    <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 text-sm">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-medium text-muted-foreground">
            {group.label}
          </p>
          <p className="mt-1 leading-5">{group.values.join(", ")}</p>
        </div>
      ))}
      {summary.reorderedQuestions ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Question order
          </p>
          <p className="mt-1 leading-5">
            The live form will use the order shown in this editor.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function FixedValueControl({
  disabled,
  field,
  onChange,
  value,
}: {
  disabled: boolean
  field?: FieldDoc
  onChange: (value: FormConditionValue) => void
  value?: FormConditionValue
}) {
  const controlId = useId()

  if (!field) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        Choose a destination column before setting its automatic value.
      </div>
    )
  }

  const help = (
    <p className="text-xs leading-5 text-muted-foreground">
      This value is saved automatically in “{field.name}” for every response.
    </p>
  )

  if (field.type === "singleSelect") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={controlId}>Fixed value for {field.name}</Label>
        <Select
          disabled={disabled}
          onValueChange={(nextValue) => onChange(nextValue)}
          value={typeof value === "string" ? value : ""}
        >
          <SelectTrigger className="w-full" id={controlId}>
            <SelectValue placeholder="Choose an option">
              {field.config.options?.find(
                (option) => option.id === value,
              )?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(field.config.options ?? []).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {help}
      </div>
    )
  }

  if (field.type === "multiSelect") {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
    return (
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">
          Fixed value for {field.name}
        </legend>
        <div className="grid gap-2 rounded-lg border p-3">
          {(field.config.options ?? []).map((option) => (
            <label
              className="flex items-center gap-2 text-xs"
              htmlFor={`${controlId}-${option.id}`}
              key={option.id}
            >
              <Checkbox
                checked={selected.includes(option.id)}
                disabled={disabled}
                id={`${controlId}-${option.id}`}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...selected, option.id]
                      : selected.filter((item) => item !== option.id),
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    )
  }

  if (field.type === "checkbox") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={controlId}>Fixed value for {field.name}</Label>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <span className="text-xs font-medium">
            {value === true ? "Yes" : "No"}
          </span>
          <Switch
            checked={value === true}
            disabled={disabled}
            id={controlId}
            onCheckedChange={onChange}
          />
        </div>
        {help}
      </div>
    )
  }

  if (field.type === "rating") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={controlId}>Fixed value for {field.name}</Label>
        <Select
          disabled={disabled}
          onValueChange={(nextValue) => onChange(Number(nextValue))}
          value={typeof value === "number" ? String(value) : ""}
        >
          <SelectTrigger className="w-full" id={controlId}>
            <SelectValue placeholder="Choose a rating">
              {typeof value === "number"
                ? `${value} ${value === 1 ? "star" : "stars"}`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((rating) => (
              <SelectItem key={rating} value={String(rating)}>
                {rating} {rating === 1 ? "star" : "stars"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {help}
      </div>
    )
  }

  if (field.type === "longText") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={controlId}>Fixed value for {field.name}</Label>
        <Textarea
          disabled={disabled}
          id={controlId}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter the text saved with every response"
          rows={4}
          value={typeof value === "string" ? value : ""}
        />
        {help}
      </div>
    )
  }

  const numeric =
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent"
  const inputValue =
    numeric && typeof value === "number"
      ? field.type === "percent"
        ? value * 100
        : value
      : typeof value === "string"
        ? value
        : ""
  const inputType =
    numeric
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "email"
          ? "email"
          : field.type === "url"
            ? "url"
            : field.type === "phone"
              ? "tel"
              : "text"

  return (
    <div className="grid gap-2">
      <Label htmlFor={controlId}>Fixed value for {field.name}</Label>
      <Input
        disabled={disabled}
        id={controlId}
        max={
          numeric && field.config.max !== undefined
            ? field.type === "percent"
              ? field.config.max * 100
              : field.config.max
            : undefined
        }
        min={
          numeric && field.config.min !== undefined
            ? field.type === "percent"
              ? field.config.min * 100
              : field.config.min
            : undefined
        }
        onChange={(event) => {
          if (!numeric) {
            onChange(event.target.value)
            return
          }
          const nextValue = Number(event.target.value)
          onChange(
            field.type === "percent" ? nextValue / 100 : nextValue,
          )
        }}
        placeholder={
          numeric
            ? field.type === "percent"
              ? "e.g. 25"
              : "Enter a number"
            : "Enter the value saved with every response"
        }
        type={inputType}
        value={inputValue}
      />
      {field.type === "percent" ? (
        <p className="text-[10px] text-muted-foreground">
          Enter a percentage from 0 to 100.
        </p>
      ) : null}
      {help}
    </div>
  )
}

function ColorControl({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  disabled: boolean
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {FORM_COLOR_PRESETS.map((color) => (
          <button
            aria-label={`Use ${color.label} for ${label.toLowerCase()}`}
            aria-pressed={value.toLowerCase() === color.value}
            className="size-8 rounded-full border shadow-sm outline-none ring-offset-2 transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            key={color.value}
            onClick={() => onChange(color.value)}
            style={{ backgroundColor: color.value }}
            title={color.label}
            type="button"
          />
        ))}
        <label
          className={cn(
            "relative flex h-8 cursor-pointer items-center gap-2 rounded-full border bg-background px-3 text-xs font-medium shadow-sm",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span
            aria-hidden="true"
            className="size-4 rounded-full border"
            style={{ backgroundColor: value }}
          />
          Custom
          <input
            aria-label={`Choose a custom ${label.toLowerCase()}`}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            disabled={disabled}
            id={id}
            onChange={(event) => onChange(event.target.value)}
            type="color"
            value={value}
          />
        </label>
      </div>
    </div>
  )
}

function AppearanceAssetControl({
  busy,
  disabled,
  kind,
  onRemove,
  onSelect,
  url,
}: {
  busy: boolean
  disabled: boolean
  kind: "logo" | "cover"
  onRemove: () => void
  onSelect: (file: File) => void
  url?: string
}) {
  const inputId = `connected-form-${kind}-image`
  const label = kind === "logo" ? "Logo" : "Cover image"

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      {url ? (
        <div
          className={cn(
            "overflow-hidden rounded-xl border bg-muted/30",
            kind === "logo" ? "p-4" : "",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={`Current form ${kind}`}
            className={
              kind === "logo"
                ? "h-12 max-w-full object-contain object-left"
                : "h-28 w-full object-cover"
            }
            src={url}
          />
        </div>
      ) : (
        <div className="grid min-h-20 place-items-center rounded-xl border border-dashed bg-muted/20 text-muted-foreground">
          <span className="flex items-center gap-2 text-xs">
            <ImageIcon className="size-4" />
            No {kind === "logo" ? "logo" : "cover image"} selected
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          render={<label htmlFor={inputId} />}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? <Loader2 className="animate-spin" /> : <ImageIcon />}
          {busy
            ? "Uploading…"
            : url
              ? `Replace ${kind === "logo" ? "logo" : "cover"}`
              : `Choose ${kind === "logo" ? "logo" : "cover image"}`}
        </Button>
        <input
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          disabled={disabled}
          id={inputId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) onSelect(file)
            event.currentTarget.value = ""
          }}
          type="file"
        />
        {url ? (
          <Button
            disabled={disabled}
            onClick={onRemove}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 />
            Remove {kind === "logo" ? "logo" : "cover"}
          </Button>
        ) : null}
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">
        Choose a PNG, JPG, WebP, or GIF image up to 8 MB.
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: FormStatus }) {
  if (status === "published") {
    return (
      <Badge
        className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
        variant="outline"
      >
        Published
      </Badge>
    )
  }
  if (status === "closed") {
    return (
      <Badge className="rounded-full" variant="secondary">
        Closed
      </Badge>
    )
  }
  return (
    <Badge className="rounded-full" variant="outline">
      Not published
    </Badge>
  )
}
