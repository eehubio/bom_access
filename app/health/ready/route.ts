import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ready", mode: "stateless", version: "1.0.0" });
}
