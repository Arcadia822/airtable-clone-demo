export function viewSelectionHref({
  pathname,
  searchParams,
  viewId,
}: {
  pathname: string
  searchParams: Pick<URLSearchParams, "toString">
  viewId: string
}) {
  const params = new URLSearchParams(searchParams.toString())
  if (params.get("action") === "new-view") {
    params.delete("action")
  }
  params.set("view", viewId)
  return `${pathname}?${params.toString()}`
}
