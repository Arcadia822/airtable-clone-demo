import { and, eq } from "drizzle-orm"
import { generateKeyBetween } from "jittered-fractional-indexing"
import { nanoid } from "nanoid"

import {
  bases,
  fields,
  fieldSequences,
  formDraftFields,
  forms,
  formVersionFields,
  formVersions,
  records,
  tables,
  views,
} from "../../drizzle/schema"
import type { AppDb } from "@/db/client"
import type { FieldDefinition } from "@/lib/domain"
import { buildRecordSearchText } from "@/server/search-text"

export async function ensureSeededBase(
  db: AppDb,
  orgId: string,
  userId: string,
): Promise<{ baseId: string; tableId: string; seeded: boolean }> {
  const existingBases = await db
    .select({ id: bases.id })
    .from(bases)
    .where(and(eq(bases.orgId, orgId), eq(bases.status, "active")))
    .limit(1)

  if (existingBases.length > 0) {
    const existingTables = await db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.baseId, existingBases[0].id), eq(tables.status, "active")))
      .limit(1)

    return {
      baseId: existingBases[0].id,
      tableId: existingTables[0]?.id ?? "",
      seeded: false,
    }
  }

  const baseId = `base_${nanoid(10)}`
  const tableId = `tbl_${nanoid(10)}`

  await db.insert(bases).values({
    id: baseId,
    orgId,
    name: "Product Workspace",
    description: "Track product launches, milestones, budgets, and team deliverables.",
    color: "#2563eb",
    rank: "a0",
    status: "active",
    createdBy: userId,
  })

  await db.insert(tables).values({
    id: tableId,
    orgId,
    baseId,
    name: "Project Tracker",
    description: "Cross-functional roadmap with status, timeline, budget, and assets.",
    rank: "a0",
    status: "active",
  })

  const fTitleId = `fld_${nanoid(10)}`
  const fAutoId = `fld_${nanoid(10)}`
  const fStatusId = `fld_${nanoid(10)}`
  const fPriorityId = `fld_${nanoid(10)}`
  const fBudgetId = `fld_${nanoid(10)}`
  const fProgressId = `fld_${nanoid(10)}`
  const fStartDateId = `fld_${nanoid(10)}`
  const fEndDateId = `fld_${nanoid(10)}`
  const fCoverId = `fld_${nanoid(10)}`
  const fAttachmentId = `fld_${nanoid(10)}`

  const fieldRows: Array<{
    id: string
    name: string
    type: FieldDefinition["type"]
    config: Record<string, unknown>
    rank: string
    width: number
    isPrimary: boolean
    frozen: boolean
  }> = [
    {
      id: fTitleId,
      name: "Project Name",
      type: "singleLineText",
      config: {},
      rank: "a0",
      width: 240,
      isPrimary: true,
      frozen: true,
    },
    {
      id: fAutoId,
      name: "ID",
      type: "autoNumber",
      config: {},
      rank: "a1",
      width: 80,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fStatusId,
      name: "Status",
      type: "singleSelect",
      config: {
        options: [
          { id: "opt_backlog", label: "Backlog", color: "#64748b" },
          { id: "opt_in_progress", label: "In Progress", color: "#2563eb" },
          { id: "opt_review", label: "In Review", color: "#d97706" },
          { id: "opt_done", label: "Launched", color: "#059669" },
        ],
      },
      rank: "a2",
      width: 150,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fPriorityId,
      name: "Priority",
      type: "number",
      config: { precision: 0, min: 1, max: 5 },
      rank: "a3",
      width: 110,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fBudgetId,
      name: "Budget",
      type: "currency",
      config: { currency: "USD", precision: 0 },
      rank: "a4",
      width: 140,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fProgressId,
      name: "Completion",
      type: "percent",
      config: { precision: 0 },
      rank: "a5",
      width: 120,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fStartDateId,
      name: "Start Date",
      type: "date",
      config: { dateStyle: "date" },
      rank: "a6",
      width: 140,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fEndDateId,
      name: "End Date",
      type: "date",
      config: { dateStyle: "date" },
      rank: "a7",
      width: 140,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fCoverId,
      name: "Cover Image",
      type: "image",
      config: { attachmentKind: "image" },
      rank: "a8",
      width: 160,
      isPrimary: false,
      frozen: false,
    },
    {
      id: fAttachmentId,
      name: "Brief & Specs",
      type: "attachment",
      config: { attachmentKind: "any" },
      rank: "a9",
      width: 180,
      isPrimary: false,
      frozen: false,
    },
  ]

  await db.insert(fields).values(
    fieldRows.map((f) => ({
      ...f,
      orgId,
      tableId,
      status: "active",
    })),
  )

  const sampleRecords: Array<Record<string, unknown>> = [
    {
      [fTitleId]: "Q4 Mobile Onboarding Redesign",
      [fAutoId]: 1,
      [fStatusId]: "opt_in_progress",
      [fPriorityId]: 1,
      [fBudgetId]: 48000,
      [fProgressId]: 65,
      [fStartDateId]: "2026-11-02",
      [fEndDateId]: "2026-11-24",
    },
    {
      [fTitleId]: "Enterprise SSO & Audit Logs",
      [fAutoId]: 2,
      [fStatusId]: "opt_review",
      [fPriorityId]: 1,
      [fBudgetId]: 72000,
      [fProgressId]: 90,
      [fStartDateId]: "2026-10-15",
      [fEndDateId]: "2026-11-20",
    },
    {
      [fTitleId]: "Self-Serve Analytics Dashboard",
      [fAutoId]: 3,
      [fStatusId]: "opt_done",
      [fPriorityId]: 2,
      [fBudgetId]: 36000,
      [fProgressId]: 100,
      [fStartDateId]: "2026-10-01",
      [fEndDateId]: "2026-11-05",
    },
    {
      [fTitleId]: "AI Table Builder & Copilots",
      [fAutoId]: 4,
      [fStatusId]: "opt_in_progress",
      [fPriorityId]: 1,
      [fBudgetId]: 95000,
      [fProgressId]: 45,
      [fStartDateId]: "2026-11-10",
      [fEndDateId]: "2026-12-12",
    },
    {
      [fTitleId]: "Public Intake Forms v2",
      [fAutoId]: 5,
      [fStatusId]: "opt_backlog",
      [fPriorityId]: 3,
      [fBudgetId]: 24000,
      [fProgressId]: 10,
      [fStartDateId]: "2026-11-25",
      [fEndDateId]: "2026-12-18",
    },
    {
      [fTitleId]: "Billing & Usage Metering",
      [fAutoId]: 6,
      [fStatusId]: "opt_done",
      [fPriorityId]: 2,
      [fBudgetId]: 54000,
      [fProgressId]: 100,
      [fStartDateId]: "2026-09-20",
      [fEndDateId]: "2026-10-28",
    },
  ]

  await db.insert(fieldSequences).values({
    fieldId: fAutoId,
    tableId,
    nextValue: sampleRecords.length + 1,
  })

  // Fractional keys sort lexicographically at any length; `a10` would sort
  // before `a2`, so append with generateKeyBetween instead of raw indices.
  const ranks: string[] = []
  for (let index = 0; index < sampleRecords.length; index += 1) {
    ranks.push(generateKeyBetween(ranks[index - 1] ?? null, null))
  }

  await db.insert(records).values(
    sampleRecords.map((values, index) => ({
      id: `rec_${nanoid(10)}`,
      orgId,
      tableId,
      rank: ranks[index],
      values,
      searchText: buildRecordSearchText(values, fieldRows),
      revision: 1,
      status: "active",
      createdBy: userId,
      updatedBy: userId,
    })),
  )

  await db.insert(views).values([
    {
      id: `viw_${nanoid(10)}`,
      orgId,
      tableId,
      name: "All Projects",
      type: "grid",
      isDefault: true,
      rank: "a0",
      configuration: { rowHeight: "short" },
    },
    {
      id: `viw_${nanoid(10)}`,
      orgId,
      tableId,
      name: "Status Board",
      type: "kanban",
      isDefault: false,
      rank: "a1",
      configuration: {
        kanbanFieldId: fStatusId,
        kanbanSummaryFieldIds: [fBudgetId, fEndDateId],
      },
    },
    {
      id: `viw_${nanoid(10)}`,
      orgId,
      tableId,
      name: "Roadmap Timeline",
      type: "timeline",
      isDefault: false,
      rank: "a2",
      configuration: {
        timelineStartFieldId: fStartDateId,
        timelineEndFieldId: fEndDateId,
        timelineGroupFieldId: fStatusId,
        timelineScale: "week",
      },
    },
    {
      id: `viw_${nanoid(10)}`,
      orgId,
      tableId,
      name: "Launch Calendar",
      type: "calendar",
      isDefault: false,
      rank: "a3",
      configuration: {
        calendarDateFieldId: fEndDateId,
        calendarDisplay: "month",
      },
    },
    {
      id: `viw_${nanoid(10)}`,
      orgId,
      tableId,
      name: "Executive Dashboard",
      type: "dashboard",
      isDefault: false,
      rank: "a4",
      configuration: {
        dashboardWidgets: [
          {
            id: "w_total",
            kind: "metric",
            title: "Total Projects",
            aggregate: "count",
            rank: "a0",
          },
          {
            id: "w_budget",
            kind: "metric",
            title: "Total Budget",
            fieldId: fBudgetId,
            aggregate: "sum",
            rank: "a1",
          },
          {
            id: "w_by_status",
            kind: "chart",
            title: "Projects by Status",
            groupByFieldId: fStatusId,
            aggregate: "count",
            chartType: "bar",
            rank: "a2",
          },
          {
            id: "w_budget_by_status",
            kind: "chart",
            title: "Budget by Status",
            fieldId: fBudgetId,
            groupByFieldId: fStatusId,
            aggregate: "sum",
            chartType: "pie",
            rank: "a3",
          },
        ],
      },
    },
  ])

  const formId = `frm_${nanoid(10)}`
  const versionId = `fver_${nanoid(10)}`
  const slug = `project-intake-${nanoid(6).toLowerCase()}`

  await db.insert(forms).values({
    id: formId,
    orgId,
    baseId,
    tableId,
    name: "Project Intake Form",
    description: "Submit a new project proposal to the Product Workspace.",
    slug,
    status: "published",
    publishedVersionId: versionId,
    settings: { allowMultipleSubmissions: true },
    theme: { accentColor: "#2563eb" },
    thankYou: {
      title: "Proposal received",
      message: "Your project has been added to the Project Tracker.",
    },
    createdBy: userId,
  })

  const formFieldsSpec = [
    { targetFieldId: fTitleId, targetFieldType: "singleLineText", label: "Project Name", required: true, rank: "a0", config: {} },
    { targetFieldId: fStatusId, targetFieldType: "singleSelect", label: "Initial Status", required: false, rank: "a1", config: fieldRows[2].config },
    { targetFieldId: fBudgetId, targetFieldType: "currency", label: "Estimated Budget", required: false, rank: "a2", config: fieldRows[4].config },
    { targetFieldId: fStartDateId, targetFieldType: "date", label: "Target Start Date", required: false, rank: "a3", config: fieldRows[6].config },
  ]

  await db.insert(formDraftFields).values(
    formFieldsSpec.map((item) => ({
      id: `fdf_${nanoid(10)}`,
      orgId,
      formId,
      targetFieldId: item.targetFieldId,
      label: item.label,
      required: item.required,
      rank: item.rank,
    })),
  )

  await db.insert(formVersions).values({
    id: versionId,
    orgId,
    formId,
    versionNumber: 1,
    title: "Project Intake Form",
    description: "Submit a new project proposal to the Product Workspace.",
    settings: { allowMultipleSubmissions: true },
    theme: { accentColor: "#2563eb" },
    thankYou: {
      title: "Proposal received",
      message: "Your project has been added to the Project Tracker.",
    },
    publishedBy: userId,
  })

  await db.insert(formVersionFields).values(
    formFieldsSpec.map((item) => ({
      id: `fvf_${nanoid(10)}`,
      orgId,
      formVersionId: versionId,
      targetFieldId: item.targetFieldId,
      targetFieldType: item.targetFieldType,
      label: item.label,
      required: item.required,
      rank: item.rank,
      fieldConfig: item.config,
    })),
  )

  return { baseId, tableId, seeded: true }
}
