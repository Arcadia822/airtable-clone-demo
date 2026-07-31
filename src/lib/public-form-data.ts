import type {
  FieldDefinition,
  FormDefinition,
  FormQuestion,
} from "@/lib/domain"
import { attachmentKindErrorMessage } from "@/lib/file-selection"
import {
  visibleFormQuestions,
  type FormAnswerValue,
} from "@/lib/form-conditional-logic"
import { MAX_ATTACHMENTS_PER_CELL, MAX_FILE_BYTES } from "@/lib/plans"

export type PublicAnswerValue = string | number | boolean | string[] | null

export interface PublicFormAnswer {
  formVersionFieldId: string
  value: PublicAnswerValue
}

export interface PublicFormValidationIssue {
  questionId: string
  message: string
}

const PENDING_SUBMISSION_INVALIDATING_CODES = new Set([
  "PUBLIC_SUBMISSION_SESSION_INVALID",
  "FORM_UPDATED_OR_CLOSED",
  "FORM_VERSION_NOT_FOUND",
])

const FORM_CHANGED_CODES = new Set([
  "FORM_UPDATED_OR_CLOSED",
  "FORM_VERSION_NOT_FOUND",
])

const PUBLIC_SUBMISSION_ERROR_CODES = [
  ...PENDING_SUBMISSION_INVALIDATING_CODES,
  "TURNSTILE_INVALID",
  "TURNSTILE_UNAVAILABLE",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "PUBLIC_UPLOAD_LIMIT_EXCEEDED",
  "ATTACHMENT_CELL_FULL",
  "UPLOAD_SESSION_NOT_FOUND",
  "INVALID_ATTACHMENT_QUESTION",
  "INVALID_FORM_ATTACHMENT",
  "REQUIRED_FORM_ANSWER_MISSING",
  "UNKNOWN_FORM_QUESTION",
  "DUPLICATE_FORM_ANSWER",
  "INVALID_SUBMISSION",
  "IDEMPOTENCY_CONFLICT",
  "BILLING_UNAVAILABLE",
] as const

export function publicFormAnswers(
  form: FormDefinition,
  fields: readonly FieldDefinition[],
  data: FormData,
  attachmentIds: ReadonlyMap<string, readonly string[]> = new Map(),
): PublicFormAnswer[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const visibleQuestions = visiblePublicFormQuestions(
    form,
    fields,
    data,
    attachmentIds,
  )

  return visibleQuestions.map((question) => {
    const field = fieldsById.get(question.fieldId)
    if (!field) {
      throw new Error(
        `The answer destination for “${question.label}” is unavailable.`,
      )
    }

    return {
      formVersionFieldId: question.id,
      value:
        question.mode === "hidden"
          ? (question.fixedValue ?? null)
          : answerValue(field, question.id, data, attachmentIds),
    }
  })
}

export function publicFormAnswerLookup(
  form: FormDefinition,
  fields: readonly FieldDefinition[],
  data: FormData,
  attachmentValues: ReadonlyMap<
    string,
    readonly unknown[]
  > = new Map(),
): ReadonlyMap<string, FormAnswerValue> {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const entries = form.questions.map(
    (question): [string, FormAnswerValue] => {
      const field = fieldsById.get(question.fieldId)
      if (!field) return [question.id, undefined]
      if (question.mode === "hidden") {
        return [question.id, question.fixedValue]
      }
      if (field.type === "attachment") {
        return [
          question.id,
          attachmentValues.get(question.id) ??
            data
              .getAll(question.id)
              .filter(
                (value): value is File =>
                  value instanceof File && Boolean(value.name),
              ),
        ]
      }
      if (field.type === "checkbox") {
        return [question.id, data.has(question.id)]
      }
      if (field.type === "multiSelect") {
        return [
          question.id,
          data
            .getAll(question.id)
            .filter(
              (value): value is string =>
                typeof value === "string" && value !== "",
            ),
        ]
      }
      const raw = data.get(question.id)
      if (
        typeof raw === "string" &&
        raw !== "" &&
        (field.type === "number" ||
          field.type === "currency" ||
          field.type === "percent" ||
          field.type === "rating")
      ) {
        const numericValue = Number(raw)
        return [
          question.id,
          Number.isFinite(numericValue)
            ? field.type === "percent"
              ? numericValue / 100
              : numericValue
            : raw,
        ]
      }
      return [
        question.id,
        typeof raw === "string" && raw !== "" ? raw : null,
      ]
    },
  )
  return new Map(entries)
}

export function visiblePublicFormQuestions(
  form: FormDefinition,
  fields: readonly FieldDefinition[],
  data: FormData,
  attachmentValues: ReadonlyMap<
    string,
    readonly unknown[]
  > = new Map(),
): FormQuestion[] {
  return visibleFormQuestions(
    form.questions,
    publicFormAnswerLookup(form, fields, data, attachmentValues),
  )
}

export function pruneHiddenPublicFormData(
  form: FormDefinition,
  fields: readonly FieldDefinition[],
  data: FormData,
  attachmentValues: ReadonlyMap<
    string,
    readonly unknown[]
  > = new Map(),
): FormQuestion[] {
  const visibleQuestions = visiblePublicFormQuestions(
    form,
    fields,
    data,
    attachmentValues,
  )
  const visibleIds = new Set(
    visibleQuestions.map((question) => question.id),
  )
  for (const question of form.questions) {
    if (!visibleIds.has(question.id)) data.delete(question.id)
  }
  return visibleQuestions
}

export function validatePublicFormData(
  form: FormDefinition,
  fields: readonly FieldDefinition[],
  data: FormData,
): PublicFormValidationIssue | null {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))

  for (const question of visiblePublicFormQuestions(form, fields, data)) {
    if (question.mode === "hidden") continue
    const field = fieldsById.get(question.fieldId)
    if (!field) continue

    if (field.type === "multiSelect" && question.required) {
      const selected = data
        .getAll(question.id)
        .some((value) => typeof value === "string" && value !== "")
      if (!selected) {
        return {
          questionId: question.id,
          message: `Choose at least one option for “${question.label}”.`,
        }
      }
    }

    if (field.type === "rating") {
      const raw = data.get(question.id)
      if (typeof raw === "string" && raw !== "") {
        const rating = Number(raw)
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          return {
            questionId: question.id,
            message: `“${question.label}” must be a whole-number rating from 1 to 5.`,
          }
        }
      }
    }

    if (field.type !== "attachment") continue
    const files = data
      .getAll(question.id)
      .filter(
        (value): value is File =>
          value instanceof File && Boolean(value.name),
      )

    if (question.required && files.length === 0) {
      return {
        questionId: question.id,
        message: `Attach at least one file for “${question.label}”.`,
      }
    }
    if (files.length > MAX_ATTACHMENTS_PER_CELL) {
      return {
        questionId: question.id,
        message: `Attach no more than ${MAX_ATTACHMENTS_PER_CELL} files to “${question.label}”.`,
      }
    }
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES)
    if (oversized) {
      return {
        questionId: question.id,
        message: `${oversized.name} is larger than 25 MB.`,
      }
    }
    const invalidKind = files.find((file) =>
      Boolean(
        attachmentKindErrorMessage(file, field.config.attachmentKind),
      ),
    )
    if (invalidKind) {
      return {
        questionId: question.id,
        message:
          attachmentKindErrorMessage(
            invalidKind,
            field.config.attachmentKind,
          ) ?? `Choose a valid file for “${question.label}”.`,
      }
    }
  }

  return null
}

export function publicSubmissionErrorCode(error: unknown): string | undefined {
  const dataCode = nestedErrorCode(error)
  if (dataCode) return dataCode

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  return PUBLIC_SUBMISSION_ERROR_CODES.find((code) => message.includes(code))
}

export function invalidatesPendingPublicSubmission(error: unknown): boolean {
  const code = publicSubmissionErrorCode(error)
  return Boolean(code && PENDING_SUBMISSION_INVALIDATING_CODES.has(code))
}

export function indicatesPublishedFormChanged(error: unknown): boolean {
  const code = publicSubmissionErrorCode(error)
  return Boolean(code && FORM_CHANGED_CODES.has(code))
}

export function publicSubmissionErrorMessage(error: unknown): string {
  switch (publicSubmissionErrorCode(error)) {
    case "PUBLIC_SUBMISSION_SESSION_INVALID":
      return "Your submission session expired. Complete the verification again, then retry."
    case "FORM_UPDATED_OR_CLOSED":
    case "FORM_VERSION_NOT_FOUND":
      return "This form changed or closed while you were submitting. Review the latest version before trying again."
    case "TURNSTILE_INVALID":
      return "The verification expired or could not be confirmed. Complete it again and retry."
    case "TURNSTILE_UNAVAILABLE":
      return "Verification is temporarily unavailable. Please try again shortly."
    case "RATE_LIMITED":
      return "This form is receiving a lot of responses. Please wait a moment and try again."
    case "QUOTA_EXCEEDED":
      return "This form has reached its current response limit."
    case "PUBLIC_UPLOAD_LIMIT_EXCEEDED":
    case "ATTACHMENT_CELL_FULL":
      return "Too many files were attached. Review the file limits and try again."
    case "UPLOAD_SESSION_NOT_FOUND":
      return "A file upload expired. Please retry the submission."
    case "INVALID_ATTACHMENT_QUESTION":
    case "INVALID_FORM_ATTACHMENT":
      return "One or more files could not be attached. Choose the files again and retry."
    case "REQUIRED_FORM_ANSWER_MISSING":
    case "UNKNOWN_FORM_QUESTION":
    case "DUPLICATE_FORM_ANSWER":
    case "INVALID_SUBMISSION":
      return "Review your answers and try the submission again."
    case "IDEMPOTENCY_CONFLICT":
      return "We could not safely retry that submission. Refresh the page before trying again."
    case "BILLING_UNAVAILABLE":
      return "This form is temporarily unavailable. Please try again shortly."
    default:
      return "We could not save your response. Your answers are still here, so please try again."
  }
}

function answerValue(
  field: FieldDefinition,
  questionId: string,
  data: FormData,
  attachmentIds: ReadonlyMap<string, readonly string[]>,
): PublicAnswerValue {
  if (field.type === "attachment") {
    return [...(attachmentIds.get(questionId) ?? [])]
  }
  if (field.type === "checkbox") {
    return data.has(questionId)
  }
  if (field.type === "multiSelect") {
    return data
      .getAll(questionId)
      .filter((value): value is string => typeof value === "string" && value !== "")
  }

  const raw = data.get(questionId)
  if (typeof raw !== "string" || raw === "") return null

  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      throw new Error(`“${field.name}” must be a valid number.`)
    }
    if (
      field.type === "rating" &&
      (!Number.isInteger(value) || value < 1 || value > 5)
    ) {
      throw new Error(
        `“${field.name}” must be a whole-number rating from 1 to 5.`,
      )
    }
    return field.type === "percent" ? value / 100 : value
  }

  return raw
}

function nestedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined

  const candidate = error as {
    code?: unknown
    data?: unknown
  }
  if (typeof candidate.code === "string") return candidate.code
  const data = candidate.data
  if (
    data &&
    typeof data === "object" &&
    typeof (data as { code?: unknown }).code === "string"
  ) {
    return (data as { code: string }).code
  }
  if (typeof data === "string") {
    return PUBLIC_SUBMISSION_ERROR_CODES.find((code) =>
      data.includes(code),
    )
  }
  return undefined
}
