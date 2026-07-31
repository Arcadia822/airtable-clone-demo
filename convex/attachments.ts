import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { attachmentBytes } from "./lib/aggregates";
import { requireOrgIdentity } from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import {
  hasActiveFormParents,
  requireField,
  requireRecord,
  requireTable,
} from "./lib/data";
import {
  MAX_ATTACHMENTS_PER_CELL,
  MAX_FILE_BYTES,
  MAX_PUBLIC_UPLOADS_PER_SUBMISSION,
  PLAN_LIMITS,
  UPLOAD_SESSION_TTL_MS,
} from "./lib/quotas";
import { rateLimiter } from "./lib/rateLimits";
import { planTierValidator } from "./lib/validators";
import { recordTableViewChange } from "./lib/viewChanges";

const finalizeResultValidator = v.object({
  ok: v.boolean(),
  attachmentId: v.optional(v.id("attachments")),
  error: v.optional(v.string()),
});

const attachmentMetadataValidator = v.object({
  id: v.id("attachments"),
  recordId: v.id("records"),
  fieldId: v.id("fields"),
  name: v.string(),
  mimeType: v.string(),
  size: v.number(),
  url: v.union(v.string(), v.null()),
});

const MAX_ATTACHMENT_METADATA_BATCH = 1_000;
const ORPHAN_STORAGE_JOB = "orphan-storage";
const ORPHAN_STORAGE_PAGE_SIZE = 250;
const ORPHAN_STORAGE_GRACE_MS = 2 * UPLOAD_SESSION_TTL_MS;

function validFileName(value: string): string | null {
  const name = value.trim().replace(/[/\\]/g, "-");
  if (!name || name.length > 255) {
    return null;
  }
  return name;
}

function acceptsContentType(
  field: { config: { attachmentKind?: string; acceptedMimeTypes?: string[] } },
  contentType: string,
): boolean {
  if (
    field.config.attachmentKind === "image" &&
    !contentType.startsWith("image/")
  ) {
    return false;
  }
  if (
    field.config.attachmentKind === "file" &&
    contentType.startsWith("image/")
  ) {
    return false;
  }
  const accepted = field.config.acceptedMimeTypes ?? [];
  return (
    accepted.length === 0 ||
    accepted.some((entry) => {
      const normalized = entry.toLowerCase();
      if (normalized.endsWith("/*")) {
        return contentType.startsWith(normalized.slice(0, -1));
      }
      return contentType === normalized;
    })
  );
}

export const createUploadSession = mutation({
  args: {
    recordId: v.id("records"),
    fieldId: v.id("fields"),
  },
  returns: v.object({
    uploadSessionId: v.id("uploadSessions"),
    uploadUrl: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const record = await requireRecord(ctx, identity.orgId, args.recordId);
    const field = await requireField(ctx, identity.orgId, args.fieldId);
    if (field.tableId !== record.tableId || field.type !== "attachment") {
      throw new ConvexError({ code: "INVALID_ATTACHMENT_FIELD" });
    }
    const current = record.values[field._id];
    if (Array.isArray(current) && current.length >= MAX_ATTACHMENTS_PER_CELL) {
      throw new ConvexError({ code: "ATTACHMENT_CELL_FULL" });
    }
    const expiresAt = Date.now() + UPLOAD_SESSION_TTL_MS;
    const uploadSessionId = await ctx.db.insert("uploadSessions", {
      orgId: identity.orgId,
      ownerUserId: identity.userId,
      fieldId: field._id,
      recordId: record._id,
      status: "pending",
      expiresAt,
      createdAt: Date.now(),
    });
    return {
      uploadSessionId,
      uploadUrl: await ctx.storage.generateUploadUrl(),
      expiresAt,
    };
  },
});

export const createPublicUploadSession = internalMutation({
  args: {
    submissionSessionId: v.id("publicSubmissionSessions"),
    formVersionFieldId: v.id("formVersionFields"),
    proofHash: v.string(),
  },
  returns: v.object({
    uploadSessionId: v.id("uploadSessions"),
    uploadUrl: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const submissionSession = await ctx.db.get(args.submissionSessionId);
    if (
      !submissionSession ||
      submissionSession.proofHash !== args.proofHash ||
      submissionSession.status !== "active" ||
      submissionSession.expiresAt < Date.now()
    ) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    const form = await ctx.db.get(submissionSession.formId);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== submissionSession.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    const mapping = await ctx.db.get(args.formVersionFieldId);
    if (
      !mapping ||
      mapping.formVersionId !== submissionSession.formVersionId ||
      mapping.targetFieldType !== "attachment"
    ) {
      throw new ConvexError({ code: "INVALID_ATTACHMENT_QUESTION" });
    }
    await rateLimiter.limit(ctx, "publicUpload", {
      key: args.submissionSessionId,
      throws: true,
    });
    await rateLimiter.limit(ctx, "publicUploadByForm", {
      key: form._id,
      throws: true,
    });
    const totalUploads = await ctx.db
      .query("uploadSessions")
      .withIndex("by_public_submission_session", (q) =>
        q.eq("publicSubmissionSessionId", args.submissionSessionId),
      )
      .take(MAX_PUBLIC_UPLOADS_PER_SUBMISSION + 1);
    if (totalUploads.length >= MAX_PUBLIC_UPLOADS_PER_SUBMISSION) {
      throw new ConvexError({ code: "PUBLIC_UPLOAD_LIMIT_EXCEEDED" });
    }
    const fieldUploads = await ctx.db
      .query("uploadSessions")
      .withIndex("by_public_submission_session_and_field", (q) =>
        q
          .eq("publicSubmissionSessionId", args.submissionSessionId)
          .eq("fieldId", mapping.targetFieldId),
      )
      .take(MAX_ATTACHMENTS_PER_CELL + 1);
    if (fieldUploads.length >= MAX_ATTACHMENTS_PER_CELL) {
      throw new ConvexError({ code: "ATTACHMENT_CELL_FULL" });
    }
    const expiresAt = Date.now() + UPLOAD_SESSION_TTL_MS;
    const uploadSessionId = await ctx.db.insert("uploadSessions", {
      orgId: form.orgId,
      formId: form._id,
      formVersionId: submissionSession.formVersionId,
      publicSubmissionSessionId: args.submissionSessionId,
      fieldId: mapping.targetFieldId,
      status: "pending",
      expiresAt,
      turnstileVerifiedAt: Date.now(),
      createdAt: Date.now(),
    });
    return {
      uploadSessionId,
      uploadUrl: await ctx.storage.generateUploadUrl(),
      expiresAt,
    };
  },
});

async function finalizeUpload(
  ctx: MutationCtx,
  input: {
    uploadSessionId: Id<"uploadSessions">;
    storageId: Id<"_storage">;
    fileName: string;
    plan: "free" | "starter" | "pro";
    actorType: "user" | "public_form";
    actorId: string;
  },
): Promise<{
  ok: boolean;
  attachmentId?: Id<"attachments">;
  error?: string;
}> {
  const upload = await ctx.db.get(input.uploadSessionId);
  if (!upload || !("fieldId" in upload) || upload.status !== "pending") {
    throw new ConvexError({ code: "UPLOAD_SESSION_NOT_FOUND" });
  }
  if (upload.expiresAt < Date.now()) {
    await ctx.storage.delete(input.storageId);
    await ctx.db.patch(upload._id, { status: "expired" });
    return { ok: false, error: "UPLOAD_SESSION_EXPIRED" };
  }
  const metadata = await ctx.storage.getMetadata(input.storageId);
  if (!metadata) {
    return { ok: false, error: "UPLOAD_NOT_FOUND" };
  }
  const existingAttachment = await ctx.db
    .query("attachments")
    .withIndex("by_storage_id", (q) =>
      q.eq("storageId", input.storageId),
    )
    .unique();
  if (existingAttachment) {
    return { ok: false, error: "STORAGE_ALREADY_CLAIMED" };
  }
  if (metadata.size > MAX_FILE_BYTES) {
    await ctx.storage.delete(input.storageId);
    await ctx.db.patch(upload._id, { status: "expired" });
    return { ok: false, error: "FILE_TOO_LARGE" };
  }
  const field = await ctx.db.get(upload.fieldId);
  if (!field || field.status !== "active" || field.type !== "attachment") {
    await ctx.storage.delete(input.storageId);
    await ctx.db.patch(upload._id, { status: "expired" });
    return { ok: false, error: "ATTACHMENT_FIELD_UNAVAILABLE" };
  }
  const fileName = validFileName(input.fileName);
  const contentType = (
    metadata.contentType ?? "application/octet-stream"
  ).toLowerCase();
  if (!fileName || !acceptsContentType(field, contentType)) {
    await ctx.storage.delete(input.storageId);
    await ctx.db.patch(upload._id, { status: "expired" });
    return {
      ok: false,
      error: fileName ? "FILE_TYPE_NOT_ALLOWED" : "INVALID_FILE_NAME",
    };
  }
  const usedBytes = await attachmentBytes.sum(ctx, {
    namespace: upload.orgId,
  });
  if (usedBytes + metadata.size > PLAN_LIMITS[input.plan].storageBytes) {
    await ctx.storage.delete(input.storageId);
    await ctx.db.patch(upload._id, { status: "expired" });
    return { ok: false, error: "STORAGE_QUOTA_EXCEEDED" };
  }

  const attachmentId = await ctx.db.insert("attachments", {
    orgId: upload.orgId,
    baseId: field.baseId,
    tableId: field.tableId,
    fieldId: field._id,
    recordId: upload.recordId,
    formId: upload.formId,
    uploadSessionId: upload._id,
    storageId: input.storageId,
    fileName,
    contentType,
    size: metadata.size,
    status: upload.recordId ? "attached" : "staged",
    createdByType: input.actorType,
    createdById: input.actorId,
    createdAt: Date.now(),
  });
  const attachment = await ctx.db.get(attachmentId);
  await attachmentBytes.insert(ctx, attachment!);
  await ctx.db.patch(upload._id, {
    status: upload.recordId ? "claimed" : "uploaded",
    storageId: input.storageId,
    attachmentId,
  });

  if (upload.recordId) {
    const record = await ctx.db.get(upload.recordId);
    if (!record || record.status !== "active") {
      throw new ConvexError({ code: "RECORD_NOT_FOUND" });
    }
    const current = record.values[field._id];
    const ids = Array.isArray(current) ? [...current] : [];
    if (ids.length >= MAX_ATTACHMENTS_PER_CELL) {
      throw new ConvexError({ code: "ATTACHMENT_CELL_FULL" });
    }
    ids.push(attachmentId);
    await ctx.db.patch(record._id, {
      values: { ...record.values, [field._id]: ids },
      revision: record.revision + 1,
      updatedByType: input.actorType,
      updatedById: input.actorId,
      updatedAt: Date.now(),
    });
    await recordTableViewChange(ctx, {
      orgId: upload.orgId,
      baseId: record.baseId,
      tableId: record.tableId,
      recordIds: [record._id],
    });
    await writeAudit(ctx, {
      orgId: upload.orgId,
      actor: { type: input.actorType, id: input.actorId },
      action: "record.attachment_added",
      resourceType: "record",
      resourceId: record._id,
      baseId: record.baseId,
      tableId: record.tableId,
      changedFieldIds: [field._id],
      revisionBefore: record.revision,
      revisionAfter: record.revision + 1,
    });
  }
  await writeAudit(ctx, {
    orgId: upload.orgId,
    actor: { type: input.actorType, id: input.actorId },
    action: "attachment.created",
    resourceType: "attachment",
    resourceId: attachmentId,
    baseId: field.baseId,
    tableId: field.tableId,
    changedFieldIds: [field._id],
  });
  return { ok: true, attachmentId };
}

export const finalizeUploadSession = mutation({
  args: {
    uploadSessionId: v.id("uploadSessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  returns: finalizeResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const upload = await ctx.db.get(args.uploadSessionId);
    if (
      !upload ||
      upload.orgId !== identity.orgId ||
      upload.ownerUserId !== identity.userId
    ) {
      throw new ConvexError({ code: "UPLOAD_SESSION_NOT_FOUND" });
    }
    return await finalizeUpload(ctx, {
      ...args,
      plan: identity.plan,
      actorType: "user",
      actorId: identity.userId,
    });
  },
});

export const getPublicUploadContext = internalQuery({
  args: {
    uploadSessionId: v.id("uploadSessions"),
    proofHash: v.string(),
  },
  returns: v.object({
    orgId: v.string(),
    formId: v.id("forms"),
    submissionSessionId: v.id("publicSubmissionSessions"),
    planAtStart: planTierValidator,
  }),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadSessionId);
    if (
      !upload ||
      !upload.formId ||
      !upload.publicSubmissionSessionId ||
      upload.status !== "pending" ||
      upload.expiresAt < Date.now()
    ) {
      throw new ConvexError({ code: "UPLOAD_SESSION_NOT_FOUND" });
    }
    const submissionSession = await ctx.db.get(
      upload.publicSubmissionSessionId,
    );
    if (
      !submissionSession ||
      submissionSession.proofHash !== args.proofHash ||
      submissionSession.status !== "active" ||
      submissionSession.expiresAt < Date.now()
    ) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    const form = await ctx.db.get(upload.formId);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== upload.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    return {
      orgId: upload.orgId,
      formId: upload.formId,
      submissionSessionId: submissionSession._id,
      planAtStart: submissionSession.planAtStart,
    };
  },
});

export const finalizePublicUpload = internalMutation({
  args: {
    uploadSessionId: v.id("uploadSessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    plan: planTierValidator,
    proofHash: v.string(),
  },
  returns: finalizeResultValidator,
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadSessionId);
    if (
      !upload ||
      !upload.formId ||
      !upload.publicSubmissionSessionId
    ) {
      throw new ConvexError({ code: "UPLOAD_SESSION_NOT_FOUND" });
    }
    const submissionSession = await ctx.db.get(
      upload.publicSubmissionSessionId,
    );
    if (
      !submissionSession ||
      submissionSession.proofHash !== args.proofHash ||
      submissionSession.status !== "active" ||
      submissionSession.expiresAt < Date.now()
    ) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    const form = await ctx.db.get(upload.formId);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== upload.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    return await finalizeUpload(ctx, {
      ...args,
      actorType: "public_form",
      actorId: upload.formId,
    });
  },
});

export const getDownloadUrl = query({
  args: { attachmentId: v.id("attachments") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.orgId !== identity.orgId) {
      throw new ConvexError({ code: "ATTACHMENT_NOT_FOUND" });
    }
    if (attachment.recordId) {
      await requireRecord(ctx, identity.orgId, attachment.recordId, true);
    }
    return await ctx.storage.getUrl(attachment.storageId);
  },
});

export const resolveMetadata = query({
  args: {
    tableId: v.id("tables"),
    attachmentIds: v.array(v.id("attachments")),
  },
  returns: v.array(attachmentMetadataValidator),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);

    const uniqueIds = [...new Set(args.attachmentIds)];
    if (uniqueIds.length > MAX_ATTACHMENT_METADATA_BATCH) {
      throw new ConvexError({
        code: "ATTACHMENT_METADATA_BATCH_TOO_LARGE",
        limit: MAX_ATTACHMENT_METADATA_BATCH,
      });
    }

    const resolved = await Promise.all(
      uniqueIds.map(async (attachmentId) => {
        const attachment = await ctx.db.get(attachmentId);
        if (
          !attachment ||
          attachment.orgId !== identity.orgId ||
          attachment.tableId !== args.tableId ||
          attachment.status !== "attached" ||
          !attachment.recordId
        ) {
          return null;
        }
        return {
          id: attachment._id,
          recordId: attachment.recordId,
          fieldId: attachment.fieldId,
          name: attachment.fileName,
          mimeType: attachment.contentType,
          size: attachment.size,
          url: await ctx.storage.getUrl(attachment.storageId),
        };
      }),
    );

    return resolved.filter(
      (attachment): attachment is NonNullable<typeof attachment> =>
        attachment !== null,
    );
  },
});

export const remove = mutation({
  args: { attachmentId: v.id("attachments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.orgId !== identity.orgId) {
      throw new ConvexError({ code: "ATTACHMENT_NOT_FOUND" });
    }
    if (attachment.recordId) {
      const record = await requireRecord(
        ctx,
        identity.orgId,
        attachment.recordId,
      );
      const current = record.values[attachment.fieldId];
      const ids = Array.isArray(current)
        ? current.filter((id) => id !== attachment._id)
        : [];
      const values = { ...record.values };
      if (ids.length === 0) delete values[attachment.fieldId];
      else values[attachment.fieldId] = ids;
      await ctx.db.patch(record._id, {
        values,
        revision: record.revision + 1,
        updatedByType: "user",
        updatedById: identity.userId,
        updatedAt: Date.now(),
      });
      await recordTableViewChange(ctx, {
        orgId: identity.orgId,
        baseId: record.baseId,
        tableId: record.tableId,
        recordIds: [record._id],
      });
    }
    await attachmentBytes.delete(ctx, attachment);
    await ctx.storage.delete(attachment.storageId);
    await ctx.db.delete(attachment._id);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "attachment.deleted",
      resourceType: "attachment",
      resourceId: args.attachmentId,
      baseId: attachment.baseId,
      tableId: attachment.tableId,
      changedFieldIds: [attachment.fieldId],
    });
    return null;
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("uploadSessions")
      .withIndex("by_status_and_expires_at", (q) =>
        q.eq("status", "pending").lt("expiresAt", now),
      )
      .take(50);
    const uploaded = await ctx.db
      .query("uploadSessions")
      .withIndex("by_status_and_expires_at", (q) =>
        q.eq("status", "uploaded").lt("expiresAt", now),
      )
      .take(Math.max(0, 50 - pending.length));
    for (const upload of [...pending, ...uploaded]) {
      if (upload.attachmentId) {
        const attachment = await ctx.db.get(upload.attachmentId);
        if (attachment) {
          await attachmentBytes.delete(ctx, attachment);
          await ctx.storage.delete(attachment.storageId);
          await ctx.db.delete(attachment._id);
        }
      } else if (upload.storageId) {
        await ctx.storage.delete(upload.storageId);
      }
      await ctx.db.patch(upload._id, { status: "expired" });
    }
    return pending.length + uploaded.length;
  },
});

async function isStorageReferenced(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const [
    attachment,
    formLogo,
    formCover,
    versionLogo,
    versionCover,
  ] = await Promise.all([
    ctx.db
      .query("attachments")
      .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
      .first(),
    ctx.db
      .query("forms")
      .withIndex("by_logo_storage_id", (q) =>
        q.eq("appearance.logoStorageId", storageId),
      )
      .first(),
    ctx.db
      .query("forms")
      .withIndex("by_cover_storage_id", (q) =>
        q.eq("appearance.coverStorageId", storageId),
      )
      .first(),
    ctx.db
      .query("formVersions")
      .withIndex("by_logo_storage_id", (q) =>
        q.eq("appearance.logoStorageId", storageId),
      )
      .first(),
    ctx.db
      .query("formVersions")
      .withIndex("by_cover_storage_id", (q) =>
        q.eq("appearance.coverStorageId", storageId),
      )
      .first(),
  ]);
  return Boolean(
    attachment || formLogo || formCover || versionLogo || versionCover,
  );
}

export const cleanupOrphanedStorage = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    cycleComplete: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const state = await ctx.db
      .query("storageCleanupState")
      .withIndex("by_job", (q) => q.eq("job", ORPHAN_STORAGE_JOB))
      .unique();
    const continuing = state?.cursor !== null && state?.cursor !== undefined;
    const scannedBefore = continuing ? state.scannedInCycle : 0;
    const deletedBefore = continuing ? state.deletedInCycle : 0;
    const cycleStartedAt = continuing ? state.cycleStartedAt : now;
    const page = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({
        cursor: state?.cursor ?? null,
        numItems: ORPHAN_STORAGE_PAGE_SIZE,
        maximumRowsRead: ORPHAN_STORAGE_PAGE_SIZE,
        maximumBytesRead: 1024 * 1024,
      });

    let deleted = 0;
    const cutoff = now - ORPHAN_STORAGE_GRACE_MS;
    for (const blob of page.page) {
      if (blob._creationTime > cutoff) continue;
      if (await isStorageReferenced(ctx, blob._id)) continue;
      await ctx.storage.delete(blob._id);
      deleted += 1;
    }

    const scannedInCycle = scannedBefore + page.page.length;
    const deletedInCycle = deletedBefore + deleted;
    const patch = {
      cursor: page.isDone ? null : page.continueCursor,
      scannedInCycle,
      deletedInCycle,
      cycleStartedAt,
      updatedAt: now,
      ...(page.isDone ? { lastCompletedAt: now } : {}),
    };
    if (state) {
      await ctx.db.patch(state._id, patch);
    } else {
      await ctx.db.insert("storageCleanupState", {
        job: ORPHAN_STORAGE_JOB,
        ...patch,
      });
    }
    return {
      scanned: scannedInCycle,
      deleted: deletedInCycle,
      cycleComplete: page.isDone,
    };
  },
});
