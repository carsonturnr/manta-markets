// Moved to /insights/releases/<release> (2026-11-26). Kept until next.config carries the redirect.
import { redirect } from "next/navigation";
import { Suspense } from "react";

export default function Moved({ params }: PageProps<"/events/[release]">) {
  return (
    <Suspense>
      <Go params={params} />
    </Suspense>
  );
}

async function Go({ params }: Pick<PageProps<"/events/[release]">, "params">): Promise<null> {
  redirect(`/insights/releases/${encodeURIComponent((await params).release)}`);
}
