"use client"

import { Eye, Plus, Trash2 } from "lucide-react"
import { useId } from "react"

import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  FieldConfig,
  FieldType,
  FormConditionOperator,
  FormConditionValue,
  FormVisibilityCondition,
  FormVisibilityRule,
} from "@/lib/domain"
import {
  FORM_CONDITION_OPERATOR_LABELS,
  defaultFormConditionForField,
  describeFormVisibility,
  formConditionOperatorsForField,
} from "@/lib/form-conditional-logic"
import { getFieldTypeLabel } from "@/lib/field-type-meta"

interface LogicQuestion {
  id: string
  targetFieldId: string
  label: string
  visibility?: FormVisibilityRule
}

interface LogicField {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
}

const VALUE_FREE_OPERATORS = new Set<FormConditionOperator>([
  "is_empty",
  "is_not_empty",
  "is_checked",
  "is_not_checked",
])

export function ConditionalLogicEditor({
  disabled,
  fields,
  onChange,
  question,
  questions,
}: {
  disabled?: boolean
  fields: readonly LogicField[]
  onChange: (visibility: FormVisibilityRule | undefined) => void
  question: LogicQuestion
  questions: readonly LogicQuestion[]
}) {
  const controlPrefix = useId()
  const visibilityModeId = `${controlPrefix}-visibility-mode`
  const conjunctionId = `${controlPrefix}-conjunction`
  const questionIndex = questions.findIndex(
    (candidate) => candidate.id === question.id,
  )
  const availableSources = questions.slice(0, Math.max(0, questionIndex))
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const questionsById = new Map(
    questions.map((candidate) => [candidate.id, candidate]),
  )
  const visibility = question.visibility
  const conditions = visibility?.conditions ?? []
  const conditional = conditions.length > 0
  const visibilityDescription = describeFormVisibility(
    visibility,
    questions,
    {
      valueLabel: (condition) => {
        const source = questionsById.get(condition.sourceQuestionId)
        const field = source
          ? fieldsById.get(source.targetFieldId)
          : undefined
        if (
          field?.type !== "singleSelect" &&
          field?.type !== "multiSelect"
        ) {
          return undefined
        }
        if (typeof condition.value !== "string") return undefined
        return field.config.options?.find(
          (option) => option.id === condition.value,
        )?.label
      },
    },
  )

  function addCondition() {
    const source = availableSources.find(
      (candidate) =>
        !conditions.some(
          (condition) => condition.sourceQuestionId === candidate.id,
        ),
    ) ?? availableSources[0]
    if (!source) return
    const field = fieldsById.get(source.targetFieldId)
    const condition = defaultCondition(source, field)
    onChange({
      conjunction: visibility?.conjunction ?? "and",
      conditions: [...conditions, condition],
    })
  }

  function updateCondition(
    conditionId: string,
    patch: Partial<FormVisibilityCondition>,
  ) {
    onChange({
      conjunction: visibility?.conjunction ?? "and",
      conditions: conditions.map((condition) =>
        condition.id === conditionId
          ? { ...condition, ...patch }
          : condition,
      ),
    })
  }

  function removeCondition(conditionId: string) {
    const next = conditions.filter(
      (condition) => condition.id !== conditionId,
    )
    onChange(
      next.length
        ? {
            conjunction: visibility?.conjunction ?? "and",
            conditions: next,
          }
        : undefined,
    )
  }

  return (
    <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Eye className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <Label
            className="text-xs font-medium"
            htmlFor={visibilityModeId}
          >
            Show this question
          </Label>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {visibilityDescription}
          </p>
        </div>
      </div>

      <Select
        disabled={disabled || availableSources.length === 0}
        onValueChange={(value) => {
          if (value === "always") {
            onChange(undefined)
          } else if (!conditional) {
            addCondition()
          }
        }}
        value={conditional ? "conditional" : "always"}
      >
        <SelectTrigger
          className="h-9 w-full bg-background"
          id={visibilityModeId}
        >
          <SelectValue>
            {conditional ? "Only when conditions match" : "Always"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="always">Always</SelectItem>
          <SelectItem value="conditional">
            Only when conditions match
          </SelectItem>
        </SelectContent>
      </Select>

      {availableSources.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-background px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          Add an earlier question before using display conditions.
        </p>
      ) : null}

      {conditional ? (
        <>
          {conditions.length > 1 ? (
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor={conjunctionId}>
                Show when
              </Label>
              <Select
                disabled={disabled}
                onValueChange={(conjunction) =>
                  onChange({
                    conjunction: conjunction as "and" | "or",
                    conditions,
                  })
                }
                value={visibility?.conjunction ?? "and"}
              >
                <SelectTrigger
                  className="h-8 w-full bg-background"
                  id={conjunctionId}
                >
                  <SelectValue>
                    {visibility?.conjunction === "or"
                      ? "Any condition matches"
                      : "All conditions match"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">
                    All conditions match
                  </SelectItem>
                  <SelectItem value="or">
                    Any condition matches
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-2">
            {conditions.map((condition, index) => {
              const source = questionsById.get(
                condition.sourceQuestionId,
              )
              const field = source
                ? fieldsById.get(source.targetFieldId)
                : undefined
              const operators = formConditionOperatorsForField(
                field?.type,
              )
              const selectedOperator = operators.includes(
                condition.operator,
              )
                ? condition.operator
                : (operators[0] ?? null)
              const sourceId = `${controlPrefix}-source-${index}`
              const operatorId = `${controlPrefix}-operator-${index}`
              const valueId = `${controlPrefix}-value-${index}`

              return (
                <div
                  className="grid gap-2 rounded-lg border bg-background p-2.5"
                  key={condition.id}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      Condition {index + 1}
                    </span>
                    <Button
                      aria-label={`Remove condition ${index + 1}`}
                      disabled={disabled}
                      onClick={() => removeCondition(condition.id)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor={sourceId}>
                      Earlier question
                    </Label>
                    <SearchableSelect
                      className="h-8 text-xs"
                      disabled={disabled}
                      emptyMessage="No earlier questions match."
                      id={sourceId}
                      onValueChange={(sourceQuestionId) => {
                        const nextSource = questionsById.get(sourceQuestionId)
                        if (!nextSource) return
                        const nextField = fieldsById.get(
                          nextSource.targetFieldId,
                        )
                        updateCondition(
                          condition.id,
                          defaultCondition(nextSource, nextField),
                        )
                      }}
                      options={availableSources.map((candidate) => {
                        const candidateField = fieldsById.get(
                          candidate.targetFieldId,
                        )
                        return {
                          value: candidate.id,
                          label:
                            candidate.label.trim() || "Untitled question",
                          description: candidateField
                            ? getFieldTypeLabel(candidateField.type)
                            : "Answer choice unavailable",
                        }
                      })}
                      placeholder="Choose an earlier question"
                      searchPlaceholder="Search questions…"
                      value={condition.sourceQuestionId}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs" htmlFor={operatorId}>
                      Condition
                    </Label>
                    <Select
                      disabled={disabled || !field}
                      onValueChange={(operator) => {
                        if (operator === null) return
                        const nextOperator =
                          operator as FormConditionOperator
                        updateCondition(condition.id, {
                          operator: nextOperator,
                          value: VALUE_FREE_OPERATORS.has(nextOperator)
                            ? undefined
                            : defaultFormConditionForField(field).value,
                        })
                      }}
                      value={selectedOperator}
                    >
                      <SelectTrigger
                        className="h-8 w-full bg-background"
                        id={operatorId}
                      >
                        <SelectValue>
                          {selectedOperator
                            ? FORM_CONDITION_OPERATOR_LABELS[selectedOperator]
                            : "Choose a condition"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {operators.map((operator) => (
                          <SelectItem key={operator} value={operator}>
                            {FORM_CONDITION_OPERATOR_LABELS[operator]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <ConditionValueEditor
                    condition={condition}
                    disabled={disabled}
                    field={field}
                    id={valueId}
                    onChange={(value) =>
                      updateCondition(condition.id, { value })
                    }
                  />
                </div>
              )
            })}
          </div>

          <Button
            className="justify-start"
            disabled={disabled || conditions.length >= 20}
            onClick={addCondition}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus />
            Add condition
          </Button>
        </>
      ) : null}
    </section>
  )
}

function ConditionValueEditor({
  condition,
  disabled,
  field,
  id,
  onChange,
}: {
  condition: FormVisibilityCondition
  disabled?: boolean
  field?: LogicField
  id: string
  onChange: (value: FormConditionValue | undefined) => void
}) {
  if (VALUE_FREE_OPERATORS.has(condition.operator)) {
    return null
  }

  if (field?.type === "singleSelect" || field?.type === "multiSelect") {
    const options = field.config.options ?? []
    return (
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor={id}>
          Answer
        </Label>
        <SearchableSelect
          className="h-8 text-xs"
          disabled={disabled || options.length === 0}
          emptyMessage="No answers match."
          id={id}
          onValueChange={onChange}
          options={options.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
          placeholder={
            options.length ? "Choose an answer" : "No answers available"
          }
          searchPlaceholder="Search answers…"
          value={
            typeof condition.value === "string"
              ? condition.value
              : ""
          }
        />
      </div>
    )
  }

  const numeric =
    field?.type === "number" ||
    field?.type === "currency" ||
    field?.type === "percent" ||
    field?.type === "rating"
  const date = field?.type === "date"
  const storedNumber =
    typeof condition.value === "number" ? condition.value : 0
  const displayNumber =
    field?.type === "percent" ? storedNumber * 100 : storedNumber

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs" htmlFor={id}>
        {date ? "Date" : numeric ? "Number" : "Answer"}
      </Label>
      <Input
        className="h-8 text-xs"
        disabled={disabled}
        id={id}
        inputMode={numeric ? "decimal" : undefined}
        onChange={(event) => {
          if (!numeric) {
            onChange(event.target.value)
            return
          }
          const value = event.target.valueAsNumber
          onChange(
            Number.isFinite(value)
              ? field?.type === "percent"
                ? value / 100
                : value
              : 0,
          )
        }}
        placeholder={date ? undefined : "Enter an answer"}
        step={numeric ? "any" : undefined}
        type={date ? "date" : numeric ? "number" : "text"}
        value={
          numeric
            ? displayNumber
            : typeof condition.value === "string"
              ? condition.value
              : ""
        }
      />
    </div>
  )
}

function defaultCondition(
  source: LogicQuestion,
  field: LogicField | undefined,
): FormVisibilityCondition {
  return {
    id: crypto.randomUUID(),
    sourceQuestionId: source.id,
    sourceFieldId: source.targetFieldId,
    ...defaultFormConditionForField(field),
  }
}
