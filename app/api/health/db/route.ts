import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/client";

function summarizeDatabaseError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split("\n")[0]?.slice(0, 160) || "Database connection failed";
  }

  return "Database connection failed";
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, database: "error", message: "Missing DATABASE_URL" },
      { status: 503 },
    );
  }

  try {
    await prisma.$queryRaw`select 1`;
    return NextResponse.json({ ok: true, database: "connected" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, database: "error", message: summarizeDatabaseError(error) },
      { status: 503 },
    );
  }
}
