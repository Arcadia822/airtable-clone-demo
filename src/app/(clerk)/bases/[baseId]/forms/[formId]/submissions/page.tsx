import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedFormSubmissions } from "@/components/connected/form-submissions"

export default async function FormSubmissionsPage({
  params,
}: {
  params: Promise<{ baseId: string; formId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="forms" />
  }

  const { baseId, formId } = await params
  return <ConnectedFormSubmissions baseId={baseId} formId={formId} />
}
