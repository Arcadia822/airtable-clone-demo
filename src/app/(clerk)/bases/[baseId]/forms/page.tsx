import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedFormsList } from "@/components/connected/forms-list"

export default async function FormsPage({
  params,
}: {
  params: Promise<{ baseId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="forms" />
  }

  const { baseId } = await params
  return <ConnectedFormsList baseId={baseId} />
}
