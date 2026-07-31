import { v } from "convex/values";

export const activeStatusValidator = v.union(
  v.literal("active"),
  v.literal("deleted"),
);

export const formStatusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("closed"),
  v.literal("deleted"),
);

export const fieldTypeValidator = v.union(
  v.literal("singleLineText"),
  v.literal("longText"),
  v.literal("number"),
  v.literal("currency"),
  v.literal("percent"),
  v.literal("rating"),
  v.literal("checkbox"),
  v.literal("date"),
  v.literal("email"),
  v.literal("phone"),
  v.literal("url"),
  v.literal("singleSelect"),
  v.literal("multiSelect"),
  v.literal("attachment"),
  v.literal("createdTime"),
  v.literal("createdBy"),
);

export const selectOptionValidator = v.object({
  id: v.string(),
  label: v.string(),
  color: v.string(),
  rank: v.optional(v.string()),
  archived: v.optional(v.boolean()),
});

export const fieldConfigValidator = v.object({
  maxLength: v.optional(v.number()),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  precision: v.optional(v.number()),
  currency: v.optional(v.string()),
  dateStyle: v.optional(
    v.union(v.literal("date"), v.literal("dateTime")),
  ),
  attachmentKind: v.optional(
    v.union(v.literal("image"), v.literal("file"), v.literal("any")),
  ),
  includeTime: v.optional(v.boolean()),
  options: v.optional(v.array(selectOptionValidator)),
  acceptedMimeTypes: v.optional(v.array(v.string())),
});

export const cellValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
  v.array(v.id("attachments")),
);

export const nullableCellValueValidator = v.union(
  v.null(),
  cellValueValidator,
);

export const viewTypeValidator = v.union(
  v.literal("grid"),
  v.literal("kanban"),
  v.literal("calendar"),
  v.literal("gallery"),
);

export const viewStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
  v.literal("deleted"),
);

export const viewVisibilityValidator = v.union(
  v.literal("collaborators"),
  v.literal("personal"),
  v.literal("public"),
);

export const viewFilterOperatorValidator = v.union(
  v.literal("is"),
  v.literal("is_not"),
  v.literal("contains"),
  v.literal("does_not_contain"),
  v.literal("is_empty"),
  v.literal("is_not_empty"),
  v.literal("greater_than"),
  v.literal("less_than"),
  v.literal("before"),
  v.literal("after"),
);

export const viewFilterValidator = v.object({
  id: v.string(),
  fieldId: v.id("fields"),
  operator: viewFilterOperatorValidator,
  value: v.optional(nullableCellValueValidator),
});

export const viewSortValidator = v.object({
  id: v.string(),
  fieldId: v.id("fields"),
  direction: v.union(v.literal("asc"), v.literal("desc")),
  rank: v.string(),
});

export const viewGroupValidator = v.object({
  id: v.string(),
  fieldId: v.id("fields"),
  direction: v.union(v.literal("asc"), v.literal("desc")),
  rank: v.string(),
});

export const viewConfigurationValidator = v.object({
  rowHeight: v.optional(
    v.union(v.literal("compact"), v.literal("medium"), v.literal("tall")),
  ),
  kanbanFieldId: v.optional(v.id("fields")),
  kanbanSummaryFieldIds: v.optional(v.array(v.id("fields"))),
  calendarDateFieldId: v.optional(v.id("fields")),
  calendarDisplay: v.optional(
    v.union(v.literal("month"), v.literal("agenda")),
  ),
  galleryCoverFieldId: v.optional(v.id("fields")),
  gallerySummaryFieldIds: v.optional(v.array(v.id("fields"))),
});

export const viewFieldFormattingValidator = v.object({
  wrap: v.optional(v.boolean()),
  color: v.optional(v.string()),
});

export const recordValuesValidator = v.record(
  v.id("fields"),
  cellValueValidator,
);

export const formAppearanceValidator = v.object({
  primaryColor: v.string(),
  backgroundColor: v.string(),
  submitLabel: v.string(),
  showPoweredBy: v.boolean(),
  layout: v.optional(v.union(v.literal("card"), v.literal("plain"))),
  logoStorageId: v.optional(v.id("_storage")),
  coverStorageId: v.optional(v.id("_storage")),
});

export const formAppearanceInputValidator = v.object({
  primaryColor: v.string(),
  backgroundColor: v.string(),
  submitLabel: v.string(),
  showPoweredBy: v.boolean(),
  layout: v.optional(v.union(v.literal("card"), v.literal("plain"))),
});

export const thankYouValidator = v.object({
  title: v.string(),
  message: v.string(),
  redirectUrl: v.optional(v.string()),
});

export const analyticsMetricValidator = v.union(
  v.literal("view"),
  v.literal("start"),
  v.literal("submission"),
  v.literal("validation_error"),
  v.literal("abandonment"),
);

export const analyticsDeviceCategoryValidator = v.union(
  v.literal("desktop"),
  v.literal("tablet"),
  v.literal("mobile"),
  v.literal("unknown"),
);

export const analyticsTrafficSourceValidator = v.union(
  v.literal("direct"),
  v.literal("search"),
  v.literal("social"),
  v.literal("email"),
  v.literal("campaign"),
  v.literal("referral"),
  v.literal("unknown"),
);

export const analyticsBreakdownKindValidator = v.union(
  v.literal("device"),
  v.literal("traffic_source"),
  v.literal("question_exit"),
);

export const actorTypeValidator = v.union(
  v.literal("user"),
  v.literal("public_form"),
  v.literal("eve"),
  v.literal("system"),
);

export const resourceTypeValidator = v.union(
  v.literal("base"),
  v.literal("table"),
  v.literal("field"),
  v.literal("view"),
  v.literal("record"),
  v.literal("form"),
  v.literal("form_version"),
  v.literal("submission"),
  v.literal("attachment"),
  v.literal("ai_session"),
);

export const planTierValidator = v.union(
  v.literal("free"),
  v.literal("starter"),
  v.literal("pro"),
);

export const formAnswerValidator = v.object({
  formVersionFieldId: v.id("formVersionFields"),
  value: nullableCellValueValidator,
});

export const formQuestionModeValidator = v.union(
  v.literal("visible"),
  v.literal("hidden"),
);

export const formConditionOperatorValidator = v.union(
  v.literal("is"),
  v.literal("is_not"),
  v.literal("contains"),
  v.literal("does_not_contain"),
  v.literal("is_empty"),
  v.literal("is_not_empty"),
  v.literal("is_checked"),
  v.literal("is_not_checked"),
  v.literal("greater_than"),
  v.literal("greater_than_or_equal"),
  v.literal("less_than"),
  v.literal("less_than_or_equal"),
  v.literal("before"),
  v.literal("on_or_before"),
  v.literal("after"),
  v.literal("on_or_after"),
);

export const formConditionValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
  v.null(),
);

export const formDraftVisibilityRuleValidator = v.object({
  conjunction: v.union(v.literal("and"), v.literal("or")),
  conditions: v.array(
    v.object({
      id: v.string(),
      sourceFieldId: v.id("fields"),
      operator: formConditionOperatorValidator,
      value: v.optional(formConditionValueValidator),
    }),
  ),
});

export const formVersionVisibilityRuleValidator = v.object({
  conjunction: v.union(v.literal("and"), v.literal("or")),
  conditions: v.array(
    v.object({
      id: v.string(),
      sourceQuestionId: v.id("formVersionFields"),
      sourceFieldId: v.id("fields"),
      operator: formConditionOperatorValidator,
      value: v.optional(formConditionValueValidator),
    }),
  ),
});

export const aiEditValidator = v.object({
  recordId: v.id("records"),
  fieldId: v.id("fields"),
  value: nullableCellValueValidator,
  expectedRevision: v.number(),
});
