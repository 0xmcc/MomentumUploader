describe("middleware module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not throw at import time when Clerk env vars are missing", () => {
    jest.doMock("@clerk/nextjs/server", () => ({
      clerkMiddleware: jest.fn(() => jest.fn()),
    }));

    expect(() => {
      jest.isolateModules(() => {
        require("./middleware");
      });
    }).not.toThrow();
  });

  it("throws when middleware executes and Clerk env vars are missing", () => {
    const middlewareSpy = jest.fn();

    jest.doMock("@clerk/nextjs/server", () => ({
      clerkMiddleware: jest.fn(() => middlewareSpy),
    }));

    let middleware:
      | ((request: unknown, event: unknown) => unknown)
      | undefined;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      middleware = require("./middleware").default;
    });

    expect(() => {
      middleware?.({} as unknown, {} as unknown);
    }).toThrow("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(middlewareSpy).not.toHaveBeenCalled();
  });
});
