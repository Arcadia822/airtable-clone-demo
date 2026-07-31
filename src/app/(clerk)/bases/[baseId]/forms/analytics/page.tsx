import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedFormsAnalyticsOverview } from "@/components/connected/forms-analytics-overview"

export default async function FormsAnalyticsOverviewPage({
  params,
}: {
  params: Promise<{ baseId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="forms" />
  }

  const { baseId } = await params
  return <ConnectedFormsAnalyticsOverview baseId={baseId} />
}
