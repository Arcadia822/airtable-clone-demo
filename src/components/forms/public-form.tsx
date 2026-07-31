"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  CheckCircle2,
  FileUp,
  Loader2,
  ShieldCheck,
  Star,
  X,
} from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { TurnstileWidget } from "@/components/forms/turnstile-widget"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type {
  FieldDefinition,
  FormDefinition,
  FormQuestion,
} from "@/lib/domain"
import {
  visibleFormQuestions,
  type FormAnswerValue,
} from "@/lib/form-conditional-logic"
import { publicErrorMessage } from "@/lib/public-errors"
import {
  attachmentAccept,
  attachmentKindErrorMessage,
} from "@/lib/file-selection"
import { readableForegroundColor } from "@/lib/color-contrast"
import { MAX_ATTACHMENTS_PER_CELL, MAX_FILE_BYTES } from "@/lib/plans"
import { hiddenFixedAnswerLookup } from "@/lib/form-prefill"
import {
  pruneHiddenPublicFormData,
  publicFormAnswerLookup,
  validatePublicFormData,
} from "@/lib/public-form-data"
import { cn } from "@/lib/utils"

export interface PublicFormSubmitResult {
  title?: string
  message?: string
  redirectUrl?: string
}

export interface PartialUploadState {
  uploadedCount: number
  totalCount: number
  failedFileName?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function controlDefaultValue(
  field: FieldDefinition,
  value: FormAnswerValue,
): string | number | undefined {
  if (field.type === "percent" && typeof value === "number") {
    return value * 100
  }
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined
}

function FormControl({
  question,
  field,
  describedBy,
  invalid,
  defaultValue,
  selectedFiles,
  onFilesChange,
}: {
  question: FormQuestion
  field: FieldDefinition
  describedBy?: string
  invalid?: boolean
  defaultValue?: FormAnswerValue
  selectedFiles?: File[]
  onFilesChange?: (files: File[]) => void
}) {
  const id = `form-question-${question.id}`
  const fileErrorId = `${id}-file-error`
  const options = field.config.options ?? []
  const [fileError, setFileError] = useState<string>()
  const [selectedOptionId, setSelectedOptionId] = useState(
    typeof defaultValue === "string" ? defaultValue : null,
  )

  if (field.type === "longText") {
    return (
      <Textarea
        id={id}
        name={question.id}
        required={question.required}
        defaultValue={controlDefaultValue(field, defaultValue)}
        rows={5}
        placeholder={question.placeholder || "Type your answer…"}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="min-h-28 resize-y bg-white"
      />
    )
  }

  if (field.type === "singleSelect") {
    const selectedOption = options.find(
      (option) => option.id === selectedOptionId,
    )
    return (
      <Select
        name={question.id}
        onValueChange={(nextValue) => setSelectedOptionId(nextValue)}
        required={question.required}
        value={selectedOptionId}
      >
        <SelectTrigger
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-required={question.required}
          className="h-10 w-full bg-white"
        >
          <SelectValue
            placeholder={question.placeholder || "Choose an option"}
          >
            {selectedOption
              ? selectedOption.label
              : selectedOptionId
                ? "Choice unavailable"
                : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span
                className="size-2 rounded-full"
                style={{ background: option.color }}
              />
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === "multiSelect") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const optionId = `${id}-${option.id}`
          return (
            <label
              key={option.id}
              htmlFor={optionId}
              className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm hover:border-primary/35"
            >
              <Checkbox
                id={optionId}
                name={question.id}
                value={option.id}
                defaultChecked={
                  Array.isArray(defaultValue) &&
                  defaultValue.includes(option.id)
                }
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
              <span
                className="size-2 rounded-full"
                style={{ background: option.color }}
              />
              {option.label}
            </label>
          )
        })}
      </div>
    )
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-3 text-sm">
        <Checkbox
          id={id}
          name={question.id}
          required={question.required}
          defaultChecked={defaultValue === true}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
        Yes
      </label>
    )
  }

  if (field.type === "rating") {
    return (
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="hidden gap-0.5 text-amber-500 sm:flex"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <Star className="size-4 fill-current" key={index} />
          ))}
        </div>
        <select
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-label={field.name}
          className="h-10 min-w-40 rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          defaultValue={
            typeof defaultValue === "number" ? String(defaultValue) : ""
          }
          id={id}
          name={question.id}
          required={question.required}
        >
          <option disabled={question.required} value="">
            Choose a rating
          </option>
          {Array.from({ length: 5 }, (_, index) => {
            const rating = index + 1
            return (
              <option key={rating} value={rating}>
                {rating} {rating === 1 ? "star" : "stars"}
              </option>
            )
          })}
        </select>
      </div>
    )
  }

  if (field.type === "attachment") {
    const files = selectedFiles ?? []
    return (
      <div className="grid gap-2">
        <label
          htmlFor={id}
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-white px-4 text-center transition hover:border-primary/45 hover:bg-primary/[0.025]"
        >
          <FileUp className="size-5 text-primary" />
          <span className="mt-2 text-sm font-medium">Choose files</span>
          <span className="mt-1 text-xs text-muted-foreground">
            Up to 25 MB each · 10 files maximum
          </span>
          <input
            id={id}
            name={question.id}
            type="file"
            className="sr-only"
            aria-describedby={
              [describedBy, fileError ? fileErrorId : undefined]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={invalid || Boolean(fileError)}
            aria-required={question.required}
            multiple
            accept={attachmentAccept(field.config.attachmentKind)}
            onChange={(event) => {
              const chosen = Array.from(event.currentTarget.files ?? [])
              const accepted: File[] = []
              let nextError: string | undefined

              for (const file of chosen) {
                const kindError = attachmentKindErrorMessage(
                  file,
                  field.config.attachmentKind,
                )
                if (kindError) {
                  nextError ??= kindError
                  continue
                }
                if (file.size > MAX_FILE_BYTES) {
                  nextError ??= `${file.name} is larger than 25 MB.`
                  continue
                }
                if (
                  files.length + accepted.length >=
                  MAX_ATTACHMENTS_PER_CELL
                ) {
                  nextError ??= `You can attach up to ${MAX_ATTACHMENTS_PER_CELL} files.`
                  continue
                }
                accepted.push(file)
              }

              if (accepted.length) onFilesChange?.([...files, ...accepted])
              setFileError(nextError)
              event.currentTarget.value = ""
            }}
          />
        </label>
        {files.length ? (
          <ul
            className="grid gap-1 rounded-xl border bg-white p-2"
            aria-label={`Selected files for ${question.label}`}
          >
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    onFilesChange?.(
                      files.filter((_, fileIndex) => fileIndex !== index),
                    )
                    setFileError(undefined)
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {fileError ? (
          <p
            id={fileErrorId}
            className="text-xs text-destructive"
            role="alert"
          >
            {fileError}
          </p>
        ) : null}
      </div>
    )
  }

  const inputType =
    field.type === "date"
      ? "date"
      : field.type === "email"
        ? "email"
        : field.type === "url"
          ? "url"
          : field.type === "phone"
            ? "tel"
            : field.type === "number" ||
                field.type === "currency" ||
                field.type === "percent"
              ? "number"
              : "text"

  return (
    <Input
      id={id}
      name={question.id}
      type={inputType}
      required={question.required}
      defaultValue={controlDefaultValue(field, defaultValue)}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      placeholder={
        question.placeholder ||
        (field.type === "singleLineText" ? "Type your answer…" : undefined)
      }
      className="h-10 bg-white"
    />
  )
}

export function PublicForm({
  form,
  fields,
  embedded = false,
  onSubmitData,
  turnstileSiteKey,
  onStart,
  onAbandonment,
  onValidationError,
  prefillValues,
  partialUploadState,
  onFileSelectionChange,
}: {
  form: FormDefinition
  fields: FieldDefinition[]
  embedded?: boolean
  onSubmitData?: (data: FormData) => Promise<PublicFormSubmitResult>
  turnstileSiteKey?: string
  onStart?: () => void
  onAbandonment?: (lastQuestionId?: string) => void
  onValidationError?: () => void
  prefillValues?: ReadonlyMap<string, FormAnswerValue>
  partialUploadState?: PartialUploadState
  onFileSelectionChange?: () => void
}) {
  const [status, setStatus] = useState<"idle" | "submitting" | "complete">("idle")
  const [progress, setProgress] = useState(0)
  const [validationError, setValidationError] = useState<string>()
  const [invalidQuestionId, setInvalidQuestionId] = useState<string>()
  const [completion, setCompletion] = useState<PublicFormSubmitResult>()
  const [turnstileToken, setTurnstileToken] = useState<string>()
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0)
  const [selectedFilesByQuestion, setSelectedFilesByQuestion] = useState<
    Record<string, File[]>
  >({})
  const initialAnswerSnapshot = useMemo(
    () =>
      new Map<string, FormAnswerValue>([
        ...hiddenFixedAnswerLookup(form.questions),
        ...(prefillValues ?? new Map()),
      ]),
    [form.questions, prefillValues],
  )
  const [answerSnapshot, setAnswerSnapshot] = useState<
    ReadonlyMap<string, FormAnswerValue>
  >(() => initialAnswerSnapshot)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const abandonmentReportedRef = useRef(false)
  const lastFocusedQuestionRef = useRef<string | undefined>(undefined)
  const onAbandonmentRef = useRef(onAbandonment)
  const formElementRef = useRef<HTMLFormElement>(null)
  const completionHeadingRef = useRef<HTMLHeadingElement>(null)
  const onTurnstileTokenChange = useCallback(
    (token: string | undefined) => setTurnstileToken(token),
    [],
  )
  const nativeInvalidBurstRef = useRef(false)
  const accentForeground = readableForegroundColor(form.theme.accent)
  const displayedQuestions = useMemo(
    () =>
      visibleFormQuestions(form.questions, answerSnapshot).filter(
        (question) => question.mode !== "hidden",
      ),
    [answerSnapshot, form.questions],
  )

  useEffect(() => {
    onAbandonmentRef.current = onAbandonment
  }, [onAbandonment])

  useEffect(() => {
    function reportAbandonment() {
      if (
        !startedRef.current ||
        completedRef.current ||
        abandonmentReportedRef.current
      ) {
        return
      }
      abandonmentReportedRef.current = true
      onAbandonmentRef.current?.(lastFocusedQuestionRef.current)
    }

    window.addEventListener("pagehide", reportAbandonment)
    return () => {
      window.removeEventListener("pagehide", reportAbandonment)
      reportAbandonment()
    }
  }, [])

  const applyAnswerSnapshot = useCallback(
    (nextAnswers: ReadonlyMap<string, FormAnswerValue>) => {
      setAnswerSnapshot(nextAnswers)
      if (
        invalidQuestionId &&
        !visibleFormQuestions(form.questions, nextAnswers).some(
          (question) => question.id === invalidQuestionId,
        )
      ) {
        setInvalidQuestionId(undefined)
        setValidationError(undefined)
      }
    },
    [form.questions, invalidQuestionId],
  )

  const refreshAnswerSnapshot = useCallback(() => {
    const formElement = formElementRef.current
    if (!formElement) return
    applyAnswerSnapshot(
      publicFormAnswerLookup(
        form,
        fields,
        new FormData(formElement),
        new Map(Object.entries(selectedFilesByQuestion)),
      ),
    )
  }, [
    applyAnswerSnapshot,
    fields,
    form,
    selectedFilesByQuestion,
  ])

  useEffect(() => {
    if (status === "complete") completionHeadingRef.current?.focus()
  }, [status])

  function failValidation(message: string, questionId?: string) {
    setValidationError(message)
    setInvalidQuestionId(questionId)
    onValidationError?.()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const data = new FormData(formElement)
    for (const question of form.questions) {
      const field = fields.find((item) => item.id === question.fieldId)
      if (field?.type !== "attachment") continue
      data.delete(question.id)
      for (const file of selectedFilesByQuestion[question.id] ?? []) {
        data.append(question.id, file)
      }
    }
    pruneHiddenPublicFormData(
      form,
      fields,
      data,
      new Map(Object.entries(selectedFilesByQuestion)),
    )
    const issue = validatePublicFormData(form, fields, data)
    if (issue) {
      failValidation(issue.message, issue.questionId)
      const control = Array.from(formElement.elements).find(
        (element) =>
          "name" in element &&
          (element as HTMLInputElement).name === issue.questionId,
      )
      if (control instanceof HTMLElement) control.focus()
      return
    }
    if (turnstileSiteKey) {
      if (!turnstileToken) {
        failValidation("Complete the verification before submitting.")
        return
      }
      data.set("cf-turnstile-response", turnstileToken)
    }
    setValidationError(undefined)
    setInvalidQuestionId(undefined)
    setStatus("submitting")
    setProgress(32)
    const progressTimer = window.setTimeout(() => setProgress(74), 250)
    try {
      const result = onSubmitData
        ? await onSubmitData(data)
        : await new Promise<PublicFormSubmitResult>((resolve) => {
            window.setTimeout(
              () =>
                resolve({
                  title: form.thankYouTitle,
                  message: form.thankYouMessage,
                }),
              650,
            )
          })
      window.clearTimeout(progressTimer)
      setProgress(100)
      setCompletion(result)
      completedRef.current = true
      setStatus("complete")
      if (result.redirectUrl) {
        window.setTimeout(() => window.location.assign(result.redirectUrl!), 1_200)
      }
    } catch (error) {
      window.clearTimeout(progressTimer)
      setProgress(0)
      setStatus("idle")
      setTurnstileResetNonce((current) => current + 1)
      failValidation(
        publicErrorMessage(
          error,
          "We could not save your response. Check your connection and try again.",
        ),
      )
    }
  }

  function captureNativeInvalid(event: FormEvent<HTMLFormElement>) {
    if (nativeInvalidBurstRef.current) return
    nativeInvalidBurstRef.current = true
    queueMicrotask(() => {
      nativeInvalidBurstRef.current = false
    })

    const target = event.target
    const questionId =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
        ? target.name
        : undefined
    const question = form.questions.find((item) => item.id === questionId)
    failValidation(
      question
        ? `Check “${question.label}” and try again.`
        : "Complete the required questions before submitting.",
      questionId || undefined,
    )
  }

  if (form.status === "closed") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">This form is closed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The team is no longer accepting responses through this link.
        </p>
      </div>
    )
  }

  if (status === "complete") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm sm:p-12">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className="mx-auto grid size-12 place-items-center rounded-full"
            style={{
              background: form.theme.accent,
              color: accentForeground,
            }}
          >
            <CheckCircle2 className="size-6" />
          </span>
          <h1
            ref={completionHeadingRef}
            tabIndex={-1}
            className="mt-5 text-2xl font-semibold tracking-tight outline-none"
          >
            {completion?.title ?? form.thankYouTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {completion?.message ?? form.thankYouMessage}
          </p>
          {completion?.redirectUrl ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Redirecting you now…
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            startedRef.current = false
            completedRef.current = false
            abandonmentReportedRef.current = false
            lastFocusedQuestionRef.current = undefined
            setStatus("idle")
            setProgress(0)
            setCompletion(undefined)
            setSelectedFilesByQuestion({})
            setAnswerSnapshot(initialAnswerSnapshot)
            setTurnstileResetNonce((current) => current + 1)
            onFileSelectionChange?.()
          }}
        >
          Submit another response
        </Button>
      </div>
    )
  }

  return (
    <div
      data-form-layout={form.theme.layout}
      className={cn(
        "mx-auto w-full overflow-hidden bg-white",
        form.theme.layout === "card"
          ? "max-w-2xl rounded-2xl border shadow-sm"
          : "max-w-3xl bg-transparent",
        embedded &&
          form.theme.layout === "card" &&
          "max-w-xl shadow-lg shadow-slate-950/5",
      )}
    >
      {form.theme.coverUrl ? (
        <div
          className="h-32 bg-cover bg-center"
          style={{ backgroundImage: `url(${form.theme.coverUrl})` }}
        />
      ) : (
        <div
          className="h-2"
          style={{
            background: `linear-gradient(90deg, ${form.theme.accent}, color-mix(in srgb, ${form.theme.accent} 45%, #38bdf8))`,
          }}
        />
      )}
      <div
        className={cn(
          "p-6 sm:p-9",
          form.theme.layout === "plain" && "sm:px-2",
        )}
      >
        {form.theme.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.theme.logoUrl}
            alt={`${form.title} logo`}
            className="mb-5 max-h-12 max-w-40 object-contain"
          />
        ) : null}
        <h1 className="text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {form.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {form.description}
        </p>

        {status === "submitting" ? <Progress value={progress} className="mt-6" /> : null}

        {validationError ? (
          <p
            id="public-form-validation-error"
            className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {validationError}
          </p>
        ) : null}

        {partialUploadState ? (
          <div
            className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-950 dark:text-amber-100"
            role="status"
          >
            <p className="font-medium">
              {partialUploadState.uploadedCount ===
              partialUploadState.totalCount
                ? `All ${partialUploadState.totalCount} ${partialUploadState.totalCount === 1 ? "file is" : "files are"} safely uploaded.`
                : `${partialUploadState.uploadedCount} of ${partialUploadState.totalCount} files are safely uploaded.`}
            </p>
            <p className="mt-0.5 text-xs leading-5">
              {partialUploadState.failedFileName
                ? `${partialUploadState.failedFileName} did not finish. `
                : "Your response has not been saved yet. "}
              Try again to continue. Already uploaded files will not be sent
              twice.
            </p>
          </div>
        ) : null}

        <form
          ref={formElementRef}
          className="mt-8 grid gap-7"
          onFocusCapture={(event) => {
            const questionContainer =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>(
                    "[data-public-question-id]",
                  )
                : null
            const questionId =
              questionContainer?.dataset.publicQuestionId
            if (
              questionId &&
              displayedQuestions.some(
                (question) => question.id === questionId,
              )
            ) {
              lastFocusedQuestionRef.current = questionId
            }
            if (startedRef.current) return
            startedRef.current = true
            onStart?.()
          }}
          onInputCapture={(event) => {
            const target = event.target
            const targetName =
              target instanceof HTMLInputElement ||
              target instanceof HTMLTextAreaElement ||
              target instanceof HTMLSelectElement
                ? target.name
                : undefined
            if (
              invalidQuestionId &&
              targetName === invalidQuestionId
            ) {
              setInvalidQuestionId(undefined)
              setValidationError(undefined)
            }
            queueMicrotask(refreshAnswerSnapshot)
          }}
          onChangeCapture={() => queueMicrotask(refreshAnswerSnapshot)}
          onInvalidCapture={captureNativeInvalid}
          onSubmit={submit}
        >
          {displayedQuestions.map((question) => {
            const field = fields.find((item) => item.id === question.fieldId)
            if (!field) return null
            const controlId = `form-question-${question.id}`
            const helpId = `${controlId}-help`
            const invalid = invalidQuestionId === question.id
            const describedBy = [
              question.helpText ? helpId : undefined,
              invalid ? "public-form-validation-error" : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined
            const label = (
              <>
                {question.label}
                {question.required ? (
                  <>
                    <span aria-hidden="true" className="ml-1 text-destructive">
                      *
                    </span>
                    <span className="sr-only"> (required)</span>
                  </>
                ) : null}
              </>
            )

            if (field.type === "multiSelect") {
              return (
                <fieldset
                  key={question.id}
                  className="grid min-w-0 gap-2"
                  data-public-question-id={question.id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  aria-required={question.required}
                >
                  <legend className="text-sm font-medium">{label}</legend>
                  {question.helpText ? (
                    <p
                      id={helpId}
                      className="-mt-0.5 text-xs leading-5 text-muted-foreground"
                    >
                      {question.helpText}
                    </p>
                  ) : null}
                  <FormControl
                    question={question}
                    field={field}
                    defaultValue={prefillValues?.get(question.id)}
                    describedBy={describedBy}
                    invalid={invalid}
                  />
                </fieldset>
              )
            }

            return (
              <div
                key={question.id}
                className="grid gap-2"
                data-public-question-id={question.id}
              >
                <Label htmlFor={controlId} className="text-sm">
                  {label}
                </Label>
                {question.helpText ? (
                  <p
                    id={helpId}
                    className="-mt-0.5 text-xs leading-5 text-muted-foreground"
                  >
                    {question.helpText}
                  </p>
                ) : null}
                <FormControl
                  question={question}
                  field={field}
                  defaultValue={prefillValues?.get(question.id)}
                  describedBy={describedBy}
                  invalid={invalid}
                  selectedFiles={selectedFilesByQuestion[question.id]}
                  onFilesChange={(files) => {
                    setSelectedFilesByQuestion((current) => ({
                      ...current,
                      [question.id]: files,
                    }))
                    onFileSelectionChange?.()
                    const nextAnswers = new Map(answerSnapshot)
                    nextAnswers.set(question.id, files)
                    applyAnswerSnapshot(nextAnswers)
                  }}
                />
              </div>
            )
          })}
          {turnstileSiteKey ? (
            <TurnstileWidget
              action="form-submit"
              siteKey={turnstileSiteKey}
              resetNonce={turnstileResetNonce}
              onTokenChange={onTurnstileTokenChange}
            />
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="mt-1 h-11 justify-center"
            style={{
              background: form.theme.accent,
              color: accentForeground,
            }}
            disabled={status === "submitting"}
          >
            {status === "submitting" ? (
              <>
                <Loader2 className="animate-spin" />
                Submitting…
              </>
            ) : (
              form.submitLabel
            )}
          </Button>
        </form>

        {!form.theme.hideBranding ? (
          <div className="mt-7 flex items-center justify-between border-t pt-5">
            <BrandMark showName />
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3" />
              Privacy-first form
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
