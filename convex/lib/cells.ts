import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ConvexError, getConvexSize } from "convex/values";

import {
  MAX_ATTACHMENTS_PER_CELL,
  MAX_RECORD_VALUE_BYTES,
} from "./quotas";

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

function invalid(field: Doc<"fields">, reason: string): never {
  throw new ConvexError({
    code: "INVALID_CELL_VALUE",
    fieldId: field._id,
    fieldName: field.name,
    reason,
  });
}

function requireString(
  field: Doc<"fields">,
  value: unknown,
  defaultMax: number,
): string {
  if (typeof value !== "string") invalid(field, "Expected text.");
  const max = Math.min(field.config.maxLength ?? defaultMax, defaultMax);
  if (value.length > max) invalid(field, `Maximum length is ${max}.`);
  return value;
}

function activeOptionIds(field: Doc<"fields">): Set<string> {
  return new Set(
    (field.config.options ?? [])
      .filter((option) => !option.archived)
      .map((option) => option.id),
  );
}

export function validateFieldConfiguration(
  type: Doc<"fields">["type"],
  config: Doc<"fields">["config"],
): void {
  const maximumTextLength =
    type === "singleLineText"
      ? 10_000
      : type === "longText"
        ? 100_000
        : type === "email"
          ? 320
          : type === "phone"
            ? 64
            : type === "url"
              ? 2_048
              : 100_000;
  if (
    config.maxLength !== undefined &&
    (!Number.isInteger(config.maxLength) ||
      config.maxLength < 1 ||
      config.maxLength > maximumTextLength)
  ) {
    throw new ConvexError({ code: "INVALID_FIELD_CONFIG", key: "maxLength" });
  }
  if (
    config.precision !== undefined &&
    (!Number.isInteger(config.precision) ||
      config.precision < 0 ||
      config.precision > 12)
  ) {
    throw new ConvexError({ code: "INVALID_FIELD_CONFIG", key: "precision" });
  }
  if (
    (config.min !== undefined &&
      (!Number.isFinite(config.min) ||
        Math.abs(config.min) > Number.MAX_SAFE_INTEGER)) ||
    (config.max !== undefined &&
      (!Number.isFinite(config.max) ||
        Math.abs(config.max) > Number.MAX_SAFE_INTEGER))
  ) {
    throw new ConvexError({ code: "INVALID_FIELD_CONFIG", key: "range" });
  }
  if (
    config.min !== undefined &&
    config.max !== undefined &&
    config.min > config.max
  ) {
    throw new ConvexError({ code: "INVALID_FIELD_CONFIG", key: "min" });
  }
  if (
    type === "rating" &&
    ((config.precision !== undefined && config.precision !== 0) ||
      (config.min !== undefined && config.min < 1) ||
      (config.max !== undefined && config.max > 5))
  ) {
    throw new ConvexError({
      code: "INVALID_FIELD_CONFIG",
      key: "rating",
      message: "Ratings use whole numbers from 1 to 5.",
    });
  }
  if (type === "singleSelect" || type === "multiSelect") {
    const options = config.options ?? [];
    if (options.length > 250) {
      throw new ConvexError({
        code: "INVALID_FIELD_CONFIG",
        key: "options",
        message: "A select field supports at most 250 options.",
      });
    }
    const ids = new Set<string>();
    for (const option of options) {
      if (!option.id || !option.label.trim() || ids.has(option.id)) {
        throw new ConvexError({
          code: "INVALID_FIELD_CONFIG",
          key: "options",
        });
      }
      ids.add(option.id);
    }
  } else if (config.options !== undefined) {
    throw new ConvexError({
      code: "INVALID_FIELD_CONFIG",
      key: "options",
      message: "Only select fields may define options.",
    });
  }
}

export async function validateCellValue(
  ctx: ReadCtx,
  field: Doc<"fields">,
  value: unknown,
  options: {
    allowStagedAttachments?: boolean;
    recordId?: Id<"records">;
  } = {},
): Promise<void> {
  switch (field.type) {
    case "singleLineText":
      requireString(field, value, 10_000);
      return;
    case "longText":
      requireString(field, value, 100_000);
      return;
    case "email": {
      const email = requireString(field, value, 320);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        invalid(field, "Expected a valid email address.");
      }
      return;
    }
    case "url": {
      const url = requireString(field, value, 2_048);
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          invalid(field, "Only HTTP and HTTPS URLs are supported.");
        }
      } catch {
        invalid(field, "Expected a valid URL.");
      }
      return;
    }
    case "phone":
      requireString(field, value, 64);
      return;
    case "date": {
      if (typeof value === "number") {
        if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) {
          invalid(field, "Expected a valid timestamp.");
        }
        return;
      }
      const date = requireString(field, value, 64);
      if (Number.isNaN(Date.parse(date))) {
        invalid(field, "Expected an ISO date or timestamp.");
      }
      return;
    }
    case "number":
    case "currency":
    case "percent":
    case "rating":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        invalid(field, "Expected a finite number.");
      }
      if (
        field.type === "rating" &&
        (!Number.isInteger(value) || value < 1 || value > 5)
      ) {
        invalid(field, "Expected a whole-number rating from 1 to 5.");
      }
      if (field.config.min !== undefined && value < field.config.min) {
        invalid(field, `Minimum value is ${field.config.min}.`);
      }
      if (field.config.max !== undefined && value > field.config.max) {
        invalid(field, `Maximum value is ${field.config.max}.`);
      }
      return;
    case "checkbox":
      if (typeof value !== "boolean") invalid(field, "Expected true or false.");
      return;
    case "singleSelect": {
      if (typeof value !== "string" || !activeOptionIds(field).has(value)) {
        invalid(field, "Expected an active select option ID.");
      }
      return;
    }
    case "multiSelect": {
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string") ||
        new Set(value).size !== value.length
      ) {
        invalid(field, "Expected unique select option IDs.");
      }
      const optionsSet = activeOptionIds(field);
      if (value.some((item) => !optionsSet.has(item))) {
        invalid(field, "One or more select options are unavailable.");
      }
      return;
    }
    case "attachment": {
      if (
        !Array.isArray(value) ||
        value.length > MAX_ATTACHMENTS_PER_CELL ||
        value.some((item) => typeof item !== "string") ||
        new Set(value).size !== value.length
      ) {
        invalid(
          field,
          `Expected at most ${MAX_ATTACHMENTS_PER_CELL} attachment IDs.`,
        );
      }
      for (const attachmentId of value as Id<"attachments">[]) {
        const attachment = await ctx.db.get(attachmentId);
        if (
          !attachment ||
          attachment.orgId !== field.orgId ||
          attachment.fieldId !== field._id ||
          (attachment.status === "attached"
            ? !options.recordId || attachment.recordId !== options.recordId
            : !options.allowStagedAttachments)
        ) {
          invalid(field, "Attachment is unavailable for this field.");
        }
      }
      return;
    }
    case "createdTime":
    case "createdBy":
      invalid(field, "Derived fields are read-only.");
  }
}

export async function validateRecordValues(
  ctx: ReadCtx,
  orgId: string,
  tableId: Id<"tables">,
  values: Record<string, unknown>,
  options: {
    allowStagedAttachments?: boolean;
    recordId?: Id<"records">;
  } = {},
): Promise<Doc<"fields">[]> {
  if (
    getConvexSize(values as Doc<"records">["values"]) >
    MAX_RECORD_VALUE_BYTES
  ) {
    throw new ConvexError({
      code: "RECORD_TOO_LARGE",
      limitBytes: MAX_RECORD_VALUE_BYTES,
    });
  }

  const fields = await Promise.all(
    Object.keys(values).map(async (fieldId) => {
      const field = await ctx.db.get(fieldId as Id<"fields">);
      if (
        !field ||
        field.orgId !== orgId ||
        field.tableId !== tableId ||
        field.status !== "active"
      ) {
        throw new ConvexError({ code: "FIELD_NOT_FOUND", fieldId });
      }
      await validateCellValue(ctx, field, values[fieldId], options);
      return field;
    }),
  );

  return fields;
}
