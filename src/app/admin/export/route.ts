import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { buildDomainExport, exportResponse } from "@/lib/services/exports";
import { prisma } from "@/lib/db";
import { newCorrelationId } from "@/lib/ids";

/**
 * GET /admin/export?domain=<slug|all>
 * Authenticated spreadsheet export. Authorization is enforced inside
 * buildDomainExport: leads may only export a domain they are assigned
 * to; President/VP may also export everything.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("domain") ?? "";
  if (!slug) {
    return NextResponse.json({ error: "VALIDATION_ERROR", message: "domain query param required" }, { status: 400 });
  }

  let domainId: string | null = null;
  if (slug !== "all") {
    const domain = await prisma.domain.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!domain) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    domainId = domain.id;
  }

  const result = await buildDomainExport(ctx, domainId, newCorrelationId());
  if (!result.ok) {
    const status =
      result.code === "UNAUTHENTICATED" ? 401 : result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: result.code, message: result.message }, { status });
  }

  return exportResponse(result.data);
}
