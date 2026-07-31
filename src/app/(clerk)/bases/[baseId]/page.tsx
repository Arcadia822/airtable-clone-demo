import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedBaseOverview } from "@/components/connected/base-overview"

export default async function BasePage({
  params,
}: {
  params: Promise<{ baseId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="workspace" />
  }

  const { baseId } = await params
  return <ConnectedBaseOverview baseId={baseId} />
}
