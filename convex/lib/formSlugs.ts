import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const MAX_FORM_SLUG_LENGTH = 64;
const MAX_FORM_SLUG_ATTEMPTS = 512;
const UUID_FORM_SLUG_PATTERN =
  /^form-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_TOKEN_PATTERN =
  /(?:^|-)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:-|$)/i;
const LEGACY_RANDOM_SUFFIX_PATTERN = /-[0-9a-f]{6}$/i;

type FormSlugReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type FormSlugWriteCtx = Pick<MutationCtx, "db">;

export function formSlugBase(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_FORM_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return normalized || "public-form";
}

async function currentFormForSlug(
  ctx: FormSlugReadCtx,
  slug: string,
): Promise<Doc<"forms"> | null> {
  return await ctx.db
    .query("forms")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

async function aliasForSlug(
  ctx: FormSlugReadCtx,
  slug: string,
): Promise<Doc<"formSlugAliases"> | null> {
  return await ctx.db
    .query("formSlugAliases")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

async function slugIsAvailable(
  ctx: FormSlugReadCtx,
  slug: string,
  excludedFormId?: Id<"forms">,
): Promise<boolean> {
  const [form, alias] = await Promise.all([
    currentFormForSlug(ctx, slug),
    aliasForSlug(ctx, slug),
  ]);
  return (
    (!form || form._id === excludedFormId) &&
    (!alias || alias.formId === excludedFormId)
  );
}

function suffixedSlug(base: string, sequence: number): string {
  const suffix = String(sequence);
  const prefix = base
    .slice(0, MAX_FORM_SLUG_LENGTH - suffix.length - 1)
    .replace(/-+$/g, "");
  return `${prefix || "public-form"}-${suffix}`;
}

export async function createFriendlyFormSlug(
  ctx: FormSlugReadCtx,
  name: string,
  excludedFormId?: Id<"forms">,
): Promise<string> {
  const base = formSlugBase(name);
  for (let attempt = 1; attempt <= MAX_FORM_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? base : suffixedSlug(base, attempt);
    if (await slugIsAvailable(ctx, candidate, excludedFormId)) {
      return candidate;
    }
  }
  throw new ConvexError({ code: "FORM_LINK_UNAVAILABLE" });
}

export async function resolveFormBySlug(
  ctx: FormSlugReadCtx,
  slug: string,
): Promise<Doc<"forms"> | null> {
  const current = await currentFormForSlug(ctx, slug);
  if (current) return current;

  const alias = await aliasForSlug(ctx, slug);
  if (!alias) return null;
  return await ctx.db.get(alias.formId);
}

export function formSlugContainsInternalKey(
  form: Pick<Doc<"forms">, "_id" | "baseId" | "tableId" | "slug">,
): boolean {
  const internalKeys = [
    String(form._id),
    String(form.baseId),
    String(form.tableId),
  ];
  return (
    UUID_FORM_SLUG_PATTERN.test(form.slug) ||
    UUID_TOKEN_PATTERN.test(form.slug) ||
    LEGACY_RANDOM_SUFFIX_PATTERN.test(form.slug) ||
    internalKeys.some((key) => form.slug.includes(key))
  );
}

export async function migrateOpaqueFormSlug(
  ctx: FormSlugWriteCtx,
  form: Doc<"forms">,
  name = form.name,
): Promise<{ changed: boolean; slug: string }> {
  if (!formSlugContainsInternalKey(form)) {
    return { changed: false, slug: form.slug };
  }

  const slug = await createFriendlyFormSlug(ctx, name, form._id);
  if (slug === form.slug) {
    return { changed: false, slug };
  }

  const existingAlias = await aliasForSlug(ctx, form.slug);
  if (existingAlias && existingAlias.formId !== form._id) {
    throw new ConvexError({ code: "FORM_LINK_UNAVAILABLE" });
  }
  if (!existingAlias) {
    await ctx.db.insert("formSlugAliases", {
      slug: form.slug,
      formId: form._id,
      orgId: form.orgId,
      createdAt: Date.now(),
    });
  }
  await ctx.db.patch(form._id, {
    slug,
    updatedAt: Date.now(),
  });
  return { changed: true, slug };
}
