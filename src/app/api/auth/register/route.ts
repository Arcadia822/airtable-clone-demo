import { handleVisitorAuthStart } from "@/app/api/auth/login/route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  return handleVisitorAuthStart(request, "register")
}
