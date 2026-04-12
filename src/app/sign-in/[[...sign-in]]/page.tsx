import { SignIn } from "@clerk/nextjs";
import { headers } from "next/headers";

type SignInPageProps = {
  searchParams?: Promise<{
    redirect_url?: string | string[];
  }>;
};

function getSingleValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((entry) => entry.length > 0) ?? null;
  }

  return null;
}

function getRequestOrigin(headersList: Headers): string | null {
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  if (!host) {
    return null;
  }

  const protocol = headersList.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

function isAuthPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname.startsWith("/sign-in/") ||
    pathname === "/sign-up" ||
    pathname.startsWith("/sign-up/")
  );
}

function toSafeRedirectPath(value: string | null, requestOrigin: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    if (value.startsWith("/") && !value.startsWith("//")) {
      const relativeUrl = new URL(value, "https://voice-memos.local");
      if (isAuthPath(relativeUrl.pathname)) {
        return null;
      }

      return `${relativeUrl.pathname}${relativeUrl.search}${relativeUrl.hash}`;
    }

    if (!requestOrigin) {
      return null;
    }

    const absoluteUrl = new URL(value);
    if (absoluteUrl.origin !== requestOrigin || isAuthPath(absoluteUrl.pathname)) {
      return null;
    }

    return `${absoluteUrl.pathname}${absoluteUrl.search}${absoluteUrl.hash}`;
  } catch {
    return null;
  }
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedSearchParams = await searchParams;
  const headersList = await headers();
  const requestOrigin = getRequestOrigin(headersList);
  const redirectTarget =
    toSafeRedirectPath(getSingleValue(resolvedSearchParams?.redirect_url), requestOrigin) ??
    toSafeRedirectPath(headersList.get("referer"), requestOrigin);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <SignIn
        routing="path"
        path="/sign-in"
        fallbackRedirectUrl="/"
        forceRedirectUrl={redirectTarget}
      />
    </main>
  );
}
