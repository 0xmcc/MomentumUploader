import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { validateClerkEnv } from "@/lib/clerk-env";

let hasValidatedClerkEnv = false;
const clerkAuthMiddleware = clerkMiddleware();

function ensureClerkEnvIsValid(): void {
  if (hasValidatedClerkEnv) {
    return;
  }
  validateClerkEnv();
  hasValidatedClerkEnv = true;
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  ensureClerkEnvIsValid();
  return clerkAuthMiddleware(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webm|wav|mp3|mp4|wasm|pdf)).*)",
    "/(api|trpc)(.*)",
  ],
};
