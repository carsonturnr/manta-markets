"use client";
// Sign in, or the account link and Clerk's user menu, at the end of the site's navigation. A
// client component so pages stay static: Clerk reads the session in the browser here.
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function AccountNav() {
  return (
    <span className="nav-account">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="link-button">
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link href="/account">Account</Link>
        <UserButton />
      </Show>
    </span>
  );
}
