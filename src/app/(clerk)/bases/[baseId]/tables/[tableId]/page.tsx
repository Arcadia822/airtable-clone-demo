import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedWorkspace } from "@/components/connected/workspace"

export default async function TablePage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="workspace" />
  }

  const { baseId, tableId } = await params
  return <ConnectedWorkspace baseId={baseId} tableId={tableId} />
}
