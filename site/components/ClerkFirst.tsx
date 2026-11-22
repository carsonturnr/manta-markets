"use client";
// Loads @clerk/nextjs's client code before Clerk's provider renders. That code renames the provider
// when it loads (`ReactClerkProvider.displayName = ...` in @clerk/nextjs 7.9). The build's prerender
// had always loaded it (AccountNav imports it), a request had not yet, so React saw two different
// names, judged the saved page shell stale and threw away the server HTML on every page (React error
// #419, found 2026-11-22). Loading it here first gives both the same name.
import { Show } from "@clerk/nextjs";

export default function ClerkFirst({ children }: { children: React.ReactNode }) {
  void Show; // keeps the import: the package is marked side-effect free
  return children;
}
