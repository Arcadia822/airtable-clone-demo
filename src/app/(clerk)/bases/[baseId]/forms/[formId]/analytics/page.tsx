import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedFormAnalytics } from "@/components/connected/form-analytics"

export default async function FormAnalyticsPage({
  params,
}: {
  params: Promise<{ baseId: string; formId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="forms" />
  }

  const { baseId, formId } = await params
  return <ConnectedFormAnalytics baseId={baseId} formId={formId} />
}
