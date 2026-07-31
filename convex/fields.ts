import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { fieldCount } from "./lib/aggregates";
import { requireOrgAdmin, requireOrgIdentity } from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import { validateFieldConfiguration } from "./lib/cells";
import { createRank, requireField, requireTable } from "./lib/data";
import {
  activeFieldConversionJob,
  assertFieldConversionUnlocked,
} from "./lib/fieldConversionLocks";
import { assertBelowQuota, PLAN_LIMITS } from "./lib/quotas";
import {
  fieldConfigValidator,
  fieldTypeValidator,
} from "./lib/validators";
import { addFieldToActiveViews } from "./lib/viewData";
import { invalidateTableViewMaterializations } from "./lib/viewChanges";

const archiveDependencyCategoryValidator = v.union(
  v.literal("Draft form"),
  v.literal("Published form"),
  v.literal("Saved view"),
  v.literal("Saved analysis"),
);

const archiveDependencyValidator = v.object({
  category: archiveDependencyCategoryValidator,
  name: v.string(),
  effect: v.optional(v.string()),
});

const MAX_SAVED_VIEWS_PER_TABLE = 100;
const MAX_SAVED_ANALYSES_PER_ORG = 50;
const MAX_FORM_REFERENCES = PLAN_LIMITS.pro.fieldsPerTable;
const MAX_FIELD_CONVERSION_PREVIEW_RECORDS = 100;
const FIELD_CONVERSION_BATCH_SIZE = 50;
const MAX_FIELD_CONVERSION_EXAMPLES = 6;

const conversionExampleValidator = v.object({
  before: v.string(),
  after: v.string(),
  result: v.union(
    v.literal("Kept as-is"),
    v.literal("Will change"),
    v.literal("Will be cleared"),
  ),
  explanation: v.string(),
});

const conversionCountsValidator = v.object({
  reviewedRows: v.number(),
  filledCells: v.number(),
  keptAsIs: v.number(),
  changed: v.number(),
  cleared: v.number(),
  losingSomeInformation: v.number(),
});

const conversionPreviewValidator = v.object({
  columnName: v.string(),
  currentType: v.string(),
  newType: v.string(),
  expectedFieldRevision: v.number(),
  previewVersion: v.string(),
  canApply: v.boolean(),
  blockingReason: v.union(v.string(), v.null()),
  requiresDataLossAcknowledgement: v.boolean(),
  counts: conversionCountsValidator,
  examples: v.array(conversionExampleValidator),
  dependencies: v.array(archiveDependencyValidator),
  warnings: v.array(v.string()),
});

const conversionApplyResultValidator = v.object({
  columnName: v.string(),
  previousType: v.string(),
  newType: v.string(),
  fieldRevision: v.number(),
  rowsUpdated: v.number(),
  cellsCleared: v.number(),
  cellsChanged: v.number(),
});

const conversionJobStatusValidator = v.union(
  v.literal("staging"),
  v.literal("ready"),
  v.literal("applying"),
  v.literal("failed"),
  v.literal("cancelling"),
  v.literal("cancelled"),
  v.literal("completed"),
);

const conversionJobPhaseValidator = v.union(
  v.literal("staging"),
  v.literal("applying"),
);

const conversionJobCountsValidator = conversionCountsValidator.extend({
  appliedRows: v.number(),
  rowsUpdated: v.number(),
});

const conversionJobProgressValidator = v.object({
  jobId: v.id("fieldConversionJobs"),
  fieldId: v.id("fields"),
  columnName: v.string(),
  targetType: fieldTypeValidator,
  targetConfig: fieldConfigValidator,
  status: conversionJobStatusValidator,
  phase: conversionJobPhaseValidator,
  counts: conversionJobCountsValidator,
  failureMessage: v.union(v.string(), v.null()),
});

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type ArchiveDependency = {
  category: "Draft form" | "Published form" | "Saved view" | "Saved analysis";
  name: string;
  effect?: string;
};
type FieldType = Doc<"fields">["type"];
type FieldConfig = Doc<"fields">["config"];
type CellValue = Doc<"records">["values"][Id<"fields">];
type ConversionResult = {
  value?: CellValue;
  cleared: boolean;
  lossy: boolean;
  explanation: string;
};
type ConversionPlan = {
  record: Doc<"records">;
  result: ConversionResult;
  outcome: "Kept as-is" | "Will change" | "Will be cleared";
  before: string;
  after: string;
};

const CONVERTIBLE_FIELD_TYPES = new Set<FieldType>([
  "singleLineText",
  "longText",
  "number",
  "currency",
  "percent",
  "rating",
  "checkbox",
  "date",
  "email",
  "phone",
  "url",
  "singleSelect",
  "multiSelect",
]);

const FIELD_TYPE_LABELS = {
  singleLineText: "Short text",
  longText: "Long text",
  number: "Number",
  currency: "Currency",
  percent: "Percentage",
  rating: "Rating",
  checkbox: "Checkbox",
  date: "Date",
  email: "Email address",
  phone: "Phone number",
  url: "Web link",
  singleSelect: "Single choice",
  multiSelect: "Multiple choice",
  attachment: "File or image",
  createdTime: "Created time",
  createdBy: "Created by",
} satisfies Record<FieldType, string>;

function fieldTypeLabel(type: FieldType): string {
  return FIELD_TYPE_LABELS[type];
}

function isConvertibleFieldType(type: FieldType): boolean {
  return CONVERTIBLE_FIELD_TYPES.has(type);
}

function normalizeConversionConfig(
  source: Doc<"fields">,
  targetType: FieldType,
  requested: FieldConfig | undefined,
): FieldConfig {
  const supplied = requested ?? {};
  if (targetType === "singleSelect" || targetType === "multiSelect") {
    const options =
      supplied.options ??
      (source.type === "singleSelect" || source.type === "multiSelect"
        ? source.config.options
        : undefined) ??
      [];
    return { options };
  }
  if (
    targetType === "number" ||
    targetType === "currency" ||
    targetType === "percent" ||
    targetType === "rating"
  ) {
    const config: FieldConfig = {
      precision:
        targetType === "rating"
          ? 0
          : (supplied.precision ?? source.config.precision ?? 0),
    };
    const minimum =
      targetType === "rating" ? 1 : supplied.min;
    const maximum =
      targetType === "rating" ? 5 : supplied.max;
    if (minimum !== undefined) config.min = minimum;
    if (maximum !== undefined) config.max = maximum;
    if (targetType === "currency") {
      config.currency =
        supplied.currency ?? source.config.currency ?? "USD";
    }
    return config;
  }
  if (targetType === "date") {
    return {
      dateStyle: supplied.dateStyle ?? source.config.dateStyle ?? "date",
      includeTime:
        supplied.includeTime ?? source.config.includeTime ?? false,
    };
  }
  if (
    targetType === "singleLineText" ||
    targetType === "longText" ||
    targetType === "email" ||
    targetType === "phone" ||
    targetType === "url"
  ) {
    return {
      maxLength:
        supplied.maxLength ??
        (targetType === "longText"
          ? 100_000
          : targetType === "email"
            ? 320
            : targetType === "url"
              ? 2_048
              : targetType === "phone"
                ? 64
                : 10_000),
    };
  }
  return {};
}

function activeOptions(config: FieldConfig) {
  return (config.options ?? []).filter((option) => !option.archived);
}

function optionLabels(
  field: Pick<Doc<"fields">, "type" | "config">,
  value: CellValue,
): { labels: string[]; unavailableChoices: number } {
  if (field.type !== "singleSelect" && field.type !== "multiSelect") {
    return { labels: [], unavailableChoices: 0 };
  }
  const labelsById = new Map(
    activeOptions(field.config).map((option) => [option.id, option.label]),
  );
  const ids =
    field.type === "multiSelect" && Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : [];
  const labels = ids.flatMap((id) => {
    const label = labelsById.get(id);
    return label === undefined ? [] : [label];
  });
  return {
    labels,
    unavailableChoices: Math.max(0, ids.length - labels.length),
  };
}

function sourceText(field: Doc<"fields">, value: CellValue): {
  text?: string;
  lossy: boolean;
  explanation?: string;
} {
  if (
    field.type === "attachment" ||
    field.type === "createdBy" ||
    field.type === "createdTime"
  ) {
    return {
      lossy: true,
      explanation: `${fieldTypeLabel(field.type)} values are managed automatically.`,
    };
  }
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const choices = optionLabels(field, value);
    if (choices.labels.length === 0) {
      return {
        lossy: choices.unavailableChoices > 0,
        explanation:
          choices.unavailableChoices > 0
            ? "The saved choice is no longer available."
            : undefined,
      };
    }
    return {
      text: choices.labels.join(", "),
      lossy: choices.unavailableChoices > 0,
      explanation:
        choices.unavailableChoices > 0
          ? "Unavailable choices will be left out."
          : undefined,
    };
  }
  if (field.type === "checkbox" && typeof value === "boolean") {
    return { text: value ? "Yes" : "No", lossy: false };
  }
  if (field.type === "date") {
    const timestamp =
      typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(timestamp)) {
      return {
        lossy: true,
        explanation: "The saved date is not valid.",
      };
    }
    return {
      text: new Date(timestamp).toISOString(),
      lossy: false,
    };
  }
  if (field.type === "percent" && typeof value === "number") {
    return { text: `${value * 100}%`, lossy: false };
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { text: String(value), lossy: false };
  }
  return {
    lossy: true,
    explanation: "This value cannot be represented as text.",
  };
}

function displayValue(
  field: Pick<Doc<"fields">, "type" | "config">,
  value: CellValue | undefined,
): string {
  if (value === undefined) return "Empty";
  if (field.type === "attachment") {
    return Array.isArray(value)
      ? `${value.length} ${value.length === 1 ? "file" : "files"}`
      : "Saved file";
  }
  if (field.type === "createdBy") return "Saved creator";
  if (field.type === "createdTime") {
    const timestamp =
      typeof value === "number" ? value : Date.parse(String(value));
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : "Saved creation time";
  }
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const choices = optionLabels(field, value);
    if (choices.labels.length === 0) return "Unavailable choice";
    return choices.labels.join(", ");
  }
  if (field.type === "checkbox" && typeof value === "boolean") {
    return value ? "Checked" : "Not checked";
  }
  if (field.type === "percent" && typeof value === "number") {
    return `${value * 100}%`;
  }
  if (field.type === "date") {
    const timestamp =
      typeof value === "number" ? value : Date.parse(String(value));
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : "Invalid date";
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function parsedNumber(text: string): number | undefined {
  const normalized = text
    .trim()
    .replaceAll(",", "")
    .replace(/^[^\d+\-.]+/, "")
    .replace(/[^\d.%-]+$/, "");
  const withoutPercent = normalized.replace(/%$/, "");
  if (!withoutPercent.trim()) return undefined;
  const result = Number(withoutPercent);
  return Number.isFinite(result) ? result : undefined;
}

function valuesMatch(left: CellValue, right: CellValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function convertCellValue(
  source: Doc<"fields">,
  targetType: FieldType,
  targetConfig: FieldConfig,
  value: CellValue,
): ConversionResult {
  const text = sourceText(source, value);
  const clear = (explanation: string): ConversionResult => ({
    cleared: true,
    lossy: true,
    explanation,
  });
  const converted = (
    nextValue: CellValue,
    explanation: string,
    lossy = false,
  ): ConversionResult => ({
    value: nextValue,
    cleared: false,
    lossy: lossy || text.lossy,
    explanation: text.explanation ?? explanation,
  });

  if (targetType === "singleLineText" || targetType === "longText") {
    if (text.text === undefined) {
      return clear(text.explanation ?? "This value cannot become text.");
    }
    const defaultMax = targetType === "longText" ? 100_000 : 10_000;
    const maxLength = Math.min(
      targetConfig.maxLength ?? defaultMax,
      defaultMax,
    );
    if (text.text.length > maxLength) {
      return converted(
        text.text.slice(0, maxLength),
        `Text longer than ${maxLength} characters will be shortened.`,
        true,
      );
    }
    return converted(text.text, "The value converts cleanly.");
  }

  if (
    targetType === "email" ||
    targetType === "phone" ||
    targetType === "url"
  ) {
    const candidate = text.text?.trim();
    if (candidate === undefined) {
      return clear(text.explanation ?? "This value cannot become text.");
    }
    const maximum =
      targetType === "email" ? 320 : targetType === "url" ? 2_048 : 64;
    const maxLength = Math.min(
      targetConfig.maxLength ?? maximum,
      maximum,
    );
    if (!candidate || candidate.length > maxLength) {
      return clear(`This value is not a valid ${fieldTypeLabel(targetType).toLowerCase()}.`);
    }
    if (
      targetType === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
    ) {
      return clear("This value is not a valid email address.");
    }
    if (targetType === "url") {
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return clear("Only HTTP and HTTPS web links can be kept.");
        }
      } catch {
        return clear("This value is not a valid web link.");
      }
    }
    return converted(candidate, "The value converts cleanly.");
  }

  if (
    targetType === "number" ||
    targetType === "currency" ||
    targetType === "percent" ||
    targetType === "rating"
  ) {
    let numberValue: number | undefined;
    if (typeof value === "number") {
      numberValue = value;
    } else if (typeof value === "boolean") {
      numberValue = value ? 1 : 0;
    } else if (text.text !== undefined) {
      numberValue = parsedNumber(text.text);
    }
    if (numberValue === undefined) {
      return clear(
        `This value is not a valid ${fieldTypeLabel(targetType).toLowerCase()}.`,
      );
    }
    let lossy = text.lossy;
    let explanation = "The value converts cleanly.";
    if (
      targetType === "percent" &&
      source.type !== "percent" &&
      (text.text?.trim().endsWith("%") || Math.abs(numberValue) > 1)
    ) {
      numberValue /= 100;
      explanation = "The value will be stored as a percentage.";
    }
    if (targetType === "rating" && !Number.isInteger(numberValue)) {
      numberValue = Math.round(numberValue);
      lossy = true;
      explanation = "The rating will be rounded to a whole number.";
    }
    if (
      !Number.isFinite(numberValue) ||
      (targetType === "rating" &&
        (numberValue < 1 || numberValue > 5)) ||
      (targetConfig.min !== undefined &&
        numberValue < targetConfig.min) ||
      (targetConfig.max !== undefined && numberValue > targetConfig.max)
    ) {
      return clear(
        targetType === "rating"
          ? "Ratings must be whole numbers from 1 to 5."
          : "This number falls outside the column's allowed range.",
      );
    }
    return converted(numberValue, explanation, lossy);
  }

  if (targetType === "checkbox") {
    if (typeof value === "boolean") {
      return converted(value, "The value converts cleanly.");
    }
    const normalized = text.text?.trim().toLocaleLowerCase();
    if (
      normalized &&
      ["true", "checked", "yes", "y", "1", "x", "✓", "on"].includes(
        normalized,
      )
    ) {
      return converted(true, "The value will become checked.");
    }
    if (
      normalized !== undefined &&
      ["false", "unchecked", "no", "n", "0", "", "off"].includes(
        normalized,
      )
    ) {
      return converted(false, "The value will become unchecked.");
    }
    return clear("This value does not clearly mean checked or unchecked.");
  }

  if (targetType === "date") {
    const timestamp =
      typeof value === "number"
        ? value
        : text.text === undefined
          ? Number.NaN
          : Date.parse(text.text);
    if (!Number.isFinite(timestamp)) {
      return clear("This value is not a recognizable date.");
    }
    return converted(timestamp, "The value converts cleanly.");
  }

  if (targetType === "singleSelect" || targetType === "multiSelect") {
    const options = activeOptions(targetConfig);
    const optionByLabel = new Map(
      options.map((option) => [
        option.label.trim().toLocaleLowerCase(),
        option,
      ]),
    );
    let candidates: string[] = [];
    let sourceHadUnavailableChoices = false;
    if (source.type === "singleSelect" || source.type === "multiSelect") {
      const choices = optionLabels(source, value);
      candidates = choices.labels;
      sourceHadUnavailableChoices = choices.unavailableChoices > 0;
    } else if (text.text !== undefined) {
      const exact = optionByLabel.get(
        text.text.trim().toLocaleLowerCase(),
      );
      candidates = exact
        ? [exact.label]
        : text.text.split(",").map((part) => part.trim()).filter(Boolean);
    }
    const matched = candidates.flatMap((candidate) => {
      const option = optionByLabel.get(
        candidate.trim().toLocaleLowerCase(),
      );
      return option === undefined ? [] : [option];
    });
    const uniqueMatched = [
      ...new Map(matched.map((option) => [option.id, option])).values(),
    ];
    const lostChoices =
      sourceHadUnavailableChoices ||
      uniqueMatched.length < candidates.length;
    if (uniqueMatched.length === 0) {
      return clear(
        options.length === 0
          ? "Add named choices before converting this column."
          : "This value does not match any of the new choices.",
      );
    }
    if (targetType === "singleSelect") {
      return converted(
        uniqueMatched[0].id,
        uniqueMatched.length > 1 || lostChoices
          ? "Only the first matching choice will be kept."
          : "The value matches a named choice.",
        uniqueMatched.length > 1 || lostChoices,
      );
    }
    return converted(
      uniqueMatched.map((option) => option.id),
      lostChoices
        ? "Choices without a match will be left out."
        : "The value matches the named choices.",
      lostChoices,
    );
  }

  return clear("This column type cannot be converted automatically.");
}

async function hashConversionPreview(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function loadConversionRecords(
  ctx: ReadCtx,
  field: Doc<"fields">,
): Promise<{ records: Doc<"records">[]; hasMore: boolean }> {
  const [active, archived] = await Promise.all([
    ctx.db
      .query("records")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", field.tableId).eq("status", "active"),
      )
      .take(MAX_FIELD_CONVERSION_PREVIEW_RECORDS + 1),
    ctx.db
      .query("records")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", field.tableId).eq("status", "deleted"),
      )
      .take(MAX_FIELD_CONVERSION_PREVIEW_RECORDS + 1),
  ]);
  const all = [...active, ...archived]
    .filter(
      (record) =>
        record.orgId === field.orgId &&
        record.baseId === field.baseId,
    )
    .sort((left, right) => left._id.localeCompare(right._id));
  return {
    records: all.slice(0, MAX_FIELD_CONVERSION_PREVIEW_RECORDS),
    hasMore: all.length > MAX_FIELD_CONVERSION_PREVIEW_RECORDS,
  };
}

async function buildConversionPreview(
  ctx: ReadCtx,
  field: Doc<"fields">,
  targetType: FieldType,
  requestedConfig: FieldConfig | undefined,
) {
  const targetConfig = normalizeConversionConfig(
    field,
    targetType,
    requestedConfig,
  );
  validateFieldConfiguration(targetType, targetConfig);
  const [{ records, hasMore }, dependencies] = await Promise.all([
    loadConversionRecords(ctx, field),
    getScopedArchiveDependencies(ctx, field),
  ]);
  const targetField = { type: targetType, config: targetConfig };
  const plans: ConversionPlan[] = [];
  for (const record of records) {
    if (!(field._id in record.values)) continue;
    const original = record.values[field._id];
    const result = convertCellValue(
      field,
      targetType,
      targetConfig,
      original,
    );
    const outcome = result.cleared
      ? "Will be cleared"
      : result.value !== undefined && valuesMatch(original, result.value)
        ? "Kept as-is"
        : "Will change";
    plans.push({
      record,
      result,
      outcome,
      before: displayValue(field, original),
      after: displayValue(targetField, result.value),
    });
  }

  const counts = {
    reviewedRows: records.length,
    filledCells: plans.length,
    keptAsIs: plans.filter((plan) => plan.outcome === "Kept as-is").length,
    changed: plans.filter((plan) => plan.outcome === "Will change").length,
    cleared: plans.filter((plan) => plan.outcome === "Will be cleared")
      .length,
    losingSomeInformation: plans.filter(
      (plan) => plan.result.lossy && !plan.result.cleared,
    ).length,
  };
  const publishedForms = dependencies.dependencies.filter(
    (dependency) => dependency.category === "Published form",
  );
  let blockingReason: string | null = null;
  if (field.status !== "active") {
    blockingReason = "Restore this column before changing its type.";
  } else if (!isConvertibleFieldType(field.type)) {
    blockingReason = `${fieldTypeLabel(field.type)} columns cannot be converted automatically.`;
  } else if (!isConvertibleFieldType(targetType)) {
    blockingReason = `${fieldTypeLabel(targetType)} is not available for automatic conversion.`;
  } else if (field.type === targetType) {
    blockingReason = `This column is already ${fieldTypeLabel(targetType).toLowerCase()}.`;
  } else if (publishedForms.length > 0) {
    blockingReason =
      "Close or update the published forms that use this column first.";
  }

  const warnings: string[] = [];
  if (hasMore) {
    warnings.push(
      `This preview samples ${MAX_FIELD_CONVERSION_PREVIEW_RECORDS} rows. Every row will be reviewed in safe batches before the column type changes.`,
    );
  }
  if (counts.changed > 0) {
    warnings.push(
      `${counts.changed} filled ${counts.changed === 1 ? "cell will" : "cells will"} be reformatted.`,
    );
  }
  if (counts.cleared > 0) {
    warnings.push(
      `${counts.cleared} filled ${counts.cleared === 1 ? "cell cannot" : "cells cannot"} be converted and will be cleared.`,
    );
  }
  if (counts.losingSomeInformation > 0) {
    warnings.push(
      `${counts.losingSomeInformation} filled ${counts.losingSomeInformation === 1 ? "cell will" : "cells will"} lose part of the original value.`,
    );
  }
  if (field.isPrimary) {
    warnings.push(
      "This is the main display column, so its converted values will appear throughout the workspace.",
    );
  }
  if (blockingReason) warnings.unshift(blockingReason);

  const prioritizedPlans = [...plans].sort((left, right) => {
    const priority = {
      "Will be cleared": 0,
      "Will change": 1,
      "Kept as-is": 2,
    } as const;
    return priority[left.outcome] - priority[right.outcome];
  });
  const examples = prioritizedPlans
    .slice(0, MAX_FIELD_CONVERSION_EXAMPLES)
    .map((plan) => ({
      before: plan.before,
      after: plan.after,
      result: plan.outcome,
      explanation: plan.result.explanation,
    }));
  const previewVersion = await hashConversionPreview({
    fieldId: field._id,
    fieldRevision: field.revision,
    targetType,
    targetConfig,
    hasMore,
    rows: records.map((record) => ({
      recordId: record._id,
      revision: record.revision,
      status: record.status,
      hasValue: field._id in record.values,
      value: record.values[field._id],
    })),
  });

  return {
    publicPreview: {
      columnName: field.name,
      currentType: fieldTypeLabel(field.type),
      newType: fieldTypeLabel(targetType),
      expectedFieldRevision: field.revision,
      previewVersion,
      canApply: blockingReason === null,
      blockingReason,
      requiresDataLossAcknowledgement:
        hasMore ||
        counts.cleared > 0 ||
        counts.losingSomeInformation > 0,
      counts,
      examples,
      dependencies: dependencies.dependencies,
      warnings,
    },
    plans,
    targetConfig,
    hasMore,
  };
}

function viewDefinitionReferencesField(
  view: Doc<"views">,
  fieldId: Id<"fields">,
): boolean {
  return (
    view.filters.some((filter) => filter.fieldId === fieldId) ||
    view.sorts.some((sort) => sort.fieldId === fieldId) ||
    view.groups.some((group) => group.fieldId === fieldId) ||
    view.configuration.kanbanFieldId === fieldId ||
    view.configuration.kanbanSummaryFieldIds?.includes(fieldId) === true ||
    view.configuration.calendarDateFieldId === fieldId ||
    view.configuration.galleryCoverFieldId === fieldId ||
    view.configuration.gallerySummaryFieldIds?.includes(fieldId) === true
  );
}

function friendlyList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function savedViewArchiveEffect(
  view: Doc<"views">,
  field: Doc<"fields">,
  hasColumnDisplaySettings: boolean,
): string {
  const filterCount = view.filters.filter(
    (filter) => filter.fieldId === field._id,
  ).length;
  const sortCount = view.sorts.filter(
    (sort) => sort.fieldId === field._id,
  ).length;
  const groupCount = view.groups.filter(
    (group) => group.fieldId === field._id,
  ).length;
  const affectedSettings: string[] = [];

  if (filterCount > 0) {
    affectedSettings.push(
      filterCount === 1 ? "the filter" : `${filterCount} filters`,
    );
  }
  if (sortCount > 0) {
    affectedSettings.push(
      sortCount === 1 ? "the sort" : `${sortCount} sorts`,
    );
  }
  if (groupCount > 0) {
    affectedSettings.push(
      groupCount === 1 ? "the group" : `${groupCount} groups`,
    );
  }
  if (view.configuration.kanbanFieldId === field._id) {
    affectedSettings.push("the Kanban lane layout");
  }
  if (
    view.configuration.kanbanSummaryFieldIds?.includes(field._id) ===
    true
  ) {
    affectedSettings.push("the Kanban card summary display");
  }
  if (view.configuration.calendarDateFieldId === field._id) {
    affectedSettings.push("the calendar date layout");
  }
  if (view.configuration.galleryCoverFieldId === field._id) {
    affectedSettings.push("the gallery cover display");
  }
  if (
    view.configuration.gallerySummaryFieldIds?.includes(field._id) ===
    true
  ) {
    affectedSettings.push("the gallery card summary display");
  }
  if (hasColumnDisplaySettings) {
    affectedSettings.push("the column display settings");
  }

  return `In “${view.name}”, ${friendlyList(affectedSettings)} using “${field.name}” will pause while the column is archived and return when it is restored.`;
}

async function getScopedArchiveDependencies(
  ctx: ReadCtx,
  field: Doc<"fields">,
) {
  const [
    draftReferences,
    publishedReferences,
    savedAnalysisReferences,
    viewFieldConfigs,
    activeViews,
    archivedViews,
  ] = await Promise.all([
    ctx.db
      .query("formDraftFields")
      .withIndex("by_target_field", (q) =>
        q.eq("targetFieldId", field._id),
      )
      .take(MAX_FORM_REFERENCES),
    ctx.db
      .query("formPublishedFieldRefs")
      .withIndex("by_target_field", (q) =>
        q.eq("targetFieldId", field._id),
      )
      .take(MAX_FORM_REFERENCES),
    ctx.db
      .query("aiReportFieldRefs")
      .withIndex("by_field", (q) => q.eq("fieldId", field._id))
      .take(MAX_SAVED_ANALYSES_PER_ORG),
    ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_field", (q) => q.eq("fieldId", field._id))
      .take(MAX_SAVED_VIEWS_PER_TABLE * 2),
    ctx.db
      .query("views")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", field.tableId).eq("status", "active"),
      )
      .take(MAX_SAVED_VIEWS_PER_TABLE),
    ctx.db
      .query("views")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", field.tableId).eq("status", "archived"),
      )
      .take(MAX_SAVED_VIEWS_PER_TABLE),
  ]);

  const formIds = new Set<Id<"forms">>();
  for (const reference of draftReferences) {
    if (reference.orgId === field.orgId) formIds.add(reference.formId);
  }
  for (const reference of publishedReferences) {
    if (reference.orgId === field.orgId) formIds.add(reference.formId);
  }
  const forms = await Promise.all(
    [...formIds].map((formId) => ctx.db.get(formId)),
  );
  const formsById = new Map<Id<"forms">, Doc<"forms">>();
  for (const form of forms) {
    if (
      form &&
      form.orgId === field.orgId &&
      form.baseId === field.baseId &&
      form.tableId === field.tableId &&
      form.status !== "deleted"
    ) {
      formsById.set(form._id, form);
    }
  }

  const savedAnalysisIds = new Set(
    savedAnalysisReferences
      .filter(
        (reference) =>
          reference.orgId === field.orgId &&
          reference.baseId === field.baseId &&
          reference.tableId === field.tableId,
      )
      .map((reference) => reference.reportId),
  );
  const savedAnalyses = (
    await Promise.all(
      [...savedAnalysisIds].map((reportId) => ctx.db.get(reportId)),
    )
  ).filter(
    (report): report is Doc<"aiReports"> =>
      Boolean(
        report &&
          report.orgId === field.orgId &&
          report.status === "active",
      ),
  );

  const scopedDraftReferences = draftReferences.filter(
    (reference) =>
      reference.orgId === field.orgId &&
      formsById.has(reference.formId),
  );
  const scopedPublishedReferences = publishedReferences.filter(
    (reference) =>
      reference.orgId === field.orgId &&
      formsById.has(reference.formId),
  );

  const draftForms = new Map<Id<"forms">, Doc<"forms">>();
  for (const reference of scopedDraftReferences) {
    const form = formsById.get(reference.formId);
    if (form) draftForms.set(form._id, form);
  }
  const publishedForms = new Map<Id<"forms">, Doc<"forms">>();
  for (const reference of scopedPublishedReferences) {
    const form = formsById.get(reference.formId);
    if (form) publishedForms.set(form._id, form);
  }

  const configuredViewIds = new Set(
    viewFieldConfigs
      .filter(
        (config) =>
          config.orgId === field.orgId &&
          config.baseId === field.baseId &&
          config.tableId === field.tableId,
      )
      .map((config) => config.viewId),
  );
  const savedViews = [...activeViews, ...archivedViews].filter(
    (view) =>
      view.orgId === field.orgId &&
      view.baseId === field.baseId &&
      (configuredViewIds.has(view._id) ||
        viewDefinitionReferencesField(view, field._id)),
  );

  const dependencies: ArchiveDependency[] = [
    ...[...draftForms.values()].map((form) => ({
      category: "Draft form" as const,
      name: form.name,
    })),
    ...[...publishedForms.values()].map((form) => ({
      category: "Published form" as const,
      name: form.name,
    })),
    ...savedViews.map((view) => ({
      category: "Saved view" as const,
      name: view.name,
      effect: savedViewArchiveEffect(
        view,
        field,
        configuredViewIds.has(view._id),
      ),
    })),
    ...savedAnalyses.map((report) => ({
      category: "Saved analysis" as const,
      name: report.name,
    })),
  ];
  const categoryOrder = {
    "Published form": 0,
    "Draft form": 1,
    "Saved view": 2,
    "Saved analysis": 3,
  } satisfies Record<ArchiveDependency["category"], number>;
  dependencies.sort(
    (left, right) =>
      categoryOrder[left.category] - categoryOrder[right.category] ||
      left.name.localeCompare(right.name),
  );

  return {
    dependencies,
    draftReferences: scopedDraftReferences,
    publishedForms: [...publishedForms.values()],
  };
}

export const list = query({
  args: { tableId: v.id("tables") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);
    return await ctx.db
      .query("fields")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", args.tableId).eq("status", "active"),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable);
  },
});

export const listArchived = query({
  args: { tableId: v.id("tables") },
  returns: v.array(
    v.object({
      fieldId: v.id("fields"),
      name: v.string(),
      archivedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    await requireTable(ctx, identity.orgId, args.tableId);
    const fields = await ctx.db
      .query("fields")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", args.tableId).eq("status", "deleted"),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable);
    return fields
      .filter((field) => field.orgId === identity.orgId)
      .map((field) => ({
        fieldId: field._id,
        name: field.name,
        archivedAt: field.deletedAt ?? field.updatedAt,
      }));
  },
});

export const getArchiveImpact = query({
  args: { fieldId: v.id("fields") },
  returns: v.object({
    columnName: v.string(),
    canArchive: v.boolean(),
    blockingReason: v.union(v.string(), v.null()),
    dependencies: v.array(archiveDependencyValidator),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const field = await requireField(
      ctx,
      identity.orgId,
      args.fieldId,
      true,
    );
    await assertFieldConversionUnlocked(ctx, field._id);
    await requireTable(ctx, identity.orgId, field.tableId);
    const impact = await getScopedArchiveDependencies(ctx, field);
    const blockingReason =
      field.status !== "active"
        ? "This column is already archived."
        : field.isPrimary
          ? "The required column cannot be archived."
          : impact.publishedForms.length > 0
            ? "Close or update the published forms that use this column first."
            : null;
    return {
      columnName: field.name,
      canArchive: blockingReason === null,
      blockingReason,
      dependencies: impact.dependencies,
    };
  },
});

export const previewTypeConversion = query({
  args: {
    fieldId: v.id("fields"),
    newType: fieldTypeValidator,
    newConfig: v.optional(fieldConfigValidator),
  },
  returns: conversionPreviewValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const field = await requireField(
      ctx,
      identity.orgId,
      args.fieldId,
      true,
    );
    await assertFieldConversionUnlocked(ctx, field._id);
    await requireTable(ctx, identity.orgId, field.tableId);
    const preview = await buildConversionPreview(
      ctx,
      field,
      args.newType,
      args.newConfig,
    );
    return preview.publicPreview;
  },
});

export const applyTypeConversion = mutation({
  args: {
    fieldId: v.id("fields"),
    newType: fieldTypeValidator,
    newConfig: v.optional(fieldConfigValidator),
    expectedFieldRevision: v.number(),
    previewVersion: v.string(),
    acknowledgeDataLoss: v.boolean(),
  },
  returns: conversionApplyResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const field = await requireField(
      ctx,
      identity.orgId,
      args.fieldId,
      true,
    );
    await assertFieldConversionUnlocked(ctx, field._id);
    await requireTable(ctx, identity.orgId, field.tableId);
    if (
      !Number.isInteger(args.expectedFieldRevision) ||
      args.expectedFieldRevision < 1 ||
      field.revision !== args.expectedFieldRevision
    ) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_PREVIEW_STALE",
        message:
          "This column changed after the preview. Review the conversion again before applying it.",
      });
    }
    if (!/^[a-f0-9]{64}$/.test(args.previewVersion)) {
      throw new ConvexError({
        code: "INVALID_FIELD_CONVERSION_PREVIEW",
        message: "Review the conversion again before applying it.",
      });
    }

    const conversion = await buildConversionPreview(
      ctx,
      field,
      args.newType,
      args.newConfig,
    );
    if (conversion.publicPreview.previewVersion !== args.previewVersion) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_PREVIEW_STALE",
        message:
          "Rows changed after the preview. Review the conversion again before applying it.",
      });
    }
    if (!conversion.publicPreview.canApply) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_BLOCKED",
        message:
          conversion.publicPreview.blockingReason ??
          "This conversion cannot be applied.",
      });
    }
    if (conversion.hasMore) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_JOB_REQUIRED",
        message:
          "Use the resumable column change so every row can be reviewed safely.",
      });
    }
    if (
      conversion.publicPreview.requiresDataLossAcknowledgement &&
      !args.acknowledgeDataLoss
    ) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_REQUIRES_ACKNOWLEDGEMENT",
        message:
          "Confirm that you understand some saved information will be changed or cleared.",
      });
    }

    const now = Date.now();
    let rowsUpdated = 0;
    for (const plan of conversion.plans) {
      if (plan.outcome === "Kept as-is") continue;
      const values = { ...plan.record.values };
      if (plan.result.cleared || plan.result.value === undefined) {
        delete values[field._id];
      } else {
        values[field._id] = plan.result.value;
      }
      await ctx.db.patch(plan.record._id, {
        values,
        revision: plan.record.revision + 1,
        updatedByType: "user",
        updatedById: identity.userId,
        updatedAt: now,
      });
      rowsUpdated += 1;
    }

    const fieldRevision = field.revision + 1;
    await ctx.db.patch(field._id, {
      type: args.newType,
      config: conversion.targetConfig,
      revision: fieldRevision,
      updatedAt: now,
    });
    await invalidateTableViewMaterializations(ctx, field.tableId);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "field.type_converted",
      resourceType: "field",
      resourceId: field._id,
      baseId: field.baseId,
      tableId: field.tableId,
      changedFieldIds: [field._id],
      revisionBefore: field.revision,
      revisionAfter: fieldRevision,
    });

    return {
      columnName: field.name,
      previousType: fieldTypeLabel(field.type),
      newType: fieldTypeLabel(args.newType),
      fieldRevision,
      rowsUpdated,
      cellsCleared: conversion.publicPreview.counts.cleared,
      cellsChanged: conversion.publicPreview.counts.changed,
    };
  },
});

function conversionJobProgress(job: Doc<"fieldConversionJobs">) {
  return {
    jobId: job._id,
    fieldId: job.fieldId,
    columnName: job.columnName,
    targetType: job.targetType,
    targetConfig: job.targetConfig,
    status: job.status,
    phase: job.phase,
    counts: job.counts,
    failureMessage: job.failureMessage ?? null,
  };
}

async function requireConversionJob(
  ctx: ReadCtx,
  identity: Awaited<ReturnType<typeof requireOrgIdentity>>,
  jobId: Id<"fieldConversionJobs">,
) {
  const job = await ctx.db.get(jobId);
  if (!job || job.orgId !== identity.orgId) {
    throw new ConvexError({
      code: "FIELD_CONVERSION_JOB_NOT_AVAILABLE",
      message: "That column change is no longer available.",
    });
  }
  return job;
}

async function failConversionJob(
  ctx: MutationCtx,
  job: Doc<"fieldConversionJobs">,
  phase: "staging" | "applying",
  failureMessage: string,
) {
  const failedJob: Doc<"fieldConversionJobs"> = {
    ...job,
    status: "failed",
    phase,
    failureMessage,
    updatedAt: Date.now(),
  };
  await ctx.db.patch(job._id, {
    status: failedJob.status,
    phase: failedJob.phase,
    failureMessage: failedJob.failureMessage,
    updatedAt: failedJob.updatedAt,
  });
  return conversionJobProgress(failedJob);
}

function conversionPlanForRecord(
  field: Doc<"fields">,
  targetType: FieldType,
  targetConfig: FieldConfig,
  record: Doc<"records">,
) {
  const sourceHadValue = field._id in record.values;
  if (!sourceHadValue) {
    return {
      sourceHadValue,
      sourceValue: null,
      convertedValue: null,
      outcome: "Kept as-is" as const,
      lossy: false,
    };
  }
  const sourceValue = record.values[field._id]!;
  const result = convertCellValue(
    field,
    targetType,
    targetConfig,
    sourceValue,
  );
  const outcome = result.cleared
    ? ("Will be cleared" as const)
    : result.value !== undefined &&
        valuesMatch(sourceValue, result.value)
      ? ("Kept as-is" as const)
      : ("Will change" as const);
  return {
    sourceHadValue,
    sourceValue,
    convertedValue:
      result.cleared || result.value === undefined ? null : result.value,
    outcome,
    lossy: result.lossy,
  };
}

function nullableValuesMatch(
  left: CellValue | undefined,
  right: CellValue | null,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}

function normalizedFieldName(name: string) {
  return name.trim().normalize("NFKC").toLocaleLowerCase();
}

async function assertFieldNameAvailable(
  ctx: ReadCtx,
  tableId: Id<"tables">,
  name: string,
  currentFieldId?: Id<"fields">,
) {
  const normalizedName = normalizedFieldName(name);
  const fields = await ctx.db
    .query("fields")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", tableId).eq("status", "active"),
    )
    .take(PLAN_LIMITS.pro.fieldsPerTable);
  if (
    fields.some(
      (field) =>
        field._id !== currentFieldId &&
        normalizedFieldName(field.name) === normalizedName,
    )
  ) {
    throw new ConvexError({
      code: "FIELD_NAME_ALREADY_USED",
      message:
        "A column with this name already exists. Choose a different name.",
    });
  }
}

export const getActiveTypeConversionJob = query({
  args: { tableId: v.id("tables") },
  returns: v.union(conversionJobProgressValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);
    const job = await ctx.db
      .query("fieldConversionJobs")
      .withIndex("by_table_and_lock_active", (q) =>
        q.eq("tableId", args.tableId).eq("lockActive", true),
      )
      .unique();
    return job ? conversionJobProgress(job) : null;
  },
});

export const startTypeConversionJob = mutation({
  args: {
    fieldId: v.id("fields"),
    newType: fieldTypeValidator,
    newConfig: v.optional(fieldConfigValidator),
    expectedFieldRevision: v.number(),
    previewVersion: v.string(),
    acknowledgeDataLoss: v.boolean(),
  },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const field = await requireField(
      ctx,
      identity.orgId,
      args.fieldId,
      true,
    );
    await requireTable(ctx, identity.orgId, field.tableId);
    if (field.revision !== args.expectedFieldRevision) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_PREVIEW_STALE",
        message:
          "This column changed after the preview. Review the conversion again before applying it.",
      });
    }
    if (await activeFieldConversionJob(ctx, field._id)) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_IN_PROGRESS",
        message: "This column change is already in progress.",
      });
    }
    const activeTableJob = await ctx.db
      .query("fieldConversionJobs")
      .withIndex("by_table_and_lock_active", (q) =>
        q.eq("tableId", field.tableId).eq("lockActive", true),
      )
      .unique();
    if (activeTableJob) {
      throw new ConvexError({
        code: "TABLE_FIELD_CONVERSION_IN_PROGRESS",
        message:
          "Finish the current column change in this table before starting another.",
      });
    }
    const conversion = await buildConversionPreview(
      ctx,
      field,
      args.newType,
      args.newConfig,
    );
    if (
      conversion.publicPreview.previewVersion !== args.previewVersion
    ) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_PREVIEW_STALE",
        message:
          "Saved rows changed after the preview. Review the conversion again before applying it.",
      });
    }
    if (!conversion.publicPreview.canApply) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_BLOCKED",
        message:
          conversion.publicPreview.blockingReason ??
          "This column change cannot start.",
      });
    }
    if (
      conversion.publicPreview.requiresDataLossAcknowledgement &&
      !args.acknowledgeDataLoss
    ) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_REQUIRES_ACKNOWLEDGEMENT",
        message:
          "Confirm that every row will be reviewed and some saved information may change.",
      });
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("fieldConversionJobs", {
      orgId: identity.orgId,
      actorUserId: identity.userId,
      baseId: field.baseId,
      tableId: field.tableId,
      fieldId: field._id,
      columnName: field.name,
      sourceType: field.type,
      targetType: args.newType,
      targetConfig: conversion.targetConfig,
      expectedFieldRevision: field.revision,
      previewVersion: args.previewVersion,
      status: "staging",
      phase: "staging",
      scanStatus: "active",
      scanCursor: null,
      applyCursor: null,
      acknowledgeDataLoss: false,
      lockActive: true,
      counts: {
        reviewedRows: 0,
        filledCells: 0,
        keptAsIs: 0,
        changed: 0,
        cleared: 0,
        losingSomeInformation: 0,
        appliedRows: 0,
        rowsUpdated: 0,
      },
      createdAt: now,
      updatedAt: now,
    });
    return conversionJobProgress(
      (await ctx.db.get(jobId))!,
    );
  },
});

export const stageTypeConversionBatch = mutation({
  args: { jobId: v.id("fieldConversionJobs") },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const job = await requireConversionJob(ctx, identity, args.jobId);
    if (job.status !== "staging") return conversionJobProgress(job);
    const field = await requireField(
      ctx,
      identity.orgId,
      job.fieldId,
      true,
    );
    if (
      field.status !== "active" ||
      field.revision !== job.expectedFieldRevision ||
      field.type !== job.sourceType
    ) {
      return await failConversionJob(
        ctx,
        job,
        "staging",
        "The column changed while its rows were being reviewed. Retry after reloading the table.",
      );
    }

    const page = await ctx.db
      .query("records")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", job.tableId).eq("status", job.scanStatus),
      )
      .paginate({
        cursor: job.scanCursor,
        numItems: FIELD_CONVERSION_BATCH_SIZE,
      });
    const now = Date.now();
    const counts = { ...job.counts };
    for (const record of page.page) {
      if (
        record.orgId !== identity.orgId ||
        record.baseId !== job.baseId
      ) {
        return await failConversionJob(
          ctx,
          job,
          "staging",
          "A row moved outside this table while it was being reviewed. Reload and retry the column change.",
        );
      }
      const plan = conversionPlanForRecord(
        field,
        job.targetType,
        job.targetConfig,
        record,
      );
      await ctx.db.insert("fieldConversionShadowValues", {
        orgId: identity.orgId,
        jobId: job._id,
        fieldId: field._id,
        recordId: record._id,
        sourceRevision: record.revision,
        sourceHadValue: plan.sourceHadValue,
        sourceValue: plan.sourceValue,
        convertedValue: plan.convertedValue,
        outcome: plan.outcome,
        lossy: plan.lossy,
        createdAt: now,
      });
      counts.reviewedRows += 1;
      if (plan.sourceHadValue) counts.filledCells += 1;
      if (plan.outcome === "Kept as-is") counts.keptAsIs += 1;
      if (plan.outcome === "Will change") counts.changed += 1;
      if (plan.outcome === "Will be cleared") counts.cleared += 1;
      if (plan.lossy && plan.outcome !== "Will be cleared") {
        counts.losingSomeInformation += 1;
      }
    }

    const finishedStatus = job.scanStatus === "deleted";
    const patch = page.isDone
      ? finishedStatus
        ? {
            status: "ready" as const,
            scanCursor: null,
          }
        : {
            scanStatus: "deleted" as const,
            scanCursor: null,
          }
      : { scanCursor: page.continueCursor };
    const nextJob: Doc<"fieldConversionJobs"> = {
      ...job,
      ...patch,
      counts,
      updatedAt: now,
    };
    await ctx.db.patch(job._id, {
      ...patch,
      counts,
      updatedAt: now,
    });
    return conversionJobProgress(nextJob);
  },
});

export const beginTypeConversionApply = mutation({
  args: {
    jobId: v.id("fieldConversionJobs"),
    acknowledgeDataLoss: v.boolean(),
  },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const job = await requireConversionJob(ctx, identity, args.jobId);
    if (job.status !== "ready") return conversionJobProgress(job);
    if (
      (job.counts.cleared > 0 ||
        job.counts.losingSomeInformation > 0) &&
      !args.acknowledgeDataLoss
    ) {
      throw new ConvexError({
        code: "FIELD_CONVERSION_REQUIRES_EXACT_ACKNOWLEDGEMENT",
        message:
          "Review the final counts and confirm that some saved information will change or be cleared.",
      });
    }
    const nextJob: Doc<"fieldConversionJobs"> = {
      ...job,
      status: "applying",
      phase: "applying",
      acknowledgeDataLoss: args.acknowledgeDataLoss,
      failureMessage: undefined,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(job._id, {
      status: nextJob.status,
      phase: nextJob.phase,
      acknowledgeDataLoss: nextJob.acknowledgeDataLoss,
      failureMessage: undefined,
      updatedAt: nextJob.updatedAt,
    });
    return conversionJobProgress(nextJob);
  },
});

export const applyTypeConversionBatch = mutation({
  args: { jobId: v.id("fieldConversionJobs") },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const job = await requireConversionJob(ctx, identity, args.jobId);
    if (job.status !== "applying") return conversionJobProgress(job);
    const field = await requireField(
      ctx,
      identity.orgId,
      job.fieldId,
      true,
    );
    if (
      field.status !== "active" ||
      field.revision !== job.expectedFieldRevision ||
      field.type !== job.sourceType
    ) {
      return await failConversionJob(
        ctx,
        job,
        "applying",
        "The column changed before every row was updated. Retry after reloading the table.",
      );
    }

    const page = await ctx.db
      .query("fieldConversionShadowValues")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .paginate({
        cursor: job.applyCursor,
        numItems: FIELD_CONVERSION_BATCH_SIZE,
      });
    const rows = await Promise.all(
      page.page.map((shadow) => ctx.db.get(shadow.recordId)),
    );
    const plannedWrites: Array<{
      record: Doc<"records">;
      values: Doc<"records">["values"];
    }> = [];
    for (let index = 0; index < page.page.length; index += 1) {
      const shadow = page.page[index]!;
      const record = rows[index];
      if (
        !record ||
        record.orgId !== identity.orgId ||
        record.tableId !== job.tableId ||
        record.baseId !== job.baseId ||
        record.revision < shadow.sourceRevision
      ) {
        return await failConversionJob(
          ctx,
          job,
          "applying",
          "A row changed while the column update was paused. Reload the table and retry.",
        );
      }
      const currentValue = record.values[field._id];
      const matchesSource = nullableValuesMatch(
        currentValue,
        shadow.sourceValue,
      );
      const matchesConverted = nullableValuesMatch(
        currentValue,
        shadow.convertedValue,
      );
      if (!matchesSource && !matchesConverted) {
        return await failConversionJob(
          ctx,
          job,
          "applying",
          "A saved value changed during the column update. Restore that value or reload before retrying.",
        );
      }
      if (
        shadow.outcome === "Kept as-is" ||
        (!matchesSource && matchesConverted)
      ) {
        continue;
      }
      const values = { ...record.values };
      if (
        shadow.outcome === "Will be cleared" ||
        shadow.convertedValue === null
      ) {
        delete values[field._id];
      } else {
        values[field._id] = shadow.convertedValue;
      }
      plannedWrites.push({ record, values });
    }

    const now = Date.now();
    for (const write of plannedWrites) {
      await ctx.db.patch(write.record._id, {
        values: write.values,
        revision: write.record.revision + 1,
        updatedByType: "user",
        updatedById: identity.userId,
        updatedAt: now,
      });
    }
    const counts = {
      ...job.counts,
      appliedRows: job.counts.appliedRows + page.page.length,
      rowsUpdated: job.counts.rowsUpdated + plannedWrites.length,
    };

    if (!page.isDone) {
      const nextJob: Doc<"fieldConversionJobs"> = {
        ...job,
        applyCursor: page.continueCursor,
        counts,
        updatedAt: now,
      };
      await ctx.db.patch(job._id, {
        applyCursor: page.continueCursor,
        counts,
        updatedAt: now,
      });
      return conversionJobProgress(nextJob);
    }

    const fieldRevision = field.revision + 1;
    await ctx.db.patch(field._id, {
      type: job.targetType,
      config: job.targetConfig,
      revision: fieldRevision,
      updatedAt: now,
    });
    await invalidateTableViewMaterializations(ctx, field.tableId);
    const completedJob: Doc<"fieldConversionJobs"> = {
      ...job,
      status: "completed",
      lockActive: false,
      applyCursor: null,
      counts,
      failureMessage: undefined,
      updatedAt: now,
      completedAt: now,
    };
    await ctx.db.patch(job._id, {
      status: completedJob.status,
      lockActive: false,
      applyCursor: null,
      counts,
      failureMessage: undefined,
      updatedAt: now,
      completedAt: now,
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "field.type_converted",
      resourceType: "field",
      resourceId: field._id,
      baseId: field.baseId,
      tableId: field.tableId,
      changedFieldIds: [field._id],
      revisionBefore: field.revision,
      revisionAfter: fieldRevision,
    });
    return conversionJobProgress(completedJob);
  },
});

export const requestTypeConversionCancel = mutation({
  args: { jobId: v.id("fieldConversionJobs") },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const job = await requireConversionJob(ctx, identity, args.jobId);
    if (!job.lockActive) return conversionJobProgress(job);
    if (job.phase === "applying") {
      throw new ConvexError({
        code: "FIELD_CONVERSION_APPLY_REQUIRES_RETRY",
        message:
          "This column has started updating rows. Retry it to finish safely.",
      });
    }
    const nextJob: Doc<"fieldConversionJobs"> = {
      ...job,
      status: "cancelling",
      failureMessage: undefined,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(job._id, {
      status: nextJob.status,
      failureMessage: undefined,
      updatedAt: nextJob.updatedAt,
    });
    return conversionJobProgress(nextJob);
  },
});

export const cancelTypeConversionBatch = mutation({
  args: { jobId: v.id("fieldConversionJobs") },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const job = await requireConversionJob(ctx, identity, args.jobId);
    if (job.status !== "cancelling") {
      return conversionJobProgress(job);
    }
    const shadows = await ctx.db
      .query("fieldConversionShadowValues")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .take(FIELD_CONVERSION_BATCH_SIZE);
    for (const shadow of shadows) {
      await ctx.db.delete(shadow._id);
    }
    const now = Date.now();
    if (shadows.length > 0) {
      const nextJob: Doc<"fieldConversionJobs"> = {
        ...job,
        updatedAt: now,
      };
      await ctx.db.patch(job._id, { updatedAt: now });
      return conversionJobProgress(nextJob);
    }
    const cancelledJob: Doc<"fieldConversionJobs"> = {
      ...job,
      status: "cancelled",
      lockActive: false,
      failureMessage: undefined,
      updatedAt: now,
      completedAt: now,
    };
    await ctx.db.patch(job._id, {
      status: cancelledJob.status,
      lockActive: false,
      failureMessage: undefined,
      updatedAt: now,
      completedAt: now,
    });
    return conversionJobProgress(cancelledJob);
  },
});

export const retryTypeConversionJob = mutation({
  args: { jobId: v.id("fieldConversionJobs") },
  returns: conversionJobProgressValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const job = await requireConversionJob(ctx, identity, args.jobId);
    if (job.status !== "failed") return conversionJobProgress(job);
    const nextJob: Doc<"fieldConversionJobs"> = {
      ...job,
      status: job.phase,
      failureMessage: undefined,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(job._id, {
      status: nextJob.status,
      failureMessage: undefined,
      updatedAt: nextJob.updatedAt,
    });
    return conversionJobProgress(nextJob);
  },
});

export const create = mutation({
  args: {
    tableId: v.id("tables"),
    name: v.string(),
    type: fieldTypeValidator,
    config: fieldConfigValidator,
    afterRank: v.optional(v.string()),
    width: v.optional(v.number()),
  },
  returns: v.id("fields"),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    const name = args.name.trim();
    if (!name || name.length > 120) {
      throw new ConvexError({ code: "INVALID_FIELD_NAME" });
    }
    await assertFieldNameAvailable(ctx, args.tableId, name);
    validateFieldConfiguration(args.type, args.config);
    const count = await fieldCount.count(ctx, { namespace: args.tableId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].fieldsPerTable,
      "fields_per_table",
    );
    const afterField =
      args.afterRank === undefined
        ? null
        : await ctx.db
            .query("fields")
            .withIndex("by_table_and_status_and_rank", (q) =>
              q
                .eq("tableId", args.tableId)
                .eq("status", "active")
                .eq("rank", args.afterRank!),
            )
            .unique();

    const fieldId = await ctx.db.insert("fields", {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: args.tableId,
      name,
      type: args.type,
      config: args.config,
      rank: createRank(args.afterRank),
      width: Math.max(100, Math.min(args.width ?? 180, 600)),
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: identity.userId,
      updatedAt: Date.now(),
    });
    const field = await ctx.db.get(fieldId);
    await fieldCount.insert(ctx, field!);
    await addFieldToActiveViews(ctx, field!, afterField?._id);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "field.created",
      resourceType: "field",
      resourceId: fieldId,
      baseId: table.baseId,
      tableId: args.tableId,
      revisionAfter: 1,
    });
    return fieldId;
  },
});

export const update = mutation({
  args: {
    fieldId: v.id("fields"),
    name: v.optional(v.string()),
    config: v.optional(fieldConfigValidator),
    rank: v.optional(v.string()),
    width: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const field = await requireField(ctx, identity.orgId, args.fieldId);
    await assertFieldConversionUnlocked(ctx, field._id);
    const patch: {
      name?: string;
      config?: typeof field.config;
      rank?: string;
      width?: number;
      revision: number;
      updatedAt: number;
    } = {
      revision: field.revision + 1,
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name || name.length > 120) {
        throw new ConvexError({ code: "INVALID_FIELD_NAME" });
      }
      await assertFieldNameAvailable(
        ctx,
        field.tableId,
        name,
        field._id,
      );
      patch.name = name;
    }
    if (args.config !== undefined) {
      validateFieldConfiguration(field.type, args.config);
      if (JSON.stringify(args.config) !== JSON.stringify(field.config)) {
        const publishedReference = await ctx.db
          .query("formPublishedFieldRefs")
          .withIndex("by_target_field", (q) =>
            q.eq("targetFieldId", args.fieldId),
          )
          .first();
        if (publishedReference) {
          throw new ConvexError({
            code: "FIELD_CONFIG_USED_BY_PUBLISHED_FORM",
            formId: publishedReference.formId,
          });
        }
      }
      patch.config = args.config;
    }
    if (args.rank !== undefined) patch.rank = args.rank;
    if (args.width !== undefined) {
      patch.width = Math.max(100, Math.min(args.width, 600));
    }
    await ctx.db.patch(args.fieldId, patch);
    if (args.name !== undefined || args.config !== undefined) {
      await invalidateTableViewMaterializations(ctx, field.tableId);
    }
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "field.updated",
      resourceType: "field",
      resourceId: args.fieldId,
      baseId: field.baseId,
      tableId: field.tableId,
      revisionBefore: field.revision,
      revisionAfter: field.revision + 1,
    });
    return null;
  },
});

async function archiveField(
  ctx: MutationCtx,
  fieldId: Id<"fields">,
  auditAction: "field.archived" | "field.deleted",
) {
  const identity = await requireOrgIdentity(ctx);
  requireOrgAdmin(identity);
  const field = await requireField(ctx, identity.orgId, fieldId);
  await assertFieldConversionUnlocked(ctx, field._id);
  const table = await requireTable(ctx, identity.orgId, field.tableId);
  if (table.primaryFieldId === fieldId) {
    throw new ConvexError({ code: "PRIMARY_FIELD_CANNOT_BE_DELETED" });
  }

  const impact = await getScopedArchiveDependencies(ctx, field);
  const publishedForm = impact.publishedForms[0];
  if (publishedForm) {
    throw new ConvexError({
      code: "FIELD_USED_BY_PUBLISHED_FORM",
      formId: publishedForm._id,
      formName: publishedForm.name,
    });
  }

  const now = Date.now();
  await ctx.db.patch(fieldId, {
    status: "deleted",
    revision: field.revision + 1,
    deletedAt: now,
    updatedAt: now,
  });
  await fieldCount.delete(ctx, field);
  await invalidateTableViewMaterializations(ctx, field.tableId);

  for (const reference of impact.draftReferences) {
    await ctx.db.delete(reference._id);
  }

  await writeAudit(ctx, {
    orgId: identity.orgId,
    actor: userActor(identity),
    action: auditAction,
    resourceType: "field",
    resourceId: fieldId,
    baseId: field.baseId,
    tableId: field.tableId,
    revisionBefore: field.revision,
    revisionAfter: field.revision + 1,
  });
  return null;
}

export const archive = mutation({
  args: { fieldId: v.id("fields") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await archiveField(ctx, args.fieldId, "field.archived"),
});

export const remove = mutation({
  args: { fieldId: v.id("fields") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await archiveField(ctx, args.fieldId, "field.deleted"),
});

export const restore = mutation({
  args: { fieldId: v.id("fields") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const field = await requireField(ctx, identity.orgId, args.fieldId, true);
    await assertFieldConversionUnlocked(ctx, field._id);
    await requireTable(ctx, identity.orgId, field.tableId);
    if (field.status === "active") return null;
    await assertFieldNameAvailable(
      ctx,
      field.tableId,
      field.name,
      field._id,
    );
    const count = await fieldCount.count(ctx, { namespace: field.tableId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].fieldsPerTable,
      "fields_per_table",
    );
    await ctx.db.patch(args.fieldId, {
      status: "active",
      revision: field.revision + 1,
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    const restored = await ctx.db.get(args.fieldId);
    await fieldCount.insert(ctx, restored!);
    await addFieldToActiveViews(ctx, restored!);
    await invalidateTableViewMaterializations(ctx, field.tableId);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "field.restored",
      resourceType: "field",
      resourceId: args.fieldId,
      baseId: field.baseId,
      tableId: field.tableId,
      revisionBefore: field.revision,
      revisionAfter: field.revision + 1,
    });
    return null;
  },
});
