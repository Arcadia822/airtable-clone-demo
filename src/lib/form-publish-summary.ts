import type {
  FormConditionValue,
  FormVisibilityRule,
} from "@/lib/domain"

export interface FormQuestionPublishSnapshot {
  identity: string
  label: string
  description?: string
  placeholder?: string
  required: boolean
  mode: "visible" | "hidden"
  fixedValue?: FormConditionValue
  prefillName?: string
  visibility?: FormVisibilityRule
}

export interface FormPublishSnapshot {
  title: string
  description: string
  appearance: {
    primaryColor: string
    backgroundColor: string
    submitLabel: string
    showPoweredBy: boolean
    layout: "card" | "plain"
    logoFingerprint?: string | null
    coverFingerprint?: string | null
  }
  thankYou: {
    title: string
    message: string
    redirectUrl?: string
  }
  questions: FormQuestionPublishSnapshot[]
}

export interface FormPublishSummary {
  firstPublication: boolean
  hasChanges: boolean
  addedQuestions: string[]
  removedQuestions: string[]
  updatedQuestions: string[]
  reorderedQuestions: boolean
  changedSections: string[]
  changeCount: number
}

export function summarizeFormPublication(
  draft: FormPublishSnapshot,
  live: FormPublishSnapshot | null,
  reopenShareLink = false,
): FormPublishSummary {
  if (!live) {
    const addedQuestions = draft.questions.map(questionName)
    const changedSections = [
      "Public heading and description",
      "Form design",
      "Thank-you message",
    ]
    return {
      firstPublication: true,
      hasChanges: true,
      addedQuestions,
      removedQuestions: [],
      updatedQuestions: [],
      reorderedQuestions: false,
      changedSections,
      changeCount: addedQuestions.length + changedSections.length,
    }
  }

  const draftByIdentity = new Map(
    draft.questions.map((question) => [question.identity, question]),
  )
  const liveByIdentity = new Map(
    live.questions.map((question) => [question.identity, question]),
  )
  const addedQuestions = draft.questions
    .filter((question) => !liveByIdentity.has(question.identity))
    .map(questionName)
  const removedQuestions = live.questions
    .filter((question) => !draftByIdentity.has(question.identity))
    .map(questionName)
  const updatedQuestions = draft.questions
    .filter((question) => {
      const publishedQuestion = liveByIdentity.get(question.identity)
      return (
        publishedQuestion !== undefined &&
        canonical(questionWithoutIdentity(question)) !==
          canonical(questionWithoutIdentity(publishedQuestion))
      )
    })
    .map(questionName)
  const sharedDraftOrder = draft.questions
    .filter((question) => liveByIdentity.has(question.identity))
    .map((question) => question.identity)
  const sharedLiveOrder = live.questions
    .filter((question) => draftByIdentity.has(question.identity))
    .map((question) => question.identity)
  const reorderedQuestions =
    canonical(sharedDraftOrder) !== canonical(sharedLiveOrder)
  const changedSections = [
    ...(draft.title !== live.title ||
    draft.description !== live.description
      ? ["Public heading and description"]
      : []),
    ...(canonical(draft.appearance) !== canonical(live.appearance)
      ? ["Form design"]
      : []),
    ...(canonical(draft.thankYou) !== canonical(live.thankYou)
      ? ["Thank-you message"]
      : []),
    ...(reopenShareLink ? ["Reopen the share link"] : []),
  ]
  const changeCount =
    addedQuestions.length +
    removedQuestions.length +
    updatedQuestions.length +
    (reorderedQuestions ? 1 : 0) +
    changedSections.length

  return {
    firstPublication: false,
    hasChanges: changeCount > 0,
    addedQuestions,
    removedQuestions,
    updatedQuestions,
    reorderedQuestions,
    changedSections,
    changeCount,
  }
}

function questionName(question: FormQuestionPublishSnapshot): string {
  return question.label.trim() || "Untitled question"
}

function questionWithoutIdentity(question: FormQuestionPublishSnapshot) {
  const comparable: Partial<FormQuestionPublishSnapshot> = {
    ...question,
  }
  delete comparable.identity
  return comparable
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
