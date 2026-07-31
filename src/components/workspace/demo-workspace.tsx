"use client"

import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import {
  DataGrid,
  type GridCellBatchFailure,
  type GridCellBatchResult,
  type GridCellBatchUpdate,
} from "@/components/grid/data-grid"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import { DEMO_TABLE_DATA, DEMO_TABLES } from "@/lib/demo-data"
import { moveItemToIndex } from "@/lib/column-interactions"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import { duplicateRecordValues } from "@/lib/record-workflows"
import { compareRanks } from "@/lib/rank"

type DemoTableData = {
  fields: FieldDefinition[]
  records: GridRecord[]
}

function rankAfter(fields: FieldDefinition[]): string {
  return `${fields.length.toString().padStart(4, "0")}`
}

function emptyTableData(tableId: string): DemoTableData {
  return {
    fields: [
      {
        id: `${tableId}:primary`,
        name: "Name",
        type: "singleLineText",
        config: {},
        rank: "0000",
        width: 260,
        isPrimary: true,
      },
    ],
    records: [],
  }
}

const initialTableData: Record<string, DemoTableData> = Object.fromEntries(
  DEMO_TABLES.map((table) => {
    const fixture = DEMO_TABLE_DATA[table.id]
    return [
      table.id,
      fixture
        ? {
            fields: [...fixture.fields],
            records: [...fixture.records],
          }
        : emptyTableData(table.id),
    ]
  }),
)

export function DemoWorkspace({
  initialAssistantOpen = false,
}: {
  initialAssistantOpen?: boolean
}) {
  const [assistantOpen, setAssistantOpen] = useState(initialAssistantOpen)
  const [tableData, setTableData] =
    useState<Record<string, DemoTableData>>(initialTableData)

  function updateTable(
    tableId: string,
    updater: (current: DemoTableData) => DemoTableData,
  ) {
    setTableData((current) => {
      const next = updater(current[tableId] ?? emptyTableData(tableId))
      return { ...current, [tableId]: next }
    })
  }

  return (
    <>
      <WorkspaceShell onOpenAssistant={() => setAssistantOpen(true)}>
        {({ activeTable }) => {
          const data =
            tableData[activeTable.id] ?? emptyTableData(activeTable.id)
          const setFields: Dispatch<SetStateAction<FieldDefinition[]>> = (
            value,
          ) =>
            updateTable(activeTable.id, (current) => ({
              ...current,
              fields:
                typeof value === "function" ? value(current.fields) : value,
            }))
          const setRecords: Dispatch<SetStateAction<GridRecord[]>> = (
            value,
          ) =>
            updateTable(activeTable.id, (current) => ({
              ...current,
              records:
                typeof value === "function" ? value(current.records) : value,
            }))

          return (
            <DemoTableGrid
              fields={data.fields}
              records={data.records}
              setFields={setFields}
              setRecords={setRecords}
            />
          )
        }}
      </WorkspaceShell>
      <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
        <SheetContent className="w-full p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="text-left">Basecraft AI</SheetTitle>
          </SheetHeader>
          <div className="flex h-[calc(100dvh-65px)] flex-col items-center justify-center p-8 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-indigo-600 text-white shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <h2 className="mt-5 font-semibold">AI assistant preview</h2>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              On Pro, the assistant can answer questions about this workspace
              and suggest edits. Nothing changes until you approve it.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DemoTableGrid({
  fields,
  records,
  setFields,
  setRecords,
}: {
  fields: FieldDefinition[]
  records: GridRecord[]
  setFields: Dispatch<SetStateAction<FieldDefinition[]>>
  setRecords: Dispatch<SetStateAction<GridRecord[]>>
}) {
  const [syncing, setSyncing] = useState(false)

  const simulateSync = useCallback(() => {
    setSyncing(true)
    window.setTimeout(() => setSyncing(false), 360)
  }, [])

  const updateCell = useCallback(
    (
      recordId: string,
      fieldId: string,
      value: CellValue,
      expectedRevision: number,
    ) => {
      setRecords((current) =>
        current.map((record) =>
          record.id === recordId && record.revision === expectedRevision
            ? {
                ...record,
                values: { ...record.values, [fieldId]: value },
                revision: record.revision + 1,
                updatedAt: Date.now(),
              }
            : record,
        ),
      )
      simulateSync()
    },
    [setRecords, simulateSync],
  )

  const addRecord = useCallback(() => {
    setRecords((current) => {
      const next: GridRecord = {
        id: `local_record_${crypto.randomUUID()}`,
        rank: `${(current.length + 1).toString().padStart(4, "0")}`,
        values: {
          [fields[0]?.id ?? "primary"]: "",
        },
        revision: 1,
        createdAt: Date.now(),
        createdBy: "You",
        updatedAt: Date.now(),
        updatedBy: "You",
      }
      return [...current, next]
    })
    simulateSync()
  }, [fields, setRecords, simulateSync])

  const batchUpdateCells = useCallback(
    (
      updates: GridCellBatchUpdate[],
    ): GridCellBatchResult | GridCellBatchFailure => {
      const updatesByRecord = new Map<string, GridCellBatchUpdate[]>()
      for (const update of updates) {
        const current = updatesByRecord.get(update.recordId) ?? []
        current.push(update)
        updatesByRecord.set(update.recordId, current)
      }

      const recordsById = new Map(
        records.map((record) => [record.id, record]),
      )
      for (const [recordId, recordUpdates] of updatesByRecord) {
        const record = recordsById.get(recordId)
        if (
          !record ||
          recordUpdates.some(
            (update) => update.expectedRevision !== record.revision,
          )
        ) {
          return {
            saved: false,
            message:
              "Someone else updated this item. Refresh to see their changes, then try again.",
          }
        }
      }

      const updatedAt = Date.now()
      const revisions: GridCellBatchResult["revisions"] = []
      const nextRecords = records.map((record) => {
        const recordUpdates = updatesByRecord.get(record.id)
        if (!recordUpdates?.length) return record
        const values = { ...record.values }
        for (const update of recordUpdates) {
          if (update.value === null) {
            delete values[update.fieldId]
          } else {
            values[update.fieldId] = update.value
          }
        }
        revisions.push({
          recordId: record.id,
          revision: record.revision + 1,
        })
        return {
          ...record,
          values,
          revision: record.revision + 1,
          updatedAt,
        }
      })

      setRecords(nextRecords)
      simulateSync()
      return { revisions }
    },
    [records, setRecords, simulateSync],
  )

  const duplicateRecords = useCallback(
    (recordsToDuplicate: GridRecord[]) => {
      setRecords((current) => {
        const copies = recordsToDuplicate.map((record, index) => ({
          ...record,
          id: `local_record_${crypto.randomUUID()}`,
          rank: `${(current.length + index + 1)
            .toString()
            .padStart(4, "0")}`,
          values: duplicateRecordValues(record, fields),
          revision: 1,
          createdAt: Date.now(),
          createdBy: "You",
          updatedAt: Date.now(),
          updatedBy: "You",
        }))
        return [...current, ...copies]
      })
      toast.success(
        recordsToDuplicate.length === 1
          ? "Record duplicated"
          : `${recordsToDuplicate.length.toLocaleString()} records duplicated`,
        {
          description:
            "Copies were added at the end. Files stay with the originals.",
        },
      )
      simulateSync()
      return true
    },
    [fields, setRecords, simulateSync],
  )

  const deleteRecords = useCallback(
    (recordsToDelete: GridRecord[]) => {
      const deletedIds = new Set(
        recordsToDelete.map((record) => record.id),
      )
      setRecords((current) =>
        current.filter((record) => !deletedIds.has(record.id)),
      )
      toast.success(
        recordsToDelete.length === 1
          ? "Record deleted"
          : `${recordsToDelete.length.toLocaleString()} records deleted`,
        {
          description: "Removed from this demo table.",
          duration: 12_000,
          action: {
            label: "Undo",
            onClick: () => {
              setRecords((current) =>
                [...current, ...recordsToDelete].toSorted(compareRanks),
              )
              toast.success(
                recordsToDelete.length === 1
                  ? "Record restored"
                  : `${recordsToDelete.length.toLocaleString()} records restored`,
              )
              simulateSync()
            },
          },
        },
      )
      simulateSync()
      return { deletedRecords: recordsToDelete }
    },
    [setRecords, simulateSync],
  )

  const addField = useCallback(
    (input: Pick<FieldDefinition, "name" | "type" | "config">) => {
      setFields((current) => [
        ...current,
        {
          ...input,
          id: `local_field_${crypto.randomUUID()}`,
          rank: rankAfter(current),
          width: input.type === "longText" ? 280 : 170,
          isPrimary: false,
        },
      ])
      toast.success(`${input.name} column added`)
      simulateSync()
      return true
    },
    [setFields, simulateSync],
  )

  const deleteField = useCallback(
    (fieldId: string) => {
      setFields((current) =>
        current.filter((field) => field.id !== fieldId),
      )
      toast.success("Column archived in this demo", {
        description:
          "Live forms would be checked first so their questions keep working.",
      })
      simulateSync()
    },
    [setFields, simulateSync],
  )

  const reorderField = useCallback(
    (fieldId: string, targetIndex: number) => {
      setFields((current) => {
        const index = current.findIndex((field) => field.id === fieldId)
        if (
          index < 0 ||
          targetIndex < 0 ||
          targetIndex >= current.length ||
          index === targetIndex
        ) {
          return current
        }
        const next = moveItemToIndex(current, index, targetIndex)
        return next.map((item, nextIndex) => ({
          ...item,
          rank: `${nextIndex.toString().padStart(4, "0")}`,
        }))
      })
      simulateSync()
    },
    [setFields, simulateSync],
  )

  const resizeField = useCallback(
    (fieldId: string, width: number) => {
      setFields((current) =>
        current.map((field) =>
          field.id === fieldId ? { ...field, width } : field,
        ),
      )
      simulateSync()
    },
    [setFields, simulateSync],
  )

  return (
    <DataGrid
      fields={fields}
      records={records}
      syncing={syncing}
      onUpdateCell={updateCell}
      onBatchUpdateCells={batchUpdateCells}
      onAddRecord={addRecord}
      onDeleteRecords={deleteRecords}
      onDuplicateRecords={duplicateRecords}
      onAddField={addField}
      onDeleteField={deleteField}
      onReorderField={reorderField}
      onResizeField={resizeField}
    />
  )
}
