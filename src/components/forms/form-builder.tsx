"use client"

import Link from "next/link"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FormInput,
  GripVertical,
  Link2,
  Monitor,
  Palette,
  Plus,
  Settings2,
  Smartphone,
  Trash2,
} from "lucide-react"
import {
  useId,
  useMemo,
  useState,
  type DragEvent,
} from "react"
import { toast } from "sonner"

import { PublicForm } from "@/components/forms/public-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import type { FormDefinition, FormQuestion } from "@/lib/domain"
import { DEMO_FIELDS, DEMO_FORM } from "@/lib/demo-data"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import { cn } from "@/lib/utils"

const FORM_COLOR_PRESETS = [
  { label: "Violet", value: "#6d5dfc" },
  { label: "Blue", value: "#2563eb" },
  { label: "Teal", value: "#0f766e" },
  { label: "Orange", value: "#c2410c" },
  { label: "Pink", value: "#be185d" },
  { label: "Charcoal", value: "#111827" },
] as const

function updateAt<T>(items: T[], index: number, nextIndex: number): T[] {
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

export function FormBuilder() {
  const fieldMappingId = useId()
  const [form, setForm] = useState<FormDefinition>(DEMO_FORM)
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [hasDraftChanges, setHasDraftChanges] = useState(false)
  const [draggedQuestionId, setDraggedQuestionId] = useState<string>()
  const [dropQuestionId, setDropQuestionId] = useState<string>()
  const [selectedQuestion, setSelectedQuestion] = useState<string | undefined>(
    form.questions[0]?.id,
  )

  const selected = useMemo(
    () => form.questions.find((question) => question.id === selectedQuestion),
    [form.questions, selectedQuestion],
  )

  function updateForm(patch: Partial<FormDefinition>) {
    setForm((current) => ({ ...current, ...patch }))
    setHasDraftChanges(true)
  }

  function updateQuestion(id: string, patch: Partial<FormQuestion>) {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === id ? { ...question, ...patch } : question,
      ),
    }))
    setHasDraftChanges(true)
  }

  function addQuestion() {
    const field = DEMO_FIELDS.find(
      (candidate) =>
        !candidate.isArchived &&
        !["createdTime", "createdBy"].includes(candidate.type) &&
        !form.questions.some((question) => question.fieldId === candidate.id),
    )
    if (!field) {
      toast.info("Every available column is already used")
      return
    }
    const question: FormQuestion = {
      id: `question_${crypto.randomUUID()}`,
      fieldId: field.id,
      label: field.name,
      helpText: "",
      placeholder: "",
      required: false,
      rank: `${form.questions.length.toString().padStart(4, "0")}`,
    }
    setForm((current) => ({
      ...current,
      questions: [...current.questions, question],
    }))
    setSelectedQuestion(question.id)
    setHasDraftChanges(true)
  }

  function reorderQuestion(index: number, nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= form.questions.length) return
    setForm((current) => ({
      ...current,
      questions: updateAt(current.questions, index, nextIndex),
    }))
    setHasDraftChanges(true)
  }

  function dropQuestion(
    event: DragEvent<HTMLDivElement>,
    targetQuestionId: string,
  ) {
    event.preventDefault()
    const sourceQuestionId =
      draggedQuestionId || event.dataTransfer.getData("text/plain")
    const sourceIndex = form.questions.findIndex(
      (question) => question.id === sourceQuestionId,
    )
    const targetIndex = form.questions.findIndex(
      (question) => question.id === targetQuestionId,
    )
    setDraggedQuestionId(undefined)
    setDropQuestionId(undefined)
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      sourceIndex === targetIndex
    ) {
      return
    }
    reorderQuestion(sourceIndex, targetIndex)
  }

  function publish() {
    setForm((current) => ({
      ...current,
      status: "published",
      version: current.version + 1,
    }))
    setHasDraftChanges(false)
    toast.success("Form published", {
      description: "Your changes are live and ready to share.",
    })
  }

  async function copyLink() {
    const url = `${window.location.origin}/f/${form.publicSlug}`
    await navigator.clipboard.writeText(url)
    toast.success("Share link copied")
  }

  return (
    <WorkspaceShell section="forms">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FormInput className="size-4 text-primary" />
              <h1 className="truncate text-sm font-semibold">{form.name}</h1>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full text-[10px]",
                  form.status === "published"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700",
                )}
              >
                {form.status === "published" ? "Published" : "Not published"}
              </Badge>
            </div>
            <p className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">
              Saves responses in Feedback
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={copyLink}>
              <Copy />
              <span className="hidden sm:inline">Copy link</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/f/${form.publicSlug}`} target="_blank" />}
            >
              <Eye />
              <span className="hidden sm:inline">Preview</span>
            </Button>
          </div>
        </div>

        <div
          aria-label="Publication status"
          className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/95 px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              hasDraftChanges ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              {hasDraftChanges
                ? "Draft has unpublished changes"
                : `Published · version ${form.version}`}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {hasDraftChanges
                ? "Visitors still see the previous published version."
                : "The editor matches the public form."}
            </p>
          </div>
          <Button
            onClick={() =>
              toast.success("Draft saved", {
                description: "Publish when you are ready to update the public form.",
              })
            }
            size="sm"
            variant="outline"
          >
            Save draft
          </Button>
          <Button
            aria-label="Review publish changes"
            disabled={!hasDraftChanges}
            onClick={publish}
            size="sm"
          >
            <Check />
            Review & publish
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[280px_minmax(420px,1fr)_340px]">
          <section
            aria-label="Form questions"
            className="min-w-0 border-b bg-muted/20 xl:hidden"
          >
            <div className="flex h-11 items-center px-3">
              <span className="text-xs font-semibold">Form outline</span>
              <Badge variant="secondary" className="ml-2 rounded-full text-[9px]">
                {form.questions.length}
              </Badge>
              <Button
                aria-label="Add question"
                className="ml-auto"
                onClick={addQuestion}
                size="icon-sm"
                variant="ghost"
              >
                <Plus />
              </Button>
            </div>
            <div className="flex gap-2 overflow-x-auto px-3 pb-3">
              {form.questions.map((question, index) => {
                const field = DEMO_FIELDS.find(
                  (item) => item.id === question.fieldId,
                )
                return (
                  <div
                    className={cn(
                      "flex min-w-[220px] items-center gap-2 rounded-lg border bg-background p-2",
                      selectedQuestion === question.id &&
                        "border-primary/40 ring-2 ring-primary/10",
                    )}
                    key={question.id}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setSelectedQuestion(question.id)}
                      type="button"
                    >
                      <span className="block truncate text-xs font-medium">
                        {question.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {field?.name ?? "Column unavailable"} ·{" "}
                        {getFieldTypeLabel(field?.type)}
                      </span>
                    </button>
                    <span className="flex shrink-0 flex-col">
                      <button
                        aria-label={`Move ${question.label} up`}
                        className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => reorderQuestion(index, index - 1)}
                        type="button"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        aria-label={`Move ${question.label} down`}
                        className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        disabled={index === form.questions.length - 1}
                        onClick={() => reorderQuestion(index, index + 1)}
                        type="button"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <aside className="hidden min-h-0 border-r bg-muted/20 xl:flex xl:flex-col">
            <div className="flex h-11 items-center px-3">
              <div>
                <span className="block text-xs font-semibold">Form outline</span>
                <span className="block text-[10px] text-muted-foreground">
                  Drag questions to reorder
                </span>
              </div>
              <Badge variant="secondary" className="ml-2 rounded-full text-[9px]">
                {form.questions.length}
              </Badge>
              <Button
                aria-label="Add question"
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                onClick={addQuestion}
              >
                <Plus />
              </Button>
            </div>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 p-2">
                {form.questions.map((question, index) => {
                  const field = DEMO_FIELDS.find((item) => item.id === question.fieldId)
                  return (
                    <div
                      key={question.id}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-md border border-transparent p-2.5 text-left transition-colors",
                        selectedQuestion === question.id
                          ? "border-primary/35 bg-primary/[0.045]"
                          : "hover:border-border hover:bg-background/65",
                        draggedQuestionId === question.id && "opacity-45",
                        dropQuestionId === question.id &&
                          draggedQuestionId !== question.id &&
                          "border-primary bg-primary/5",
                      )}
                      draggable
                      onDragEnd={() => {
                        setDraggedQuestionId(undefined)
                        setDropQuestionId(undefined)
                      }}
                      onDragOver={(event) => {
                        if (draggedQuestionId === question.id) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = "move"
                        setDropQuestionId(question.id)
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData("text/plain", question.id)
                        setDraggedQuestionId(question.id)
                      }}
                      onDrop={(event) => dropQuestion(event, question.id)}
                    >
                      <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/55 active:cursor-grabbing" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedQuestion(question.id)}
                      >
                        <span className="block truncate text-xs font-medium">
                          {question.label}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                          Saves to {field?.name ?? "an unavailable column"} ·{" "}
                          {getFieldTypeLabel(field?.type)}
                        </span>
                      </button>
                      <span className="flex flex-col opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Move ${question.label} up`}
                          disabled={index === 0}
                          onClick={() => {
                            reorderQuestion(index, index - 1)
                          }}
                        >
                          <ArrowUp className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Move ${question.label} down`}
                          disabled={index === form.questions.length - 1}
                          onClick={() => {
                            reorderQuestion(index, index + 1)
                          }}
                        >
                          <ArrowDown className="size-3" />
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
            <div className="border-t p-2">
              <Button variant="outline" className="w-full" onClick={addQuestion}>
                <Plus />
                Add question
              </Button>
            </div>
          </aside>

          <main
            className="min-h-0 overflow-auto p-4 sm:p-7"
            style={{ background: form.theme.background }}
          >
            <div className="mx-auto mb-4 flex max-w-2xl items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium">Public form preview</p>
                <p className="text-[10px] text-muted-foreground">
                  Updates as you edit
                </p>
              </div>
              <div
                aria-label="Preview size"
                className="flex items-center rounded-md border bg-background p-0.5"
                role="group"
              >
                <Button
                  variant={device === "desktop" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setDevice("desktop")}
                  aria-label="Desktop preview"
                >
                  <Monitor />
                  Desktop
                </Button>
                <Button
                  variant={device === "mobile" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setDevice("mobile")}
                  aria-label="Mobile preview"
                >
                  <Smartphone />
                  Mobile
                </Button>
              </div>
            </div>
            <div
              className={cn(
                "mx-auto transition-all",
                device === "mobile" ? "max-w-[390px]" : "max-w-2xl",
              )}
            >
              <PublicForm form={form} fields={DEMO_FIELDS} embedded />
            </div>
          </main>

          <aside className="min-h-0 overflow-auto border-l bg-background">
            <Tabs defaultValue="question" className="h-full">
              <div className="border-b px-3 py-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Inspector
                </p>
                <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="question">
                  <Settings2 />
                  Field
                </TabsTrigger>
                <TabsTrigger aria-label="Design" value="design">
                  <Palette />
                  Style & completion
                </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="question" className="m-0 p-4">
                {selected ? (
                  <div className="grid gap-5">
                    <div className="flex items-start gap-3 border-b pb-4">
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
                        <FormInput className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-muted-foreground">
                          Editing question
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold">
                          {selected.label || "Untitled question"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {getFieldTypeLabel(
                            DEMO_FIELDS.find(
                              (field) => field.id === selected.fieldId,
                            )?.type,
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="-mb-3 text-xs font-medium text-muted-foreground">
                      Response destination
                    </p>
                    <div className="grid gap-2">
                      <Label htmlFor={fieldMappingId}>Save answers in</Label>
                      <Select
                        value={selected.fieldId}
                        onValueChange={(fieldId) => {
                          if (fieldId) updateQuestion(selected.id, { fieldId })
                        }}
                      >
                        <SelectTrigger
                          className="w-full"
                          id={fieldMappingId}
                        >
                          <SelectValue>
                            {DEMO_FIELDS.find(
                              (field) => field.id === selected.fieldId,
                            )?.name ?? "Choose a column"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {DEMO_FIELDS.filter(
                            (field) =>
                              !field.isArchived &&
                              !["createdTime", "createdBy"].includes(field.type),
                          ).map((field) => {
                            const mappedElsewhere = form.questions.some(
                              (question) =>
                                question.id !== selected.id &&
                                question.fieldId === field.id,
                            )
                            return (
                              <SelectItem
                                disabled={mappedElsewhere}
                                key={field.id}
                                value={field.id}
                              >
                                {field.name} · {getFieldTypeLabel(field.type)}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Each answer appears in this table column. A column can
                        only be used once on this form.
                      </p>
                    </div>
                    <Separator />
                    <p className="-mb-3 text-xs font-medium text-muted-foreground">
                      Question content
                    </p>
                    <div className="grid gap-2">
                      <Label htmlFor="question-label">Question label</Label>
                      <Input
                        id="question-label"
                        value={selected.label}
                        onChange={(event) =>
                          updateQuestion(selected.id, { label: event.target.value })
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="question-help">Help text</Label>
                      <Textarea
                        id="question-help"
                        rows={3}
                        value={selected.helpText}
                        onChange={(event) =>
                          updateQuestion(selected.id, {
                            helpText: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="question-placeholder">Placeholder</Label>
                      <Input
                        id="question-placeholder"
                        value={selected.placeholder ?? ""}
                        onChange={(event) =>
                          updateQuestion(selected.id, {
                            placeholder: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <span>
                        <span className="block text-xs font-medium">Required</span>
                        <span className="text-[10px] text-muted-foreground">
                          A response must include this question.
                        </span>
                      </span>
                      <Switch
                        aria-label="Required"
                        checked={selected.required}
                        onCheckedChange={(required) =>
                          updateQuestion(selected.id, { required })
                        }
                      />
                    </div>
                    <Button
                      variant="destructive"
                      className="justify-start"
                      onClick={() => {
                        setForm((current) => ({
                          ...current,
                          questions: current.questions.filter(
                            (question) => question.id !== selected.id,
                          ),
                        }))
                        setSelectedQuestion(undefined)
                        setHasDraftChanges(true)
                      }}
                    >
                      <Trash2 />
                      Remove question
                    </Button>
                  </div>
                ) : (
                  <p className="py-10 text-center text-xs text-muted-foreground">
                    Select a question to choose where its answers are saved.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="design" className="m-0 grid gap-5 p-4">
                <div className="grid gap-2">
                  <Label htmlFor="form-title">Form title</Label>
                  <Input
                    id="form-title"
                    value={form.title}
                    onChange={(event) => updateForm({ title: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="form-description">Description</Label>
                  <Textarea
                    id="form-description"
                    rows={4}
                    value={form.description}
                    onChange={(event) =>
                      updateForm({ description: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="accent">Accent color</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {FORM_COLOR_PRESETS.map((color) => (
                      <button
                        aria-label={`Use ${color.label} for the accent color`}
                        aria-pressed={
                          form.theme.accent.toLowerCase() === color.value
                        }
                        className="size-8 rounded-full border shadow-sm outline-none ring-offset-2 transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
                        key={color.value}
                        onClick={() =>
                          updateForm({
                            theme: { ...form.theme, accent: color.value },
                          })
                        }
                        style={{ backgroundColor: color.value }}
                        title={color.label}
                        type="button"
                      />
                    ))}
                    <label className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full border bg-background px-3 text-xs font-medium shadow-sm">
                      <span
                        aria-hidden="true"
                        className="size-4 rounded-full border"
                        style={{ backgroundColor: form.theme.accent }}
                      />
                      Custom
                      <input
                        aria-label="Choose a custom accent color"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        id="accent"
                        onChange={(event) =>
                          updateForm({
                            theme: {
                              ...form.theme,
                              accent: event.target.value,
                            },
                          })
                        }
                        type="color"
                        value={form.theme.accent}
                      />
                    </label>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="thank-you">Thank-you title</Label>
                  <Input
                    id="thank-you"
                    value={form.thankYouTitle}
                    onChange={(event) =>
                      updateForm({ thankYouTitle: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="thank-you-message">Thank-you message</Label>
                  <Textarea
                    id="thank-you-message"
                    rows={3}
                    value={form.thankYouMessage}
                    onChange={(event) =>
                      updateForm({ thankYouMessage: event.target.value })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span>
                    <span className="block text-xs font-medium">Hide branding</span>
                    <span className="text-[10px] text-muted-foreground">
                      Available on Starter and Pro
                    </span>
                  </span>
                  <Switch
                    aria-label="Hide branding"
                    checked={form.theme.hideBranding}
                    onCheckedChange={(hideBranding) =>
                      updateForm({
                        theme: { ...form.theme, hideBranding },
                      })
                    }
                  />
                </div>
                <Button variant="outline" onClick={copyLink}>
                  <Link2 />
                  Copy share link
                </Button>
                <Button
                  variant="ghost"
                  render={<Link href={`/f/${form.publicSlug}`} target="_blank" />}
                >
                  <ExternalLink />
                  Open live form
                </Button>
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>
    </WorkspaceShell>
  )
}
