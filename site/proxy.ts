// Clerk's request handler (step 11): reads the session cookie on each request so that server
// code can ask who is signed in (auth()). It blocks nothing: pages decide for themselves.
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  // Clerk's recommended matcher: every page and API route, not Next's files or static assets.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
