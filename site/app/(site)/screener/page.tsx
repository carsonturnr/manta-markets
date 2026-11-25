// The screener table became the Markets page (2026-11-26): old links land there, keeping the
// category and search they asked for.
import { redirect } from "next/navigation";

type Params = Record<string, string | string[] | undefined>;

export default async function ScreenerPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const u = new URLSearchParams();
  for (const [from, to] of [
    ["category", "cat"],
    ["q", "q"],
  ]) {
    const v = p[from];
    if (typeof v === "string" && v) u.set(to, v);
  }
  const s = u.toString();
  redirect(s ? `/markets?${s}` : "/markets");
}
