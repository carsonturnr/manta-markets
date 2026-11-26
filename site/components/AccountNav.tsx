"use client";
// Log in and Sign up, or Account and Clerk's user menu, at the end of the site's navigation. A
// client component so pages stay static: Clerk reads the session in the browser here.
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function AccountNav() {
  return (
    <span className="nav-account">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="link-button">
            Log in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button type="button" className="btn btn-sm">
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link href="/account" className="btn btn-sm btn-ghost">
          Account
        </Link>
        <UserButton />
      </Show>
    </span>
  );
}
