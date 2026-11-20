"use client"

import {
  ArrowLeft,
  ClipboardCopy,
  FileText,
  Loader2,
  Plus,
  Rocket,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { FieldConfig, FieldType } from "@/lib/domain"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import { cn } from "@/lib/utils"

interface CatalogField {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
  isPrimary: boolean
  eligible: boolean
}

interface CatalogTable {
  id: string
  name: string
  baseId: string
  fields: CatalogField[]
}

interface FormSummary {
  id: string
  name: string
  description: string
  slug: string
  status: "draft" | "published" | "closed"
  tableName: string | null
  submissionCount: number
  updatedAt: string
  publishedVersionId: string | null
}

interface CatalogResponse {
  forms: FormSummary[]
  base: { id: string; name: string }
  tables: CatalogTable[]
}

const STATUS_LABELS: Record<FormSummary["status"], string> = {
  draft: "草稿",
  published: "已发布",
  closed: "已关闭",
}

async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function BaseFormsPage() {
  const params = useParams<{ baseId: string }>()
  const baseId = params.baseId
  const router = useRouter()

  const [catalog, setCatalog] = useState<CatalogResponse>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [creatingOpen, setCreatingOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string>()

  const [tableId, setTableId] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [pickedFieldIds, setPickedFieldIds] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const response = await fetch(
        `/api/forms?baseId=${encodeURIComponent(baseId)}&include=tables`,
        { cache: "no-store" },
      )
      const payload = await readJson<CatalogResponse & { message?: string }>(
        response,
      )
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? "无法载入这个 Base 的表单。")
      }
      setCatalog(payload)
      const firstTable = payload.tables[0]
      if (firstTable) {
        setTableId((current) => current || firstTable.id)
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "载入失败，请重试。",
      )
    } finally {
      setLoading(false)
    }
  }, [baseId])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [load])

  const selectedTable = useMemo(
    () => catalog?.tables.find((table) => table.id === tableId),
    [catalog, tableId],
  )
  const eligibleFields = useMemo(
    () => (selectedTable?.fields ?? []).filter((field) => field.eligible),
    [selectedTable],
  )

  function chooseTable(nextTableId: string) {
    setTableId(nextTableId)
    const table = catalog?.tables.find((item) => item.id === nextTableId)
    setPickedFieldIds(
      (table?.fields ?? [])
        .filter((field) => field.eligible)
        .map((field) => field.id),
    )
    if (!name.trim() && table) {
      setName(`${table.name} 表单`)
    }
  }

  function openCreatePanel() {
    setCreatingOpen(true)
    setNotice(undefined)
    if (!tableId && catalog?.tables[0]) {
      chooseTable(catalog.tables[0].id)
    } else if (!pickedFieldIds.length && eligibleFields.length) {
      setPickedFieldIds(eligibleFields.map((field) => field.id))
    }
  }

  async function createForm() {
    if (!tableId) return
    setCreating(true)
    setError(undefined)
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseId,
          tableId,
          name: name.trim(),
          description: description.trim(),
          selectedFieldIds: pickedFieldIds,
        }),
      })
      const payload = await readJson<{
        form?: { id: string }
        message?: string
      }>(response)
      if (!response.ok || !payload?.form) {
        throw new Error(payload?.message ?? "创建表单失败。")
      }
      router.push(`/bases/${baseId}/forms/${payload.form.id}`)
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "创建表单失败。",
      )
    } finally {
      setCreating(false)
    }
  }

  async function copyLink(slug: string) {
    const url = `${window.location.origin}/f/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice("公开链接已复制")
    } catch {
      setNotice(url)
    }
  }

  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={`/bases/${baseId}`} />}
          >
            <ArrowLeft className="size-4" />
            返回
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {catalog?.base.name ?? "Base"} / 表单
            </p>
            <h1 className="truncate text-xl font-semibold tracking-tight">
              表单
            </h1>
          </div>
          <Button size="sm" onClick={openCreatePanel}>
            <Plus className="size-4" />
            新建表单
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="mb-4 rounded-lg border border-emerald-600/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800"
          >
            {notice}
          </p>
        ) : null}

        {creatingOpen ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>新建表单</CardTitle>
              <CardDescription>
                选择一张数据表和要收集的字段。表单提交后会直接写入这张表。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {!catalog?.tables.length ? (
                <p className="text-sm text-muted-foreground">
                  这个 Base 里还没有可用的数据表。
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="form-table">数据表</Label>
                      <Select
                        value={tableId}
                        onValueChange={(value) => {
                          if (value) chooseTable(value)
                        }}
                      >
                        <SelectTrigger id="form-table" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog.tables.map((table) => (
                            <SelectItem key={table.id} value={table.id}>
                              {table.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="form-name">表单名称</Label>
                      <Input
                        id="form-name"
                        value={name}
                        placeholder="例如：项目需求收集"
                        onChange={(event) => setName(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2 sm:col-span-2">
                      <Label htmlFor="form-description">说明</Label>
                      <Textarea
                        id="form-description"
                        value={description}
                        rows={2}
                        placeholder="告诉填写者这个表单的用途。"
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>包含的字段</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        onClick={() =>
                          setPickedFieldIds(
                            pickedFieldIds.length === eligibleFields.length
                              ? []
                              : eligibleFields.map((field) => field.id),
                          )
                        }
                      >
                        {pickedFieldIds.length === eligibleFields.length
                          ? "取消全选"
                          : "全选"}
                      </button>
                    </div>
                    <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                      {eligibleFields.map((field) => {
                        const checked = pickedFieldIds.includes(field.id)
                        return (
                          <label
                            key={field.id}
                            htmlFor={`create-field-${field.id}`}
                            className={cn(
                              "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                              checked && "bg-muted/70",
                            )}
                          >
                            <Checkbox
                              id={`create-field-${field.id}`}
                              checked={checked}
                              onCheckedChange={() =>
                                setPickedFieldIds((current) =>
                                  current.includes(field.id)
                                    ? current.filter((id) => id !== field.id)
                                    : [...current, field.id],
                                )
                              }
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {field.name}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {getFieldTypeLabel(field.type)}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={creating || !name.trim() || !pickedFieldIds.length}
                      onClick={() => void createForm()}
                    >
                      {creating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Rocket className="size-4" />
                      )}
                      创建表单
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setCreatingOpen(false)}
                    >
                      取消
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在载入表单…
          </p>
        ) : !catalog?.forms.length ? (
          <Card>
            <CardContent className="grid place-items-center gap-2 py-16 text-center">
              <FileText className="size-8 text-muted-foreground" />
              <p className="font-medium">还没有表单</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                从任意数据表创建表单，把公开链接分享给团队或客户。
              </p>
              <Button className="mt-2" onClick={openCreatePanel}>
                <Plus className="size-4" />
                新建表单
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {catalog.forms.map((form) => (
              <Card key={form.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{form.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {form.tableName ?? "数据表"}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        form.status === "published"
                          ? "default"
                          : form.status === "closed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {STATUS_LABELS[form.status]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                    {form.description || "没有填写说明。"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{form.submissionCount} 份回复</span>
                    <span>·</span>
                    <span>更新于 {formatDate(form.updatedAt)}</span>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Link
                      href={`/bases/${baseId}/forms/${form.id}`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      编辑表单
                    </Link>
                    {form.status === "published" ? (
                      <>
                        <Link
                          href={`/f/${form.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({
                            size: "sm",
                            variant: "outline",
                          })}
                        >
                          打开
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void copyLink(form.slug)}
                        >
                          <ClipboardCopy className="size-4" />
                          复制链接
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
