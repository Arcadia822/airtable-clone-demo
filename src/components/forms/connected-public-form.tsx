"use client"

import { AlertCircle, FileQuestion, Loader2 } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  PublicForm,
  type PublicFormSubmitResult,
} from "@/components/forms/public-form"
import type {
  AttachmentValue,
  FieldDefinition,
  FormDefinition,
  FormTheme,
} from "@/lib/domain"
import { publicFormPrefillValues } from "@/lib/form-prefill"
import { analyticsDeviceCategory, analyticsTrafficSource } from "@/lib/form-analytics"

export interface ConnectedPublicFormProps {
  slug: string
  prefillQuery?: string
}

interface PublicFormPayload {
  slug: string
  formId: string
  versionId: string
  version: number
  title: string
  description: string
  theme: FormTheme
  thankYou: {
    title: string
    message: string
    redirectUrl?: string
  }
  settings: {
    allowMultipleSubmissions: boolean
    submitLabel: string
    showPoweredBy: boolean
  }
  form: FormDefinition
  fields: FieldDefinition[]
}

type MetricName = "view" | "start"

async function readPayload<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null
}

interface UploadedAttachment extends AttachmentValue {
  attachmentId: string
}

async function uploadAttachment(
  file: File,
  tableId: string,
  fieldId: string,
): Promise<UploadedAttachment> {
  const sessionResponse = await fetch("/api/attachments/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tableId, fieldId }),
  })
  const session = await readPayload<{
    uploadSessionId?: string
    uploadUrl?: string
    message?: string
  }>(sessionResponse)
  if (!sessionResponse.ok || !session?.uploadSessionId || !session.uploadUrl) {
    throw new Error(session?.message ?? `${file.name} 上传失败。`)
  }

  const separator = session.uploadUrl.includes("?") ? "&" : "?"
  const uploadResponse = await fetch(
    `${session.uploadUrl}${separator}name=${encodeURIComponent(file.name)}`,
    {
      method: "PUT",
      headers: {
        "content-type": file.type || "application/octet-stream",
      },
      body: file,
    },
  )
  const upload = await readPayload<{
    storageId?: string
    name?: string
    mimeType?: string
    size?: number
    message?: string
  }>(uploadResponse)
  if (!uploadResponse.ok || !upload?.storageId) {
    throw new Error(upload?.message ?? `${file.name} 上传失败。`)
  }

  const finalizeResponse = await fetch("/api/attachments/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      uploadSessionId: session.uploadSessionId,
      storageId: upload.storageId,
      name: upload.name ?? file.name,
      mimeType: upload.mimeType ?? file.type ?? "application/octet-stream",
    }),
  })
  const finalized = await readPayload<{
    attachment?: {
      id?: string
      attachmentId?: string
      name?: string
      mimeType?: string
      size?: number
      url?: string
    }
    message?: string
  }>(finalizeResponse)
  if (!finalizeResponse.ok) {
    throw new Error(finalized?.message ?? `${file.name} 上传失败。`)
  }
  const attachment = finalized?.attachment
  const attachmentId = attachment?.attachmentId ?? attachment?.id
  if (!attachment || !attachmentId) {
    throw new Error(`${file.name} 上传失败。`)
  }

  return {
    id: attachmentId,
    attachmentId,
    name: attachment.name ?? file.name,
    mimeType:
      attachment.mimeType ?? file.type ?? "application/octet-stream",
    size: typeof attachment.size === "number" ? attachment.size : file.size,
    ...(attachment.url ? { url: attachment.url } : {}),
  }
}

export function ConnectedPublicForm({
  slug,
  prefillQuery = "",
}: ConnectedPublicFormProps) {
  const [payload, setPayload] = useState<PublicFormPayload | null>()
  const [loadError, setLoadError] = useState<string>()
  const viewedSlugRef = useRef<string | undefined>(undefined)

  const trackMetric = useCallback(
    (
      metric: MetricName,
      context: {
        deviceCategory?: string
        trafficSource?: string
      } = {},
    ) => {
      void fetch(`/api/public/forms/${encodeURIComponent(slug)}/metric`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric, ...context }),
        keepalive: true,
      }).catch(() => undefined)
    },
    [slug],
  )

  useEffect(() => {
    let cancelled = false

    void fetch(`/api/public/forms/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await readPayload<PublicFormPayload & { message?: string }>(
          response,
        )
        if (cancelled) return
        if (!response.ok || !body?.form) {
          setPayload(null)
          if (body?.message && response.status >= 500) {
            setLoadError(body.message)
          }
          return
        }
        setPayload(body)
        if (body.slug !== slug) {
          const query = prefillQuery ? `?${prefillQuery}` : ""
          window.history.replaceState(
            window.history.state,
            "",
            `/f/${encodeURIComponent(body.slug)}${query}`,
          )
        }
        if (viewedSlugRef.current !== body.slug) {
          viewedSlugRef.current = body.slug
          trackMetric("view", {
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
        setPayload(null)
        setLoadError("This form could not be loaded.")
      })

    return () => {
      cancelled = true
    }
  }, [prefillQuery, slug, trackMetric])

  const prefillValues = useMemo(
    () =>
      payload
        ? publicFormPrefillValues(
            payload.form,
            payload.fields,
            new URLSearchParams(prefillQuery),
          )
        : new Map(),
    [payload, prefillQuery],
  )

  async function submit(data: FormData): Promise<PublicFormSubmitResult> {
    if (!payload) throw new Error("This form is unavailable.")

    const fieldsById = new Map(
      payload.fields.map((field) => [field.id, field]),
    )
    const answers: Record<string, unknown> = {}

    for (const question of payload.form.questions) {
      const field = fieldsById.get(question.fieldId)
      if (!field || question.mode === "hidden") continue

      if (field.type === "attachment" || field.type === "image") {
        const files = data
          .getAll(question.id)
          .filter(
            (value): value is File =>
              value instanceof File && Boolean(value.name),
          )
        if (!files.length) continue
        answers[question.id] = await Promise.all(
          files.map((file) =>
            uploadAttachment(file, payload.form.tableId, question.fieldId),
          ),
        )
        continue
      }

      if (field.type === "checkbox") {
        answers[question.id] = data.has(question.id)
        continue
      }

      if (field.type === "multiSelect") {
        answers[question.id] = data
          .getAll(question.id)
          .filter(
            (value): value is string =>
              typeof value === "string" && value !== "",
          )
        continue
      }

      const raw = data.get(question.id)
      if (typeof raw !== "string" || raw === "") continue

      if (
        field.type === "number" ||
        field.type === "currency" ||
        field.type === "percent" ||
        field.type === "rating"
      ) {
        const numeric = Number(raw)
        answers[question.id] =
          field.type === "percent" && Number.isFinite(numeric)
            ? numeric / 100
            : Number.isFinite(numeric)
              ? numeric
              : raw
        continue
      }

      answers[question.id] = raw
    }

    const response = await fetch(
      `/api/public/forms/${encodeURIComponent(payload.slug)}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      },
    )
    const body = await readPayload<{
      submissionId?: string
      recordId?: string
      thankYou?: {
        title?: string
        message?: string
        redirectUrl?: string
      }
      code?: string
      message?: string
    }>(response)

    if (!response.ok) {
      const error = new Error(
        body?.message ?? "We could not save your response. Please try again.",
      ) as Error & { code?: string }
      if (body?.code) error.code = body.code
      throw error
    }

    return {
      title: body?.thankYou?.title ?? payload.thankYou.title,
      message: body?.thankYou?.message ?? payload.thankYou.message,
      redirectUrl:
        body?.thankYou?.redirectUrl ?? payload.thankYou.redirectUrl,
    }
  }

  if (loadError) {
    return (
      <PublicState
        icon={<AlertCircle className="size-6" />}
        title="This form is temporarily unavailable"
        description={loadError}
      />
    )
  }

  if (payload === undefined) {
    return (
      <PublicState
        icon={<Loader2 className="size-6 animate-spin" />}
        title="Loading form"
        description="Checking the latest published version…"
      />
    )
  }

  if (payload === null) {
    return (
      <PublicState
        icon={<FileQuestion className="size-6" />}
        title="Form not found"
        description="This link may be incorrect, unpublished, or closed."
      />
    )
  }

  return (
    <main
      className="min-h-dvh px-4 py-8 sm:px-6 sm:py-14"
      style={{ background: payload.theme.background }}
    >
      <div className="mx-auto w-full max-w-3xl">
        <PublicForm
          form={payload.form}
          fields={payload.fields}
          prefillValues={prefillValues}
          onStart={() => trackMetric("start")}
          onSubmitData={submit}
        />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {payload.settings.showPoweredBy
            ? "Powered by Basecraft"
            : "Responses are stored securely."}
        </p>
      </div>
    </main>
  )
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
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
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
