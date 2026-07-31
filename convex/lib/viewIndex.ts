import type { Doc, Id } from "../_generated/dataModel";

type Field = Doc<"fields">;
type RecordDoc = Doc<"records">;
type View = Doc<"views">;
type Direction = "asc" | "desc";

export function viewNeedsMaterialization(
  view: Pick<View, "filters" | "sorts" | "groups">,
) {
  return (
    view.filters.length > 0 ||
    view.sorts.length > 0 ||
    view.groups.length > 0
  );
}

export function viewMaterializationHasGroupCounts(
  view: Pick<View, "groups">,
  materialization: Pick<
    Doc<"viewMaterializations">,
    "groupCountsReady"
  >,
) {
  return (
    view.groups.length === 0 ||
    materialization.groupCountsReady === true
  );
}

function orderedByRank<T extends { rank: string }>(
  values: readonly T[],
) {
  return [...values].sort((left, right) =>
    left.rank.localeCompare(right.rank),
  );
}

function fieldValue(record: RecordDoc, field: Field): unknown {
  const stored = record.values[field._id];
  if (stored !== undefined) return stored;
  if (field.type === "createdTime") return record._creationTime;
  if (field.type === "createdBy") return record.createdById;
  return undefined;
}

function isBlank(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase();
}

function finiteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function dateOnlyKey(value: unknown) {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)
  ) {
    return value.slice(0, 10);
  }
  const parsed = timestamp(value);
  if (parsed === undefined) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = normalizedText(value);
  if (["true", "checked", "yes", "1"].includes(normalized)) return true;
  if (["false", "unchecked", "no", "0"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function optionLabel(field: Field, optionId: string) {
  return field.config.options?.find((option) => option.id === optionId)
    ?.label;
}

function searchableTokens(field: Field, value: unknown): string[] {
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const optionIds = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : [];
    return optionIds.flatMap((optionId) => {
      const label = optionLabel(field, optionId);
      return label
        ? [normalizedText(optionId), normalizedText(label)]
        : [normalizedText(optionId)];
    });
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map(normalizedText);
  }
  return [normalizedText(value)];
}

function comparableText(field: Field, value: unknown) {
  if (field.type === "singleSelect" && typeof value === "string") {
    return optionLabel(field, value) ?? "Unavailable choice";
  }
  if (field.type === "multiSelect" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => optionLabel(field, item) ?? "Unavailable choice")
      .sort((left, right) => left.localeCompare(right))
      .join(", ");
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value ?? "");
}

function equalValue(field: Field, actual: unknown, expected: unknown) {
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const actualTokens = searchableTokens(field, actual);
    const expectedItems = Array.isArray(expected) ? expected : [expected];
    const expectedTokens = expectedItems.flatMap((item) =>
      searchableTokens(field, item),
    );
    return field.type === "multiSelect" && Array.isArray(expected)
      ? [...actualTokens].sort().join("\u0000") ===
          [...expectedTokens].sort().join("\u0000")
      : expectedTokens.some((token) => actualTokens.includes(token));
  }
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const left = finiteNumber(actual);
    const right = finiteNumber(expected);
    return left !== undefined && right !== undefined && left === right;
  }
  if (field.type === "checkbox") {
    const left = booleanValue(actual);
    const right = booleanValue(expected);
    return left !== undefined && right !== undefined && left === right;
  }
  if (field.type === "date" || field.type === "createdTime") {
    if (field.config.dateStyle !== "dateTime") {
      return (
        dateOnlyKey(actual) !== undefined &&
        dateOnlyKey(actual) === dateOnlyKey(expected)
      );
    }
    return (
      timestamp(actual) !== undefined &&
      timestamp(actual) === timestamp(expected)
    );
  }
  return normalizedText(actual) === normalizedText(expected);
}

function compareValue(field: Field, left: unknown, right: unknown) {
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const leftNumber = finiteNumber(left);
    const rightNumber = finiteNumber(right);
    if (leftNumber === undefined || rightNumber === undefined) {
      return undefined;
    }
    return leftNumber - rightNumber;
  }
  if (field.type === "date" || field.type === "createdTime") {
    const leftTime =
      field.config.dateStyle === "dateTime"
        ? timestamp(left)
        : dateOnlyKey(left);
    const rightTime =
      field.config.dateStyle === "dateTime"
        ? timestamp(right)
        : dateOnlyKey(right);
    if (leftTime === undefined || rightTime === undefined) return undefined;
    return typeof leftTime === "number"
      ? leftTime - (rightTime as number)
      : leftTime.localeCompare(rightTime as string);
  }
  if (field.type === "checkbox") {
    const leftBoolean = booleanValue(left);
    const rightBoolean = booleanValue(right);
    if (leftBoolean === undefined || rightBoolean === undefined) {
      return undefined;
    }
    return Number(leftBoolean) - Number(rightBoolean);
  }
  return comparableText(field, left).localeCompare(
    comparableText(field, right),
    "en",
    { numeric: true, sensitivity: "base" },
  );
}

function matchesFilter(
  record: RecordDoc,
  field: Field,
  filter: View["filters"][number],
) {
  const actual = fieldValue(record, field);
  if (filter.operator === "is_empty") return isBlank(actual);
  if (filter.operator === "is_not_empty") return !isBlank(actual);
  if (filter.operator === "is") {
    return equalValue(field, actual, filter.value);
  }
  if (filter.operator === "is_not") {
    return !equalValue(field, actual, filter.value);
  }
  if (
    filter.operator === "contains" ||
    filter.operator === "does_not_contain"
  ) {
    const expected = normalizedText(filter.value);
    const contains =
      expected.length > 0 &&
      searchableTokens(field, actual).some((token) =>
        token.includes(expected),
      );
    return filter.operator === "contains" ? contains : !contains;
  }
  const comparison = compareValue(field, actual, filter.value);
  if (comparison === undefined) return false;
  if (filter.operator === "greater_than" || filter.operator === "after") {
    return comparison > 0;
  }
  return comparison < 0;
}

function recordMatchesView(
  view: View,
  fieldsById: ReadonlyMap<Id<"fields">, Field>,
  record: RecordDoc,
) {
  if (!view.filters.length) return true;
  const matches = view.filters.flatMap((filter) => {
    const field = fieldsById.get(filter.fieldId);
    return field ? [matchesFilter(record, field, filter)] : [];
  });
  if (!matches.length) return true;
  return view.filterConjunction === "and"
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

function naturalText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\d+/g, (digits) =>
      digits.length <= 20
        ? digits.padStart(20, "0")
        : `${String(digits.length).padStart(6, "0")}${digits}`,
    );
}

function encodedText(value: string, direction: Direction) {
  const bytes = new TextEncoder().encode(naturalText(value));
  const encoded = Array.from(bytes, (byte) =>
    String(direction === "asc" ? byte + 1 : 256 - byte).padStart(3, "0"),
  ).join("");
  return `${encoded}${direction === "asc" ? "000" : "999"}`;
}

function encodedNumber(value: number, direction: Direction) {
  const buffer = new ArrayBuffer(8);
  const data = new DataView(buffer);
  data.setFloat64(0, value, false);
  const bits = data.getBigUint64(0, false);
  const sign = BigInt(1) << BigInt(63);
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1);
  const sortable =
    (bits & sign) === BigInt(0) ? bits ^ sign : (~bits) & mask;
  const encoded = sortable.toString(16).padStart(16, "0");
  if (direction === "asc") return encoded;
  return [...encoded]
    .map((character) => (15 - Number.parseInt(character, 16)).toString(16))
    .join("");
}

function orderSegment(field: Field, value: unknown, direction: Direction) {
  if (isBlank(value)) return "2";
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const numeric = finiteNumber(value);
    return numeric === undefined
      ? "2"
      : `0${encodedNumber(numeric, direction)}`;
  }
  if (field.type === "date" || field.type === "createdTime") {
    const numeric =
      field.config.dateStyle === "dateTime"
        ? timestamp(value)
        : timestamp(dateOnlyKey(value));
    return numeric === undefined
      ? "2"
      : `0${encodedNumber(numeric, direction)}`;
  }
  if (field.type === "checkbox") {
    const checked = booleanValue(value);
    return checked === undefined
      ? "2"
      : `0${encodedNumber(Number(checked), direction)}`;
  }
  return `0${encodedText(comparableText(field, value), direction)}`;
}

function friendlyGroupLabel(field: Field, value: unknown) {
  if (isBlank(value)) return "Empty";
  if (field.type === "checkbox") {
    return booleanValue(value) ? "Checked" : "Not checked";
  }
  if (field.type === "singleSelect" && typeof value === "string") {
    return optionLabel(field, value) ?? "Unavailable choice";
  }
  if (field.type === "multiSelect" && Array.isArray(value)) {
    const labels = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => optionLabel(field, item) ?? "Unavailable choice");
    return labels.length ? [...new Set(labels)].join(", ") : "Empty";
  }
  if (field.type === "date" || field.type === "createdTime") {
    return dateOnlyKey(value) ?? "Empty";
  }
  return comparableText(field, value).trim() || "Empty";
}

export function viewEntryForRecord(
  view: View,
  fields: readonly Field[],
  record: RecordDoc,
) {
  if (
    record.status !== "active" ||
    record.orgId !== view.orgId ||
    record.tableId !== view.tableId
  ) {
    return null;
  }
  const fieldsById = new Map(fields.map((field) => [field._id, field]));
  if (!recordMatchesView(view, fieldsById, record)) return null;

  const groupSegments: string[] = [];
  const groupLabels: string[] = [];
  for (const group of orderedByRank(view.groups)) {
    const field = fieldsById.get(group.fieldId);
    if (!field) continue;
    const value = fieldValue(record, field);
    groupSegments.push(orderSegment(field, value, group.direction));
    groupLabels.push(`${field.name}: ${friendlyGroupLabel(field, value)}`);
  }
  const sortSegments: string[] = [];
  for (const sort of orderedByRank(view.sorts)) {
    const field = fieldsById.get(sort.fieldId);
    if (!field) continue;
    sortSegments.push(
      orderSegment(field, fieldValue(record, field), sort.direction),
    );
  }
  const orderKey = [
    ...groupSegments,
    ...sortSegments,
    `0${encodedText(record.rank, "asc")}`,
    `0${encodedText(record._id, "asc")}`,
  ].join("|");
  return {
    orderKey,
    groupLabel: groupLabels.length
      ? groupLabels.join(" · ")
      : undefined,
  };
}
