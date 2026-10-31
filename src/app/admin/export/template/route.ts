import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAuthContext } from "@/lib/auth/session";
import { IMPORT_COLUMNS } from "@/lib/normalize";
import { MAX_IMPORT_ROWS } from "@/lib/constants";

/**
 * GET /admin/export/template — authenticated download of a sample
 * .xlsx import workbook: the exact header spellings the importer maps
 * plus one example row and a second sheet stating the requirements
 * (columns, limits, error policy). Contains no real member data.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Members");
  ws.addRow(IMPORT_COLUMNS.map((c) => c.label));
  ws.addRow(["Asha Sharma", "CS2202001", 10, "starting points"]);
  ws.addRow(["Rohit Verma", "CS2202002", 0, ""]);
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 28;

  const info = wb.addWorksheet("Requirements");
  const lines: string[] = [
    "Import requirements",
    `1. The first sheet's first row must contain headers: name and roll number (required), points and reason (optional).`,
    "2. Header spellings recognized: name / Full Name; roll number / roll_number / rollno / roll; points / initial_points; reason.",
    `3. Up to ${MAX_IMPORT_ROWS} data rows per file; 5 MB maximum file size; .xlsx only.`,
    "4. Points: whole numbers only; nonzero values must be within the allowed range. Empty = 0.",
    "5. Formula cells are not allowed anywhere.",
    "6. Duplicates within the file or members already active in the domain are reported.",
    "7. If any row is invalid the file is rejected in full unless you tick “Import valid rows only”.",
  ];
  for (const line of lines) info.addRow([line]);
  info.getColumn(1).width = 120;

  const bytes = await wb.xlsx.writeBuffer();
  return new NextResponse(bytes as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="member-import-template.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
