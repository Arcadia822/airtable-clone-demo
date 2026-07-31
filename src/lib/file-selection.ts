export type AttachmentSelectionKind = "image" | "file" | "any" | undefined

export const IMAGE_FILE_ACCEPT = "image/*"

export function isImageFile(
  file: Pick<File, "type">,
): boolean {
  return file.type.startsWith("image/")
}

export function attachmentAccept(
  kind: AttachmentSelectionKind,
): string | undefined {
  return kind === "image" ? IMAGE_FILE_ACCEPT : undefined
}

export function fileMatchesAttachmentKind(
  file: Pick<File, "name" | "type">,
  kind: AttachmentSelectionKind,
): boolean {
  if (!kind || kind === "any") return true
  return kind === "image" ? isImageFile(file) : !isImageFile(file)
}

export function attachmentKindErrorMessage(
  file: Pick<File, "name" | "type">,
  kind: AttachmentSelectionKind,
): string | undefined {
  if (fileMatchesAttachmentKind(file, kind)) return undefined
  return kind === "image"
    ? `${file.name} must be an image.`
    : `${file.name} must be a non-image file.`
}

export interface FileIdentityTracker {
  keys: WeakMap<File, string>
  nextKey: number
}

export function createFileIdentityTracker(): FileIdentityTracker {
  return { keys: new WeakMap(), nextKey: 0 }
}

export function fileIdentityEntries(
  files: readonly File[],
  tracker: FileIdentityTracker,
): Array<{ file: File; key: string }> {
  const occurrences = new Map<string, number>()
  return files.map((file) => {
    let base = tracker.keys.get(file)
    if (!base) {
      base = `file:${tracker.nextKey}`
      tracker.nextKey += 1
      tracker.keys.set(file, base)
    }
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    return { file, key: `${base}:${occurrence}` }
  })
}
