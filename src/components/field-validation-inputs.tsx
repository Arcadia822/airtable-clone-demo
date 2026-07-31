"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { FieldConfig, FieldType } from "@/lib/domain"
import {
  fieldConfigIssue,
  MAX_SAFE_NUMERIC_BOUND,
  optionalNumberInput,
  supportsNumericBounds,
  textLengthLimit,
} from "@/lib/field-config-validation"

export function FieldValidationInputs({
  config,
  idPrefix,
  onChange,
  type,
}: {
  config: FieldConfig
  idPrefix: string
  onChange: (config: FieldConfig) => void
  type: FieldType
}) {
  const maximumTextLength = textLengthLimit(type)
  const supportsNumbers = supportsNumericBounds(type)
  if (maximumTextLength === undefined && !supportsNumbers) return null

  const issue = fieldConfigIssue(type, config)
  const issueId = `${idPrefix}-validation-error`

  if (maximumTextLength !== undefined) {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-maximum-characters`}>
          Maximum characters
        </Label>
        <Input
          aria-describedby={issue ? issueId : undefined}
          aria-invalid={Boolean(issue)}
          id={`${idPrefix}-maximum-characters`}
          max={maximumTextLength}
          min={1}
          onChange={(event) =>
            onChange({
              ...config,
              maxLength: optionalNumberInput(event.target.value),
            })
          }
          placeholder={`Recommended: ${maximumTextLength.toLocaleString()}`}
          step={1}
          type="number"
          value={config.maxLength ?? ""}
        />
        {issue ? (
          <p className="text-xs text-destructive" id={issueId} role="alert">
            {issue}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Leave blank to use the recommended maximum of{" "}
            {maximumTextLength.toLocaleString()} characters.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-minimum`}>Minimum allowed</Label>
          <Input
            aria-describedby={issue ? issueId : undefined}
            aria-invalid={Boolean(issue)}
            id={`${idPrefix}-minimum`}
            max={MAX_SAFE_NUMERIC_BOUND}
            min={-MAX_SAFE_NUMERIC_BOUND}
            onChange={(event) =>
              onChange({
                ...config,
                min: optionalNumberInput(event.target.value),
              })
            }
            placeholder="No minimum"
            step="any"
            type="number"
            value={config.min ?? ""}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-maximum`}>Maximum allowed</Label>
          <Input
            aria-describedby={issue ? issueId : undefined}
            aria-invalid={Boolean(issue)}
            id={`${idPrefix}-maximum`}
            max={MAX_SAFE_NUMERIC_BOUND}
            min={-MAX_SAFE_NUMERIC_BOUND}
            onChange={(event) =>
              onChange({
                ...config,
                max: optionalNumberInput(event.target.value),
              })
            }
            placeholder="No maximum"
            step="any"
            type="number"
            value={config.max ?? ""}
          />
        </div>
      </div>
      {issue ? (
        <p className="text-xs text-destructive" id={issueId} role="alert">
          {issue}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Leave either limit blank when values do not need that boundary.
        </p>
      )}
    </div>
  )
}
