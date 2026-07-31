import { describe, expect, it } from "vitest"

import {
  attachmentAccept,
  attachmentKindErrorMessage,
  createFileIdentityTracker,
  fileIdentityEntries,
  fileMatchesAttachmentKind,
} from "@/lib/file-selection"

describe("attachment file selection", () => {
  it("accepts only browser-identified images for image fields", () => {
    expect(
      fileMatchesAttachmentKind(
        new File(["image"], "photo.png", { type: "image/png" }),
        "image",
      ),
    ).toBe(true)
    expect(
      fileMatchesAttachmentKind(new File(["image"], "photo.webp"), "image"),
    ).toBe(false)
    expect(
      fileMatchesAttachmentKind(
        new File(["document"], "notes.pdf", { type: "application/pdf" }),
        "image",
      ),
    ).toBe(false)
  })

  it("rejects images for non-image file fields", () => {
    const image = new File(["image"], "photo.jpg", { type: "image/jpeg" })
    const document = new File(["document"], "notes.pdf", {
      type: "application/pdf",
    })

    expect(fileMatchesAttachmentKind(image, "file")).toBe(false)
    expect(fileMatchesAttachmentKind(document, "file")).toBe(true)
    expect(attachmentKindErrorMessage(image, "file")).toContain(
      "non-image file",
    )
    expect(attachmentAccept("image")).toBe("image/*")
    expect(attachmentAccept("file")).toBeUndefined()
  })

  it("creates stable, occurrence-aware identities for retry bookkeeping", () => {
    const first = new File(["same"], "same.txt", {
      type: "text/plain",
      lastModified: 100,
    })
    const duplicate = new File(["same"], "same.txt", {
      type: "text/plain",
      lastModified: 100,
    })
    const changed = new File(["diff"], "same.txt", {
      type: "text/plain",
      lastModified: 100,
    })
    const tracker = createFileIdentityTracker()

    const firstKeys = fileIdentityEntries([first, duplicate], tracker).map(
      ({ key }) => key,
    )
    const retryKeys = fileIdentityEntries([first, duplicate], tracker).map(
      ({ key }) => key,
    )
    const changedKey = fileIdentityEntries([changed], tracker)[0]?.key

    expect(new Set(firstKeys).size).toBe(2)
    expect(retryKeys).toEqual(firstKeys)
    expect(changedKey).not.toBe(firstKeys[0])
  })
})
