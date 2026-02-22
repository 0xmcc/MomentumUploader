import { validateClerkEnv } from "./clerk-env";

describe("validateClerkEnv", () => {
  it("throws when CLERK_SECRET_KEY is missing", () => {
    expect(() =>
      validateClerkEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        CLERK_SECRET_KEY: "",
      }),
    ).toThrow("Missing CLERK_SECRET_KEY");
  });

  it("throws when publishable and secret key modes differ", () => {
    expect(() =>
      validateClerkEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        CLERK_SECRET_KEY: "sk_live_example",
      }),
    ).toThrow("Clerk key mode mismatch");
  });

  it("accepts matching test keys", () => {
    expect(() =>
      validateClerkEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        CLERK_SECRET_KEY: "sk_test_example",
      }),
    ).not.toThrow();
  });
});
