import {
  ConnectionRequired,
  isConnectedStackConfigured,
} from "@/components/connected/connection-required"
import { ConnectedDashboard } from "@/components/connected/dashboard"

export default function DashboardPage() {
  if (!isConnectedStackConfigured()) {
    return <ConnectionRequired destination="dashboard" />
  }

  return <ConnectedDashboard />
}
