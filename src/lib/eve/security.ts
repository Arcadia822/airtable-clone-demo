const MAX_AGENT_STRING_LENGTH = 4_000;
const MAX_AGENT_ARRAY_LENGTH = 100;
const MAX_AGENT_DEPTH = 8;
const MAX_TOOL_INPUT_BYTES = 64_000;

const forbiddenAttachmentKeys = new Set([
  "attachmentid",
  "attachmentids",
  "base64",
  "binary",
  "bytes",
  "datauri",
  "downloadurl",
  "filecontent",
  "rawcontent",
  "signedurl",
  "storageid",
  "storageurl",
]);

function normalizedKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function assertSafeToolInput(input: unknown): void {
  const encoded = JSON.stringify(input);
  if (encoded.length > MAX_TOOL_INPUT_BYTES) {
    throw new Error("The proposed operation is too large. Split it into smaller changes.");
  }

  visitInput(input, 0);
}

function visitInput(value: unknown, depth: number): void {
  if (depth > MAX_AGENT_DEPTH) {
    throw new Error("The proposed operation is nested too deeply.");
  }

  if (typeof value === "string" && value.trimStart().startsWith("data:")) {
    throw new Error(
      "Attachment contents and internal attachment identifiers are not accepted by assistant tools.",
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visitInput(item, depth + 1);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenAttachmentKeys.has(normalizedKey(key))) {
        throw new Error(
          `Internal attachment identifier or content property "${key}" is not accepted.`,
        );
      }
      visitInput(child, depth + 1);
    }
  }
}

export function sanitizeAgentResult(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_AGENT_DEPTH) {
    return "[truncated: maximum nesting reached]";
  }

  if (typeof value === "string") {
    if (value.trimStart().startsWith("data:")) {
      return "[redacted attachment data]";
    }
    return value.length > MAX_AGENT_STRING_LENGTH
      ? `${value.slice(0, MAX_AGENT_STRING_LENGTH)}…`
      : value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const visible = value
      .slice(0, MAX_AGENT_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_AGENT_ARRAY_LENGTH) {
      visible.push(`[truncated: ${value.length - MAX_AGENT_ARRAY_LENGTH} more items]`);
    }
    return visible;
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenAttachmentKeys.has(normalizedKey(key))) {
        sanitized[key] = "[redacted attachment content]";
      } else {
        sanitized[key] = sanitizeValue(child, depth + 1);
      }
    }
    return sanitized;
  }

  return String(value);
}
