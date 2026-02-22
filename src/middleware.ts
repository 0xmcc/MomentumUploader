import { clerkMiddleware } from "@clerk/nextjs/server";
import { validateClerkEnv } from "@/lib/clerk-env";

validateClerkEnv();

export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webm|wav|mp3|mp4|wasm|pdf)).*)",
    "/(api|trpc)(.*)",
  ],
};
