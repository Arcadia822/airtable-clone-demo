"use client"

import { useAction } from "convex/react"
import { AlertCircle, FileQuestion, Loader2 } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  PublicForm,
  type PartialUploadState,
  type PublicFormSubmitResult,
} from "@/components/forms/public-form"
import type {
  FieldConfig,
  FieldDefinition,
  FieldType,
  FormConditionOperator,
  FormConditionValue,
  FormDefinition,
} from "@/lib/domain"
import {
  createFileIdentityTracker,
  fileIdentityEntries,
  type FileIdentityTracker,
} from "@/lib/file-selection"
import {
  indicatesPublishedFormChanged,
  invalidatesPendingPublicSubmission,
  publicFormAnswers,
  publicSubmissionErrorMessage,
} from "@/lib/public-form-data"
import { publicFormPrefillValues } from "@/lib/form-prefill"
import {
  analyticsDeviceCategory,
  analyticsTrafficSource,
  type AnalyticsDeviceCategory,
  type AnalyticsTrafficSource,
} from "@/lib/form-analytics"

interface PublishedField {
  id: Id<"formVersionFields">
  type: FieldType
  config: FieldConfig
  label: string
  description?: string
  placeholder?: string
  required: boolean
  mode: "visible" | "hidden"
  fixedValue?: FormConditionValue
  prefillParameter?: string
  visibility?: {
    conjunction: "and" | "or"
    conditions: {
      id: string
      sourceQuestionId: Id<"formVersionFields">
      sourceFieldId: Id<"fields">
      operator: FormConditionOperator
      value?: FormConditionValue
    }[]
  }
}

interface PublishedForm {
  slug: string
  analyticsTimeZone: string
  formVersionId: Id<"formVersions">
  version: number
  title: string
  description: string
  appearance: {
    primaryColor: string
    backgroundColor: string
    submitLabel: string
    showPoweredBy: boolean
    layout: "card" | "plain"
    logoUrl: string | null
    coverUrl: string | null
  }
  fields: PublishedField[]
}

interface SubmissionSession {
  submissionSessionId: Id<"publicSubmissionSessions">
  submissionProof: string
  expiresAt: number
}

interface UploadSession {
  uploadSessionId: Id<"uploadSessions">
  uploadUrl: string
  expiresAt: number
}

interface UploadResult {
  ok: boolean
  attachmentId?: Id<"attachments">
  error?: string
}

interface SubmissionResult {
  thankYou?: {
    title?: string
    message?: string
    redirectUrl?: string
  }
}

interface PendingSubmission {
  session: SubmissionSession
  idempotencyKey: string
  attachmentIdsByFile: Map<string, Map<string, string>>
  fileIdentityTracker: FileIdentityTracker
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
const fallbackVisitorNonces = new Map<string, string>()

type PublicFormMetric =
  | "view"
  | "start"
  | "validation_error"
  | "abandonment"

interface PublicFormMetricContext {
  deviceCategory?: AnalyticsDeviceCategory
  trafficSource?: AnalyticsTrafficSource
  lastQuestionId?: Id<"formVersionFields">
}

export function ConnectedPublicForm({
  prefillQuery = "",
  slug,
}: {
  prefillQuery?: string
  slug: string
}) {
  const getPublicForm = useAction(api.publicActions.getPublicForm)
  const trackMetric = useAction(api.publicActions.trackFormMetric)
  const beginSubmission = useAction(api.publicActions.beginPublicSubmission)
  const createUploadSession = useAction(
    api.publicActions.createPublicUploadSession,
  )
  const finalizeUpload = useAction(api.publicActions.finalizePublicUpload)
  const submitForm = useAction(api.publicActions.submitForm)

  const [published, setPublished] = useState<PublishedForm | null>()
  const [loadError, setLoadError] = useState<string>()
  const [partialUploadState, setPartialUploadState] =
    useState<PartialUploadState>()
  const pendingSubmissionRef = useRef<PendingSubmission | null>(null)

  const recordMetric = useCallback(
    (
      form: Pick<PublishedForm, "slug" | "formVersionId">,
      metric: PublicFormMetric,
      context: PublicFormMetricContext = {},
    ) => {
      try {
        const safeContext =
          metric === "view"
            ? {
                ...(context.deviceCategory
                  ? { deviceCategory: context.deviceCategory }
                  : {}),
                ...(context.trafficSource
                  ? { trafficSource: context.trafficSource }
                  : {}),
              }
            : metric === "abandonment"
              ? context.lastQuestionId
                ? { lastQuestionId: context.lastQuestionId }
                : {}
              : {}
        void trackMetric({
          slug: form.slug,
          formVersionId: form.formVersionId,
          metric,
          visitorNonce: visitorNonce(form.slug),
          ...safeContext,
        }).catch(() => {
          // Analytics must never block a public form.
        })
      } catch {
        // Browser storage and analytics failures must never block a public form.
      }
    },
    [trackMetric],
  )

  useEffect(() => {
    let cancelled = false
    void getPublicForm({ slug })
      .then((result) => {
        if (cancelled) return
        const next = result as PublishedForm | null
        if (next && next.slug !== slug) {
          const query = prefillQuery ? `?${prefillQuery}` : ""
          window.history.replaceState(
            window.history.state,
            "",
            `/f/${encodeURIComponent(next.slug)}${query}`,
          )
        }
        setPublished(next)
        if (next) {
          recordMetric(next, "view", {
            deviceCategory: analyticsDeviceCategory(window.innerWidth),
            trafficSource: analyticsTrafficSource({
              currentUrl: window.location.href,
              referrer: document.referrer,
            }),
          })
        }
      })
      .catch(() => {
        if (cancelled) return
        setLoadError("This form could not be loaded.")
      })
    return () => {
      cancelled = true
    }
  }, [getPublicForm, prefillQuery, recordMetric, slug])

  const form = useMemo(
    () => (published ? toFormDefinition(published) : undefined),
    [published],
  )
  const fields = useMemo(
    () => (published ? toFieldDefinitions(published) : []),
    [published],
  )
  const prefillValues = useMemo(
    () =>
      form
        ? publicFormPrefillValues(
            form,
            fields,
            new URLSearchParams(prefillQuery),
          )
        : new Map(),
    [fields, form, prefillQuery],
  )

  if (loadError) {
    return (
      <PublicState
        icon={<AlertCircle className="size-6" />}
        title="This form is temporarily unavailable"
        description="The workspace could not be verified. Please try again shortly."
      />
    )
  }

  if (published === undefined) {
    return (
      <PublicState
        icon={<Loader2 className="size-6 animate-spin" />}
        title="Loading form"
        description="Checking the latest form…"
      />
    )
  }

  if (published === null) {
    return (
      <PublicState
        icon={<FileQuestion className="size-6" />}
        title="Form not found"
        description="This link may be incorrect, unpublished, or closed."
      />
    )
  }

  if (!form) {
    return null
  }
  const formDefinition = form

  if (!turnstileSiteKey) {
    return (
      <PublicState
        icon={<AlertCircle className="size-6" />}
        title="This form is temporarily unavailable"
        description="Please let the form owner know, or try again shortly."
      />
    )
  }

  async function submit(data: FormData): Promise<PublicFormSubmitResult> {
    if (!published) throw new Error("The published form is unavailable.")
    const turnstileToken = data.get("cf-turnstile-response")
    if (typeof turnstileToken !== "string" || !turnstileToken) {
      throw new Error("Complete the verification before submitting.")
    }

    const attachmentCount = published.fields.reduce((count, question) => {
      if (question.type !== "attachment") return count
      return (
        count +
        data
          .getAll(question.id)
          .filter(
            (value): value is File =>
              value instanceof File && Boolean(value.name),
          ).length
      )
    }, 0)
    let uploadedAttachmentCount = 0
    let failedFileName: string | undefined
    let pending = pendingSubmissionRef.current
    if (pending && pending.session.expiresAt <= Date.now()) {
      pendingSubmissionRef.current = null
      setPartialUploadState(undefined)
      pending = null
    }
    try {
      if (!pending) {
        const session = (await beginSubmission({
          slug: published.slug,
          formVersionId: published.formVersionId,
          turnstileToken,
        })) as SubmissionSession
        pending = {
          session,
          idempotencyKey: crypto.randomUUID(),
          attachmentIdsByFile: new Map(),
          fileIdentityTracker: createFileIdentityTracker(),
        }
        pendingSubmissionRef.current = pending
      }

      for (const question of published.fields) {
        if (question.type !== "attachment") continue
        const files = data
          .getAll(question.id)
          .filter(
            (value): value is File =>
              value instanceof File && Boolean(value.name),
          )
        const uploaded =
          pending.attachmentIdsByFile.get(question.id) ?? new Map()
        pending.attachmentIdsByFile.set(question.id, uploaded)
        for (const { file, key } of fileIdentityEntries(
          files,
          pending.fileIdentityTracker,
        )) {
          if (uploaded.has(key)) {
            uploadedAttachmentCount += 1
            continue
          }
          failedFileName = file.name
          const upload = (await createUploadSession({
            submissionSessionId: pending.session.submissionSessionId,
            submissionProof: pending.session.submissionProof,
            formVersionFieldId: question.id,
          })) as UploadSession
          const storageId = await uploadFile(upload.uploadUrl, file)
          const finalized = (await finalizeUpload({
            uploadSessionId: upload.uploadSessionId,
            storageId,
            fileName: file.name,
            submissionProof: pending.session.submissionProof,
          })) as UploadResult
          if (!finalized.ok || !finalized.attachmentId) {
            throw new Error(
              finalized.error ?? `${file.name} could not be finalized.`,
            )
          }
          uploaded.set(key, finalized.attachmentId)
          uploadedAttachmentCount += 1
          failedFileName = undefined
        }
      }

      const attachmentIds = new Map<string, string[]>()
      for (const question of published.fields) {
        if (question.type !== "attachment") continue
        const files = data
          .getAll(question.id)
          .filter(
            (value): value is File =>
              value instanceof File && Boolean(value.name),
          )
        const uploaded = pending.attachmentIdsByFile.get(question.id)
        attachmentIds.set(
          question.id,
          fileIdentityEntries(files, pending.fileIdentityTracker).flatMap(({ key }) => {
            const attachmentId = uploaded?.get(key)
            return attachmentId ? [attachmentId] : []
          }),
        )
      }

      const result = (await submitForm({
        slug: published.slug,
        formVersionId: published.formVersionId,
        submissionSessionId: pending.session.submissionSessionId,
        submissionProof: pending.session.submissionProof,
        idempotencyKey: pending.idempotencyKey,
        answers: publicFormAnswers(
          formDefinition,
          fields,
          data,
          attachmentIds,
        ).map((answer) => ({
          ...answer,
          formVersionFieldId:
            answer.formVersionFieldId as Id<"formVersionFields">,
        })),
      })) as SubmissionResult
      pendingSubmissionRef.current = null
      setPartialUploadState(undefined)

      return {
        title: result.thankYou?.title,
        message: result.thankYou?.message,
        redirectUrl: result.thankYou?.redirectUrl,
      }
    } catch (error) {
      if (attachmentCount > 0 && uploadedAttachmentCount > 0) {
        setPartialUploadState({
          uploadedCount: uploadedAttachmentCount,
          totalCount: attachmentCount,
          failedFileName,
        })
      }
      if (invalidatesPendingPublicSubmission(error)) {
        pendingSubmissionRef.current = null
        setPartialUploadState(undefined)
        if (indicatesPublishedFormChanged(error)) {
          void getPublicForm({ slug: published.slug })
            .then((latest) => setPublished(latest as PublishedForm | null))
            .catch(() => {
              // Keep the current form visible if refreshing it also fails.
            })
        }
      }
      throw new Error(publicSubmissionErrorMessage(error))
    }
  }

  return (
    <main
      className="min-h-dvh px-4 py-10 sm:px-6 sm:py-16"
      style={{ background: formDefinition.theme.background }}
    >
      <PublicForm
        fields={fields}
        form={formDefinition}
        key={published.formVersionId}
        onAbandonment={(lastQuestionId) => {
          const lastQuestion = published.fields.find(
            (question) => question.id === lastQuestionId,
          )
          recordMetric(published, "abandonment", {
            lastQuestionId: lastQuestion?.id,
          })
        }}
        onStart={() => recordMetric(published, "start")}
        onSubmitData={submit}
        partialUploadState={partialUploadState}
        onFileSelectionChange={() => setPartialUploadState(undefined)}
        onValidationError={() =>
          recordMetric(published, "validation_error")
        }
        prefillValues={prefillValues}
        turnstileSiteKey={turnstileSiteKey}
      />
    </main>
  )
}

function toFormDefinition(published: PublishedForm): FormDefinition {
  return {
    id: `public:${published.slug}`,
    baseId: "",
    tableId: "",
    name: published.title,
    title: published.title,
    description: published.description,
    submitLabel: published.appearance.submitLabel,
    thankYouTitle: "Thank you for your submission",
    thankYouMessage: "Your response has been received.",
    publicSlug: published.slug,
    status: "published",
    version: published.version,
    theme: {
      accent: published.appearance.primaryColor,
      background: published.appearance.backgroundColor,
      layout: published.appearance.layout ?? "card",
      logoUrl: published.appearance.logoUrl ?? undefined,
      coverUrl: published.appearance.coverUrl ?? undefined,
      hideBranding: !published.appearance.showPoweredBy,
    },
    questions: published.fields.map((field, index) => ({
      id: field.id,
      fieldId: field.id,
      label: field.label,
      helpText: field.description ?? "",
      placeholder: field.placeholder,
      required: field.required,
      mode: field.mode,
      fixedValue: field.fixedValue,
      prefillParameter: field.prefillParameter,
      rank: index.toString().padStart(4, "0"),
      visibility: field.visibility
        ? {
            conjunction: field.visibility.conjunction,
            conditions: field.visibility.conditions.map((condition) => ({
              ...condition,
              sourceQuestionId: condition.sourceQuestionId,
              // Public fields use their immutable version-question ID as
              // the local field mapping. Keep the consistency guard aligned
              // without exposing the underlying table column ID.
              sourceFieldId: condition.sourceQuestionId,
            })),
          }
        : undefined,
    })),
  }
}

function toFieldDefinitions(published: PublishedForm): FieldDefinition[] {
  return published.fields.map((field, index) => ({
    id: field.id,
    name: field.label,
    type: field.type,
    config: field.config,
    rank: index.toString().padStart(4, "0"),
    width: 180,
    isPrimary: false,
  }))
}

async function uploadFile(
  uploadUrl: string,
  file: File,
): Promise<Id<"_storage">> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
    },
    body: file,
  })
  if (!response.ok) {
    throw new Error(`${file.name} could not be uploaded.`)
  }
  const result = (await response.json()) as { storageId?: string }
  if (!result.storageId) {
    throw new Error(`${file.name} returned an invalid upload response.`)
  }
  return result.storageId as Id<"_storage">
}

function visitorNonce(slug: string): string {
  const key = `basecraft:form-visitor:${slug}`
  const fallback =
    fallbackVisitorNonces.get(key) ?? `session-${crypto.randomUUID()}`
  fallbackVisitorNonces.set(key, fallback)

  try {
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    window.sessionStorage.setItem(key, fallback)
  } catch {
    // Storage may be disabled or unavailable in privacy-focused browsers.
  }
  return fallback
}

function PublicState({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/20 px-5">
      <div className="max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <h1 className="mt-5 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </main>
  )
}
