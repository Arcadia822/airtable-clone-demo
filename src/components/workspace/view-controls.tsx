"use client"

import { generateKeyBetween } from "jittered-fractional-indexing"
import {
  ArrowDown,
  ArrowUp,
  Filter,
  Group,
  ListFilter,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react"
import { useCallback, useMemo } from "react"
import type { ReactNode } from "react"

import { SearchableSelect } from "@/components/searchable-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import type { FieldConfig, FieldType } from "@/lib/domain"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import { compareRanks } from "@/lib/rank"
import { cn } from "@/lib/utils"

export type ViewFilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than"
  | "before"
  | "after"

export type ViewFilterValue = string | number | boolean | string[] | null

export type ViewFilterRule = {
  id: string
  fieldId: string
  operator: ViewFilterOperator
  value?: ViewFilterValue
}

export type ViewSortRule = {
  id: string
  fieldId: string
  direction: "asc" | "desc"
  rank: string
}

export type ViewGroupRule = {
  id: string
  fieldId: string
  direction: "asc" | "desc"
  rank: string
}

export type ViewControlsValue = {
  filterConjunction: "and" | "or"
  filters: ViewFilterRule[]
  sorts: ViewSortRule[]
  groups: ViewGroupRule[]
}

export type ViewControlsField = {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
}

const FILTER_OPERATOR_LABELS: Record<ViewFilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  does_not_contain: "doesn’t contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  greater_than: "is greater than",
  less_than: "is less than",
  before: "is before",
  after: "is after",
}

const EMPTY_OPERATORS = new Set<ViewFilterOperator>([
  "is_empty",
  "is_not_empty",
])

const MAX_FILTERS = 50
const MAX_SORTS = 10
const MAX_GROUPS = 3

type ChangeResult = boolean | void

export function ViewControls({
  className,
  disabled = false,
  fields,
  onChange,
  value,
}: {
  className?: string
  disabled?: boolean
  fields: ViewControlsField[]
  onChange: (
    nextValue: ViewControlsValue,
  ) => ChangeResult | Promise<ChangeResult>
  value: ViewControlsValue
}) {
  const normalizedValue = useMemo(() => normalizeViewValue(value), [value])

  const commit = useCallback(
    (nextValue: ViewControlsValue) => {
      const normalized = normalizeViewValue(nextValue)
      void Promise.resolve(onChange(normalized)).catch(() => undefined)
    },
    [onChange],
  )

  return (
    <div
      aria-label="View settings"
      className={cn("flex min-w-0 items-center gap-0.5", className)}
      role="group"
    >
      <FilterControl
        disabled={disabled}
        fields={fields}
        onChange={commit}
        value={normalizedValue}
      />
      <SortControl
        disabled={disabled}
        fields={fields}
        onChange={commit}
        value={normalizedValue}
      />
      <GroupControl
        disabled={disabled}
        fields={fields}
        onChange={commit}
        value={normalizedValue}
      />
    </div>
  )
}

function FilterControl({
  disabled,
  fields,
  onChange,
  value,
}: {
  disabled: boolean
  fields: ViewControlsField[]
  onChange: (next: ViewControlsValue) => void
  value: ViewControlsValue
}) {
  const fieldById = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields],
  )

  function addFilter() {
    const field = fields[0]
    if (!field || value.filters.length >= MAX_FILTERS) return
    const operator = defaultFilterOperator(field.type)
    onChange({
      ...value,
      filters: [
        ...value.filters,
        {
          id: createRuleId("filter"),
          fieldId: field.id,
          operator,
          ...(EMPTY_OPERATORS.has(operator)
            ? {}
            : { value: defaultFilterValue(field) }),
        },
      ],
    })
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={
              value.filters.length
                ? `Filter records, ${value.filters.length} active`
                : "Filter records"
            }
            disabled={disabled || fields.length === 0}
            size="sm"
            variant={value.filters.length ? "secondary" : "ghost"}
          />
        }
      >
        <ListFilter />
        <span className="hidden sm:inline">Filter</span>
        <RuleCount count={value.filters.length} />
      </PopoverTrigger>
      <RulePopoverContent
        description="Choose exactly which records belong in this view."
        title="Filter records"
      >
        {value.filters.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Show records when
            </span>
            <Select
              onValueChange={(conjunction) =>
                onChange({
                  ...value,
                  filterConjunction: conjunction as "and" | "or",
                })
              }
              value={value.filterConjunction}
            >
              <SelectTrigger
                aria-label="How filters should work together"
                className="h-7 w-auto min-w-40 bg-background"
                size="sm"
              >
                <span className="truncate">
                  {value.filterConjunction === "and"
                    ? "all conditions match"
                    : "any condition matches"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">all conditions match</SelectItem>
                <SelectItem value="or">any condition matches</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {value.filters.length ? (
          <div className="grid gap-2">
            {value.filters.map((filter, index) => {
              const field = fieldById.get(filter.fieldId) ?? fields[0]
              if (!field) return null
              const supportedOperators = filterOperatorsFor(field.type)
              return (
                <div
                  className="grid gap-3 rounded-xl border bg-background p-3 shadow-xs sm:grid-cols-[minmax(0,1.3fr)_minmax(9rem,0.9fr)_minmax(0,1.2fr)_auto] sm:items-end"
                  key={filter.id}
                >
                  <RuleFieldPicker
                    fieldId={field.id}
                    fields={fields}
                    id={`filter-column-${index}`}
                    label="Column"
                    onChange={(fieldId) => {
                      const nextField =
                        fieldById.get(fieldId) ??
                        fields.find((candidate) => candidate.id === fieldId)
                      if (!nextField) return
                      const operator = defaultFilterOperator(nextField.type)
                      replaceFilter(onChange, value, filter.id, {
                        ...filter,
                        fieldId: nextField.id,
                        operator,
                        ...(EMPTY_OPERATORS.has(operator)
                          ? { value: undefined }
                          : { value: defaultFilterValue(nextField) }),
                      })
                    }}
                  />
                  <div className="grid gap-1.5">
                    <Label htmlFor={`filter-condition-${index}`}>
                      Condition
                    </Label>
                    <Select
                      onValueChange={(operator) => {
                        const nextOperator =
                          operator as ViewFilterOperator
                        replaceFilter(onChange, value, filter.id, {
                          ...filter,
                          operator: nextOperator,
                          ...(EMPTY_OPERATORS.has(nextOperator)
                            ? { value: undefined }
                            : {
                                value:
                                  filter.value ??
                                  defaultFilterValue(field),
                              }),
                        })
                      }}
                      value={
                        supportedOperators.includes(filter.operator)
                          ? filter.operator
                          : defaultFilterOperator(field.type)
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-full bg-background"
                        id={`filter-condition-${index}`}
                      >
                        <span className="truncate">
                          {
                            FILTER_OPERATOR_LABELS[
                              supportedOperators.includes(filter.operator)
                                ? filter.operator
                                : defaultFilterOperator(field.type)
                            ]
                          }
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {supportedOperators.map((operator) => (
                          <SelectItem key={operator} value={operator}>
                            {FILTER_OPERATOR_LABELS[operator]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <FilterValueEditor
                    field={field}
                    filter={filter}
                    id={`filter-value-${index}`}
                    onChange={(nextValue) =>
                      replaceFilter(onChange, value, filter.id, {
                        ...filter,
                        value: nextValue,
                      })
                    }
                  />
                  <RuleActions
                    itemLabel={`filter on ${field.name}`}
                    onMoveDown={() =>
                      onChange({
                        ...value,
                        filters: moveItem(value.filters, index, index + 1),
                      })
                    }
                    onMoveUp={() =>
                      onChange({
                        ...value,
                        filters: moveItem(value.filters, index, index - 1),
                      })
                    }
                    onRemove={() =>
                      onChange({
                        ...value,
                        filters: value.filters.filter(
                          (candidate) => candidate.id !== filter.id,
                        ),
                      })
                    }
                    position={index}
                    total={value.filters.length}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyRules
            description="Add a condition to keep this view focused."
            icon={<Filter />}
            title="Every record is currently shown"
          />
        )}

        <RuleFooter
          addDisabled={
            disabled ||
            fields.length === 0 ||
            value.filters.length >= MAX_FILTERS
          }
          addLabel="Add condition"
          clearDisabled={disabled}
          clearLabel="Clear filters"
          hasRules={value.filters.length > 0}
          onAdd={addFilter}
          onClear={() => onChange({ ...value, filters: [] })}
        />
      </RulePopoverContent>
    </Popover>
  )
}

function SortControl({
  disabled,
  fields,
  onChange,
  value,
}: {
  disabled: boolean
  fields: ViewControlsField[]
  onChange: (next: ViewControlsValue) => void
  value: ViewControlsValue
}) {
  const fieldById = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields],
  )
  const firstUnusedField = fields.find(
    (field) => !value.sorts.some((sort) => sort.fieldId === field.id),
  )

  function addSort() {
    if (!firstUnusedField || value.sorts.length >= MAX_SORTS) return
    onChange({
      ...value,
      sorts: [
        ...value.sorts,
        {
          id: createRuleId("sort"),
          fieldId: firstUnusedField.id,
          direction: "asc",
          rank: nextRank(value.sorts),
        },
      ],
    })
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={
              value.sorts.length
                ? `Sort records, ${value.sorts.length} active`
                : "Sort records"
            }
            disabled={disabled || fields.length === 0}
            size="sm"
            variant={value.sorts.length ? "secondary" : "ghost"}
          />
        }
      >
        <SlidersHorizontal />
        <span className="hidden sm:inline">Sort</span>
        <RuleCount count={value.sorts.length} />
      </PopoverTrigger>
      <RulePopoverContent
        description="The first rule is applied first. Use the arrows to set priority."
        title="Sort records"
      >
        {value.sorts.length ? (
          <div className="grid gap-2">
            {value.sorts.map((sort, index) => {
              const field = fieldById.get(sort.fieldId) ?? fields[0]
              if (!field) return null
              const availableFields = fields.filter(
                (candidate) =>
                  candidate.id === sort.fieldId ||
                  !value.sorts.some(
                    (other) => other.fieldId === candidate.id,
                  ),
              )
              const directions = directionOptions(field.type)
              return (
                <div
                  className="grid gap-3 rounded-xl border bg-background p-3 shadow-xs sm:grid-cols-[minmax(0,1.35fr)_minmax(10rem,1fr)_auto] sm:items-end"
                  key={sort.id}
                >
                  <RuleFieldPicker
                    fieldId={field.id}
                    fields={availableFields}
                    id={`sort-column-${index}`}
                    label={index === 0 ? "Sort first by" : "Then by"}
                    onChange={(fieldId) =>
                      replaceSort(onChange, value, sort.id, {
                        ...sort,
                        fieldId,
                      })
                    }
                  />
                  <div className="grid gap-1.5">
                    <Label htmlFor={`sort-direction-${index}`}>
                      Direction
                    </Label>
                    <Select
                      onValueChange={(direction) =>
                        replaceSort(onChange, value, sort.id, {
                          ...sort,
                          direction: direction as "asc" | "desc",
                        })
                      }
                      value={sort.direction}
                    >
                      <SelectTrigger
                        className="h-8 w-full bg-background"
                        id={`sort-direction-${index}`}
                      >
                        <span className="truncate">
                          {
                            directions.find(
                              (direction) =>
                                direction.value === sort.direction,
                            )?.label
                          }
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {directions.map((direction) => (
                          <SelectItem
                            key={direction.value}
                            value={direction.value}
                          >
                            {direction.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <RuleActions
                    itemLabel={`sort on ${field.name}`}
                    onMoveDown={() =>
                      onChange({
                        ...value,
                        sorts: rerank(
                          moveItem(value.sorts, index, index + 1),
                        ),
                      })
                    }
                    onMoveUp={() =>
                      onChange({
                        ...value,
                        sorts: rerank(
                          moveItem(value.sorts, index, index - 1),
                        ),
                      })
                    }
                    onRemove={() =>
                      onChange({
                        ...value,
                        sorts: rerank(
                          value.sorts.filter(
                            (candidate) => candidate.id !== sort.id,
                          ),
                        ),
                      })
                    }
                    position={index}
                    total={value.sorts.length}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyRules
            description="Add a rule to arrange records in a predictable order."
            icon={<SlidersHorizontal />}
            title="Records keep their manual order"
          />
        )}
        <RuleFooter
          addDisabled={
            disabled ||
            !firstUnusedField ||
            value.sorts.length >= MAX_SORTS
          }
          addLabel="Add sort"
          clearDisabled={disabled}
          clearLabel="Clear sorting"
          hasRules={value.sorts.length > 0}
          onAdd={addSort}
          onClear={() => onChange({ ...value, sorts: [] })}
        />
      </RulePopoverContent>
    </Popover>
  )
}

function GroupControl({
  disabled,
  fields,
  onChange,
  value,
}: {
  disabled: boolean
  fields: ViewControlsField[]
  onChange: (next: ViewControlsValue) => void
  value: ViewControlsValue
}) {
  const fieldById = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields],
  )
  const firstUnusedField = fields.find(
    (field) => !value.groups.some((group) => group.fieldId === field.id),
  )

  function addGroup() {
    if (!firstUnusedField || value.groups.length >= MAX_GROUPS) return
    onChange({
      ...value,
      groups: [
        ...value.groups,
        {
          id: createRuleId("group"),
          fieldId: firstUnusedField.id,
          direction: "asc",
          rank: nextRank(value.groups),
        },
      ],
    })
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={
              value.groups.length
                ? `Group records, ${value.groups.length} active`
                : "Group records"
            }
            disabled={disabled || fields.length === 0}
            size="sm"
            variant={value.groups.length ? "secondary" : "ghost"}
          />
        }
      >
        <Group />
        <span className="hidden sm:inline">Group</span>
        <RuleCount count={value.groups.length} />
      </PopoverTrigger>
      <RulePopoverContent
        description="Create clear sections without changing any record data."
        title="Group records"
      >
        {value.groups.length ? (
          <div className="grid gap-2">
            {value.groups.map((group, index) => {
              const field = fieldById.get(group.fieldId) ?? fields[0]
              if (!field) return null
              const availableFields = fields.filter(
                (candidate) =>
                  candidate.id === group.fieldId ||
                  !value.groups.some(
                    (other) => other.fieldId === candidate.id,
                  ),
              )
              const directions = directionOptions(field.type)
              return (
                <div
                  className="grid gap-3 rounded-xl border bg-background p-3 shadow-xs sm:grid-cols-[minmax(0,1.35fr)_minmax(10rem,1fr)_auto] sm:items-end"
                  key={group.id}
                >
                  <RuleFieldPicker
                    fieldId={field.id}
                    fields={availableFields}
                    id={`group-column-${index}`}
                    label={index === 0 ? "Group first by" : "Then by"}
                    onChange={(fieldId) =>
                      replaceGroup(onChange, value, group.id, {
                        ...group,
                        fieldId,
                      })
                    }
                  />
                  <div className="grid gap-1.5">
                    <Label htmlFor={`group-direction-${index}`}>
                      Section order
                    </Label>
                    <Select
                      onValueChange={(direction) =>
                        replaceGroup(onChange, value, group.id, {
                          ...group,
                          direction: direction as "asc" | "desc",
                        })
                      }
                      value={group.direction}
                    >
                      <SelectTrigger
                        className="h-8 w-full bg-background"
                        id={`group-direction-${index}`}
                      >
                        <span className="truncate">
                          {
                            directions.find(
                              (direction) =>
                                direction.value === group.direction,
                            )?.label
                          }
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {directions.map((direction) => (
                          <SelectItem
                            key={direction.value}
                            value={direction.value}
                          >
                            {direction.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <RuleActions
                    itemLabel={`group on ${field.name}`}
                    onMoveDown={() =>
                      onChange({
                        ...value,
                        groups: rerank(
                          moveItem(value.groups, index, index + 1),
                        ),
                      })
                    }
                    onMoveUp={() =>
                      onChange({
                        ...value,
                        groups: rerank(
                          moveItem(value.groups, index, index - 1),
                        ),
                      })
                    }
                    onRemove={() =>
                      onChange({
                        ...value,
                        groups: rerank(
                          value.groups.filter(
                            (candidate) => candidate.id !== group.id,
                          ),
                        ),
                      })
                    }
                    position={index}
                    total={value.groups.length}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyRules
            description="Pick a column to split records into scannable sections."
            icon={<Group />}
            title="This view has no sections"
          />
        )}
        <RuleFooter
          addDisabled={
            disabled ||
            !firstUnusedField ||
            value.groups.length >= MAX_GROUPS
          }
          addLabel="Add grouping"
          clearDisabled={disabled}
          clearLabel="Clear grouping"
          hasRules={value.groups.length > 0}
          onAdd={addGroup}
          onClear={() => onChange({ ...value, groups: [] })}
        />
      </RulePopoverContent>
    </Popover>
  )
}

function RuleFieldPicker({
  fieldId,
  fields,
  id,
  label,
  onChange,
}: {
  fieldId: string
  fields: ViewControlsField[]
  id: string
  label: string
  onChange: (fieldId: string) => void
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <SearchableSelect
        className="h-8"
        emptyMessage="No columns match."
        id={id}
        onValueChange={onChange}
        options={fields.map((field) => ({
          value: field.id,
          label: field.name,
          description: getFieldTypeLabel(field.type),
        }))}
        placeholder="Choose a column"
        searchPlaceholder="Search columns…"
        value={fieldId}
      />
    </div>
  )
}

function FilterValueEditor({
  field,
  filter,
  id,
  onChange,
}: {
  field: ViewControlsField
  filter: ViewFilterRule
  id: string
  onChange: (value: ViewFilterValue) => void
}) {
  if (EMPTY_OPERATORS.has(filter.operator)) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Value</span>
        <div className="flex h-8 items-center rounded-lg border border-dashed px-2.5 text-xs text-muted-foreground">
          No value needed
        </div>
      </div>
    )
  }

  if (field.type === "checkbox") {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Value</Label>
        <Select
          onValueChange={(value) => onChange(value === "checked")}
          value={filter.value === false ? "unchecked" : "checked"}
        >
          <SelectTrigger className="h-8 w-full bg-background" id={id}>
            <span className="truncate">
              {filter.value === false ? "No" : "Yes"}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="checked">Yes</SelectItem>
            <SelectItem value="unchecked">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const options = field.config.options ?? []
    const selectedValue =
      typeof filter.value === "string"
        ? filter.value
        : Array.isArray(filter.value)
          ? filter.value[0] ?? ""
          : ""
    return (
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={id}>Choice</Label>
        <SearchableSelect
          className="h-8"
          disabled={options.length === 0}
          emptyMessage="No choices match."
          id={id}
          onValueChange={onChange}
          options={options.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
          placeholder={
            options.length ? "Choose an option" : "No choices available"
          }
          searchPlaceholder="Search choices…"
          value={selectedValue}
        />
      </div>
    )
  }

  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Value</Label>
        <Input
          id={id}
          inputMode="decimal"
          onChange={(event) => {
            const nextValue = event.target.valueAsNumber
            onChange(Number.isFinite(nextValue) ? nextValue : 0)
          }}
          placeholder="Enter a number"
          step="any"
          type="number"
          value={typeof filter.value === "number" ? filter.value : 0}
        />
      </div>
    )
  }

  if (field.type === "date" || field.type === "createdTime") {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Date</Label>
        <Input
          id={id}
          onChange={(event) => onChange(event.target.value)}
          type="date"
          value={dateInputValue(filter.value)}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Value</Label>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Enter ${field.name.toLowerCase()}`}
        value={textInputValue(filter.value)}
      />
    </div>
  )
}

function RuleActions({
  itemLabel,
  onMoveDown,
  onMoveUp,
  onRemove,
  position,
  total,
}: {
  itemLabel: string
  onMoveDown: () => void
  onMoveUp: () => void
  onRemove: () => void
  position: number
  total: number
}) {
  return (
    <div
      aria-label={`Actions for ${itemLabel}`}
      className="flex items-center justify-end gap-0.5 sm:pb-0.5"
      role="group"
    >
      <Button
        aria-label={`Move ${itemLabel} up`}
        disabled={position === 0}
        onClick={onMoveUp}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={`Move ${itemLabel} down`}
        disabled={position === total - 1}
        onClick={onMoveDown}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={`Remove ${itemLabel}`}
        onClick={onRemove}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function RulePopoverContent({
  children,
  description,
  title,
}: {
  children: ReactNode
  description: string
  title: string
}) {
  return (
    <PopoverContent
      align="start"
      className="max-h-[min(72dvh,44rem)] w-[min(44rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
      sideOffset={6}
    >
      <PopoverHeader className="border-b px-1 pb-3">
        <PopoverTitle className="flex items-center gap-2">
          {title}
        </PopoverTitle>
        <PopoverDescription>{description}</PopoverDescription>
      </PopoverHeader>
      {children}
    </PopoverContent>
  )
}

function RuleCount({ count }: { count: number }) {
  return count ? (
    <Badge
      aria-label={`${count} active`}
      className="h-4 min-w-4 bg-foreground/10 px-1 text-[10px] text-foreground"
      variant="secondary"
    >
      {count}
    </Badge>
  ) : null
}

function EmptyRules({
  description,
  icon,
  title,
}: {
  description: string
  icon: ReactNode
  title: string
}) {
  return (
    <div className="grid min-h-32 place-items-center rounded-xl border border-dashed bg-muted/15 px-6 py-5 text-center">
      <div>
        <span className="mx-auto mb-2 grid size-8 place-items-center rounded-lg border bg-background text-muted-foreground shadow-xs [&_svg]:size-4">
          {icon}
        </span>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function RuleFooter({
  addDisabled,
  addLabel,
  clearDisabled,
  clearLabel,
  hasRules,
  onAdd,
  onClear,
}: {
  addDisabled: boolean
  addLabel: string
  clearDisabled: boolean
  clearLabel: string
  hasRules: boolean
  onAdd: () => void
  onClear: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        className="w-fit"
        disabled={addDisabled}
        onClick={onAdd}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus />
        {addLabel}
      </Button>
      {hasRules ? (
        <Button
          disabled={clearDisabled}
          onClick={onClear}
          size="sm"
          type="button"
          variant="ghost"
        >
          {clearLabel}
        </Button>
      ) : null}
    </div>
  )
}

function replaceFilter(
  onChange: (next: ViewControlsValue) => void,
  value: ViewControlsValue,
  filterId: string,
  nextFilter: ViewFilterRule,
) {
  onChange({
    ...value,
    filters: value.filters.map((filter) =>
      filter.id === filterId ? nextFilter : filter,
    ),
  })
}

function replaceSort(
  onChange: (next: ViewControlsValue) => void,
  value: ViewControlsValue,
  sortId: string,
  nextSort: ViewSortRule,
) {
  onChange({
    ...value,
    sorts: value.sorts.map((sort) =>
      sort.id === sortId ? nextSort : sort,
    ),
  })
}

function replaceGroup(
  onChange: (next: ViewControlsValue) => void,
  value: ViewControlsValue,
  groupId: string,
  nextGroup: ViewGroupRule,
) {
  onChange({
    ...value,
    groups: value.groups.map((group) =>
      group.id === groupId ? nextGroup : group,
    ),
  })
}

function filterOperatorsFor(type: FieldType): ViewFilterOperator[] {
  if (type === "attachment") return ["is_empty", "is_not_empty"]
  if (type === "checkbox") {
    return ["is", "is_not", "is_empty", "is_not_empty"]
  }
  if (type === "date" || type === "createdTime") {
    return ["is", "before", "after", "is_empty", "is_not_empty"]
  }
  if (
    type === "number" ||
    type === "currency" ||
    type === "percent" ||
    type === "rating"
  ) {
    return [
      "is",
      "is_not",
      "greater_than",
      "less_than",
      "is_empty",
      "is_not_empty",
    ]
  }
  return [
    "is",
    "is_not",
    "contains",
    "does_not_contain",
    "is_empty",
    "is_not_empty",
  ]
}

function defaultFilterOperator(type: FieldType): ViewFilterOperator {
  return type === "attachment" ? "is_not_empty" : "is"
}

function defaultFilterValue(field: ViewControlsField): ViewFilterValue {
  if (field.type === "checkbox") return true
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    return 0
  }
  if (field.type === "date" || field.type === "createdTime") {
    return new Date().toISOString().slice(0, 10)
  }
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    return field.config.options?.[0]?.id ?? ""
  }
  return ""
}

function directionOptions(type: FieldType) {
  if (type === "date" || type === "createdTime") {
    return [
      { value: "asc" as const, label: "Oldest → newest" },
      { value: "desc" as const, label: "Newest → oldest" },
    ]
  }
  if (
    type === "number" ||
    type === "currency" ||
    type === "percent" ||
    type === "rating"
  ) {
    return [
      { value: "asc" as const, label: "Low → high" },
      { value: "desc" as const, label: "High → low" },
    ]
  }
  if (type === "checkbox") {
    return [
      { value: "asc" as const, label: "Not checked first" },
      { value: "desc" as const, label: "Checked first" },
    ]
  }
  if (type === "attachment") {
    return [
      { value: "asc" as const, label: "Empty first" },
      { value: "desc" as const, label: "Files first" },
    ]
  }
  return [
    { value: "asc" as const, label: "A → Z" },
    { value: "desc" as const, label: "Z → A" },
  ]
}

function moveItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items]
  }
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

function rerank<T extends { rank: string }>(items: readonly T[]): T[] {
  let previousRank: string | null = null
  return items.map((item) => {
    const rank = generateKeyBetween(previousRank, null)
    previousRank = rank
    return { ...item, rank }
  })
}

function nextRank(items: ReadonlyArray<{ rank: string }>) {
  return generateKeyBetween(items.at(-1)?.rank ?? null, null)
}

function createRuleId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}_${suffix}`
}

function normalizeViewValue(value: ViewControlsValue): ViewControlsValue {
  return {
    filterConjunction: value.filterConjunction,
    filters: [...value.filters],
    sorts: [...value.sorts].sort(compareRanks),
    groups: [...value.groups].sort(compareRanks),
  }
}

function dateInputValue(value: ViewFilterValue | undefined) {
  if (typeof value === "number") {
    return new Date(value).toISOString().slice(0, 10)
  }
  if (typeof value !== "string") return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : date.toISOString().slice(0, 10)
}

function textInputValue(value: ViewFilterValue | undefined) {
  if (Array.isArray(value)) return value.join(", ")
  if (value === undefined || value === null) return ""
  return String(value)
}
