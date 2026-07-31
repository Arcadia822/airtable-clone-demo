import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedFormEditor } from "@/components/connected/form-editor"

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ baseId: string; formId: string }>
}) {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="forms" />
  }

  const { baseId, formId } = await params
  return <ConnectedFormEditor baseId={baseId} formId={formId} />
}
