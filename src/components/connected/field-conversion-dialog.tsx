"use client"

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Star,
  Trash2,
} from "lucide-react"

import { CurrencySelect } from "@/components/currency-select"
import { FieldValidationInputs } from "@/components/field-validation-inputs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { FieldConfig } from "@/lib/domain"
import { textLengthLimit } from "@/lib/field-config-validation"
import {
  fieldConversionApplyDisabled,
  type ConvertibleFieldType,
  type FieldConversionJobProgress,
  type FieldConversionPreview,
} from "@/lib/field-conversion"

const CHOICE_COLORS = [
  "#2563eb",
  "#0d9488",
  "#d97706",
  "#db2777",
  "#7c3aed",
] as const

export function FieldConversionDialog({
  acknowledged,
  applying,
  columnName,
  configIssue,
  job,
  onAcknowledgedChange,
  onApply,
  onCancel,
  onOpenChange,
  onRetry,
  onTargetConfigChange,
  open,
  preview,
  targetConfig,
  targetType,
}: {
  acknowledged: boolean
  applying: boolean
  columnName: string
  configIssue?: string | null
  job?: FieldConversionJobProgress | null
  onAcknowledgedChange: (acknowledged: boolean) => void
  onApply: () => void
  onCancel?: () => void
  onOpenChange: (open: boolean) => void
  onRetry?: () => void
  onTargetConfigChange: (config: FieldConfig) => void
  open: boolean
  preview: FieldConversionPreview | undefined
  targetConfig: FieldConfig
  targetType: ConvertibleFieldType
}) {
  const options = targetConfig.options ?? []
  const visibleWarnings =
    preview?.warnings.filter(
      (warning) => warning !== preview.blockingReason,
    ) ?? []
  const jobBusy = Boolean(
    job &&
      (job.status === "staging" ||
        job.status === "applying" ||
        job.status === "cancelling"),
  )
  const exactLossCount =
    job?.status === "ready"
      ? job.counts.cleared + job.counts.losingSomeInformation
      : 0
  const needsExactAcknowledgement = exactLossCount > 0
  const canCancelBeforeApply = Boolean(
    job &&
      job.phase === "staging" &&
      (job.status === "staging" ||
        job.status === "ready" ||
        job.status === "failed" ||
        job.status === "cancelling"),
  )

  function updateConfig(config: FieldConfig) {
    onAcknowledgedChange(false)
    onTargetConfigChange(config)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (applying) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Review the column change</DialogTitle>
          <DialogDescription>
            See exactly what will happen to saved values in “{columnName}”
            before anything changes.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 min-h-0 space-y-5 overflow-y-auto py-1 pr-2">
          {!job ? (
            <ConversionSettings
              config={targetConfig}
              onChange={updateConfig}
              options={options}
              targetType={targetType}
            />
          ) : null}

          {job ? (
            <>
              <ConversionJobStatus job={job} />
              {job.status === "ready" ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <PreviewCount
                      count={job.counts.keptAsIs}
                      label="Stay as-is"
                      tone="safe"
                    />
                    <PreviewCount
                      count={job.counts.changed}
                      label="Change format"
                      tone="change"
                    />
                    <PreviewCount
                      count={job.counts.cleared}
                      label="Will be empty"
                      tone={
                        job.counts.cleared > 0 ? "warning" : "safe"
                      }
                    />
                  </div>
                  {needsExactAcknowledgement ? (
                    <label
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/20"
                      htmlFor="field-conversion-exact-acknowledgement"
                    >
                      <Checkbox
                        aria-label="Confirm final conversion results"
                        checked={acknowledged}
                        id="field-conversion-exact-acknowledgement"
                        onCheckedChange={(checked) =>
                          onAcknowledgedChange(checked === true)
                        }
                      />
                      <span>
                        <span className="block font-medium">
                          I reviewed the final results for every saved row.
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {job.counts.cleared.toLocaleString()}{" "}
                          {job.counts.cleared === 1 ? "cell will" : "cells will"}{" "}
                          be empty and{" "}
                          {job.counts.losingSomeInformation.toLocaleString()}{" "}
                          {job.counts.losingSomeInformation === 1
                            ? "cell will"
                            : "cells will"}{" "}
                          lose part of the original value.
                        </span>
                      </span>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Every saved row is ready. No information will be lost.
                    </div>
                  )}
                </>
              ) : null}
            </>
          ) : configIssue ? (
            <div
              className="flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Finish the column choices</p>
                <p className="mt-0.5 text-xs leading-5">{configIssue}</p>
              </div>
            </div>
          ) : preview === undefined ? (
            <div
              aria-label="Preparing conversion preview"
              className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/20 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Checking saved values…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl border bg-muted/20 px-4 py-3">
                <span className="rounded-lg bg-background px-2.5 py-1.5 text-sm font-medium shadow-sm">
                  {preview.currentType}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                <span className="rounded-lg bg-foreground px-2.5 py-1.5 text-sm font-medium text-background">
                  {preview.newType}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {preview.counts.reviewedRows.toLocaleString()}{" "}
                  {preview.counts.reviewedRows === 1 ? "row" : "rows"} checked
                </span>
              </div>

              {preview.blockingReason ? (
                <div
                  className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">This change is not ready</p>
                    <p className="mt-0.5 text-xs leading-5">
                      {preview.blockingReason}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <PreviewCount
                    count={preview.counts.keptAsIs}
                    label="Stay as-is"
                    tone="safe"
                  />
                  <PreviewCount
                    count={preview.counts.changed}
                    label="Change format"
                    tone="change"
                  />
                  <PreviewCount
                    count={preview.counts.cleared}
                    label="Will be empty"
                    tone={
                      preview.counts.cleared > 0 ? "warning" : "safe"
                    }
                  />
                </div>
              )}

              {preview.examples.length ? (
                <section aria-labelledby="conversion-examples-title">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <h3
                        className="text-sm font-semibold"
                        id="conversion-examples-title"
                      >
                        Example values
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        A sample from this column, shown with names and values
                        only.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border">
                    {preview.examples.map((example, index) => (
                      <div
                        className="grid gap-2 border-b p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_auto] sm:items-center"
                        key={`${example.before}-${example.after}-${index}`}
                      >
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                            Before
                          </p>
                          <p className="truncate text-sm">
                            {example.before}
                          </p>
                        </div>
                        <ArrowRight
                          aria-hidden="true"
                          className="hidden size-3.5 text-muted-foreground sm:block"
                        />
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                            After
                          </p>
                          <p className="truncate text-sm">{example.after}</p>
                        </div>
                        <Badge
                          className="w-fit"
                          variant={
                            example.result === "Will be cleared"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {example.result}
                        </Badge>
                        <p className="text-xs leading-5 text-muted-foreground sm:col-span-4">
                          {example.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                  This column has no filled cells to convert.
                </div>
              )}

              {preview.dependencies.length ? (
                <section
                  aria-labelledby="conversion-dependencies-title"
                  className="rounded-xl border p-3"
                >
                  <h3
                    className="text-sm font-semibold"
                    id="conversion-dependencies-title"
                  >
                    Places to review
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {`These forms, saved views, and saved analyses use “${preview.columnName}”.`}
                  </p>
                  <ul className="mt-2 divide-y">
                    {preview.dependencies.map((dependency, index) => (
                      <li
                        className="flex items-center justify-between gap-3 py-2 text-sm first:pt-1 last:pb-1"
                        key={`${dependency.category}-${dependency.name}-${index}`}
                      >
                        <span className="min-w-0 truncate font-medium">
                          {dependency.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {dependency.category}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {visibleWarnings.length ? (
                <section
                  aria-labelledby="conversion-warnings-title"
                  className="rounded-xl border bg-amber-50/60 p-3 text-amber-950 dark:bg-amber-950/15 dark:text-amber-100"
                >
                  <h3
                    className="flex items-center gap-2 text-sm font-semibold"
                    id="conversion-warnings-title"
                  >
                    <AlertTriangle className="size-4" />
                    Check before changing
                  </h3>
                  <ul className="mt-2 space-y-1.5 pl-6 text-xs leading-5">
                    {visibleWarnings.map((warning, index) => (
                      <li className="list-disc" key={`${warning}-${index}`}>
                        {warning}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {preview.requiresDataLossAcknowledgement ? (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/20"
                  htmlFor="field-conversion-acknowledgement"
                >
                  <Checkbox
                    aria-label="Confirm conversion data loss"
                    checked={acknowledged}
                    id="field-conversion-acknowledgement"
                    onCheckedChange={(checked) =>
                      onAcknowledgedChange(checked === true)
                    }
                  />
                  <span>
                    <span className="block font-medium">
                      I understand that some saved information will change or
                      be cleared.
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      This acknowledgement is required before the column can
                      be changed.
                    </span>
                  </span>
                </label>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={
              (applying && !canCancelBeforeApply) ||
              (Boolean(job) && !canCancelBeforeApply) ||
              job?.status === "cancelling"
            }
            onClick={() =>
              canCancelBeforeApply ? onCancel?.() : onOpenChange(false)
            }
            type="button"
            variant="outline"
          >
            {job?.status === "cancelling"
              ? "Cancelling…"
              : canCancelBeforeApply
                ? "Cancel and unlock column"
                : "Keep current type"}
          </Button>
          {job?.status === "failed" ? (
            <Button disabled={applying} onClick={onRetry} type="button">
              Retry column change
            </Button>
          ) : job?.status === "ready" ? (
            <Button
              disabled={
                applying ||
                (needsExactAcknowledgement && !acknowledged)
              }
              onClick={onApply}
              type="button"
            >
              Confirm and update rows
            </Button>
          ) : (
            <Button
              disabled={
                jobBusy ||
                fieldConversionApplyDisabled(
                  preview,
                  acknowledged,
                  applying,
                )
              }
              onClick={onApply}
              type="button"
            >
              {jobBusy ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  {job?.phase === "applying"
                    ? "Updating rows…"
                    : job?.status === "cancelling"
                      ? "Unlocking column…"
                      : "Reviewing every row…"}
                </>
              ) : applying ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Starting column change…
                </>
              ) : preview ? (
                `Change to ${preview.newType}`
              ) : (
                "Preparing preview…"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConversionJobStatus({
  job,
}: {
  job: FieldConversionJobProgress
}) {
  const applying = job.phase === "applying"
  const completeCount = job.counts.appliedRows
  const totalCount = Math.max(job.counts.reviewedRows, 1)
  const progress = applying
    ? Math.min(100, (completeCount / totalCount) * 100)
    : 0
  const ready = job.status === "ready"
  const cancelling = job.status === "cancelling"

  return (
    <section
      aria-live="polite"
      className={
        job.status === "failed"
          ? "rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive"
          : "rounded-xl border bg-muted/20 p-4"
      }
      role={job.status === "failed" ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        {job.status === "failed" ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        ) : ready ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : (
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {job.status === "failed"
              ? "Column change paused"
              : ready
                ? "Every saved row is reviewed"
                : cancelling
                  ? "Unlocking the column"
              : applying
                ? "Updating reviewed rows"
                : "Reviewing every row"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {job.status === "failed"
              ? (job.failureMessage ??
                "Nothing new will be changed until you retry.")
              : ready
                ? `${job.counts.reviewedRows.toLocaleString()} saved rows were checked. Review the exact results below before updating the column.`
                : cancelling
                  ? "Removing the temporary review safely. Saved rows and the current column type stay unchanged."
              : applying
                ? `${job.counts.appliedRows.toLocaleString()} of ${job.counts.reviewedRows.toLocaleString()} rows updated safely.`
                : `${job.counts.reviewedRows.toLocaleString()} rows reviewed so far. The column keeps its current type until every row is ready.`}
          </p>
          {applying ? (
            <div
              aria-label={`${Math.round(progress)} percent complete`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progress)}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : job.status === "staging" || cancelling ? (
            <div
              aria-label={
                cancelling
                  ? "Unlocking column"
                  : "Reviewing saved rows"
              }
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
            >
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function PreviewCount({
  count,
  label,
  tone,
}: {
  count: number
  label: string
  tone: "safe" | "change" | "warning"
}) {
  return (
    <div
      className={
        tone === "warning"
          ? "rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
          : tone === "change"
            ? "rounded-xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900 dark:bg-blue-950/20"
            : "rounded-xl border bg-muted/20 p-3"
      }
    >
      <p className="text-xl font-semibold tabular-nums">
        {count.toLocaleString()}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function ConversionSettings({
  config,
  onChange,
  options,
  targetType,
}: {
  config: FieldConfig
  onChange: (config: FieldConfig) => void
  options: NonNullable<FieldConfig["options"]>
  targetType: ConvertibleFieldType
}) {
  if (targetType === "rating") {
    return (
      <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
        <div
          aria-label="Ratings use one to five stars"
          className="flex gap-0.5 text-amber-500"
          role="img"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <Star
              className="size-4 fill-current"
              key={index}
              strokeWidth={1.5}
            />
          ))}
        </div>
        <div>
          <p className="text-sm font-medium">One to five stars</p>
          <p className="text-xs text-muted-foreground">
            Ratings are saved as whole numbers.
          </p>
        </div>
      </div>
    )
  }

  if (targetType === "singleSelect" || targetType === "multiSelect") {
    return (
      <section
        aria-labelledby="conversion-choices-title"
        className="rounded-xl border p-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold" id="conversion-choices-title">
              Named choices
            </h3>
            <p className="text-xs text-muted-foreground">
              Existing values are matched to these names.
            </p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {options.length}/250
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {options.map((option, index) => (
            <div
              className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2"
              key={option.id}
            >
              <input
                aria-label={`Color for ${option.label || `choice ${index + 1}`}`}
                className="size-8 cursor-pointer rounded-md border bg-background p-1"
                onChange={(event) =>
                  onChange({
                    ...config,
                    options: options.map((candidate) =>
                      candidate.id === option.id
                        ? { ...candidate, color: event.target.value }
                        : candidate,
                    ),
                  })
                }
                type="color"
                value={option.color}
              />
              <Input
                aria-label={`Choice ${index + 1} name`}
                maxLength={120}
                onChange={(event) =>
                  onChange({
                    ...config,
                    options: options.map((candidate) =>
                      candidate.id === option.id
                        ? { ...candidate, label: event.target.value }
                        : candidate,
                    ),
                  })
                }
                placeholder={`Choice ${index + 1}`}
                value={option.label}
              />
              <Button
                aria-label={`Remove ${option.label || `choice ${index + 1}`}`}
                onClick={() =>
                  onChange({
                    ...config,
                    options: options.filter(
                      (candidate) => candidate.id !== option.id,
                    ),
                  })
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {options.length === 0 ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Add the choice names you want people to select.
            </p>
          ) : null}
        </div>
        <Button
          className="mt-3"
          disabled={options.length >= 250}
          onClick={() =>
            onChange({
              ...config,
              options: [
                ...options,
                {
                  id: `choice_${crypto.randomUUID()}`,
                  label: `Choice ${options.length + 1}`,
                  color: CHOICE_COLORS[options.length % CHOICE_COLORS.length]!,
                },
              ],
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          Add choice
        </Button>
      </section>
    )
  }

  if (textLengthLimit(targetType) !== undefined) {
    return (
      <div className="rounded-xl border p-3">
        <FieldValidationInputs
          config={config}
          idPrefix="conversion-text"
          onChange={onChange}
          type={targetType}
        />
      </div>
    )
  }

  if (
    targetType === "number" ||
    targetType === "currency" ||
    targetType === "percent"
  ) {
    return (
      <div className="grid gap-4 rounded-xl border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="conversion-decimal-places">Decimal places</Label>
            <Input
              id="conversion-decimal-places"
              max={12}
              min={0}
              onChange={(event) =>
                onChange({
                  ...config,
                  precision: Math.max(
                    0,
                    Math.min(12, Math.trunc(Number(event.target.value))),
                  ),
                })
              }
              type="number"
              value={config.precision ?? 0}
            />
          </div>
          {targetType === "currency" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="conversion-currency">Currency</Label>
              <CurrencySelect
                id="conversion-currency"
                onValueChange={(currency) =>
                  onChange({ ...config, currency })
                }
                value={config.currency ?? "USD"}
              />
            </div>
          ) : (
            <div className="self-end rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {targetType === "percent"
                ? "Values such as 75% will be saved as percentages."
                : "Only finite numeric values will be kept."}
            </div>
          )}
        </div>
        <FieldValidationInputs
          config={config}
          idPrefix="conversion-number"
          onChange={onChange}
          type={targetType}
        />
      </div>
    )
  }

  if (targetType === "date") {
    return (
      <div className="grid gap-1.5 rounded-xl border p-3">
        <Label htmlFor="conversion-date-style">Date input</Label>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          id="conversion-date-style"
          onChange={(event) =>
            onChange({
              ...config,
              dateStyle: event.target.value as "date" | "dateTime",
            })
          }
          value={config.dateStyle ?? "date"}
        >
          <option value="date">Date only</option>
          <option value="dateTime">Date and time</option>
        </select>
      </div>
    )
  }

  return null
}
