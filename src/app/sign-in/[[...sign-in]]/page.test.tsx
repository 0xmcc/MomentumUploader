import React from "react";
import { render, screen } from "@testing-library/react";
import SignInPage from "./page";

const signInMock = jest.fn();
const headersMock = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  SignIn: (props: unknown) => {
    signInMock(props);
    return <div data-testid="clerk-sign-in" />;
  },
}));

jest.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

describe("/sign-in page", () => {
  beforeEach(() => {
    signInMock.mockReset();
    headersMock.mockReset();
    headersMock.mockResolvedValue(new Headers());
  });

  it("renders the Clerk sign-in component at /sign-in", async () => {
    const ui = await SignInPage({
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(signInMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: "path",
        path: "/sign-in",
        fallbackRedirectUrl: "/",
      }),
    );
  });

  it("prefers an explicit redirect_url search param after sign-in", async () => {
    const ui = await SignInPage({
      searchParams: Promise.resolve({
        redirect_url: "/s/token123",
      }),
    });

    render(ui);

    expect(signInMock).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: "/s/token123",
      }),
    );
  });

  it("falls back to a same-origin referer when redirect_url is missing", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        host: "example.com",
        "x-forwarded-proto": "https",
        referer: "https://example.com/s/token123",
      }),
    );

    const ui = await SignInPage({
      searchParams: Promise.resolve({}),
    });

    render(ui);

    expect(signInMock).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: "/s/token123",
      }),
    );
  });

  it("ignores external redirect targets and falls back to home", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        host: "example.com",
        "x-forwarded-proto": "https",
        referer: "https://evil.example/s/token123",
      }),
    );

    const ui = await SignInPage({
      searchParams: Promise.resolve({
        redirect_url: "https://evil.example/phish",
      }),
    });

    render(ui);

    expect(signInMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackRedirectUrl: "/",
      }),
    );
    expect(signInMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: expect.any(String),
      }),
    );
  });
});
