"use client";
// Re-renders the page's server components every `seconds` while the tab is visible, so the order
// book and trades stay current without a reload. The server caches each source (lib/venues.ts),
// so this never reaches a venue more often than its cache allows.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
