import React from "react";
import { render, screen } from "@testing-library/react";
import OpenClawPage from "./page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe("OpenClaw feature page", () => {
  it("documents the public handoff contract with canonical host, auth, nonce, and statuses", () => {
    const { container } = render(<OpenClawPage />);

    expect(
      screen.getByRole("heading", { name: "For agent builders" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/https:\/\/voice-memos\.vercel\.app\/api\/s\/\{shareRef\}\/handoff/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/x-openclaw-api-key: oc_acct_123:secret-xyz/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"nonce": "invite-nonce-from-share-url"/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("pending_claim").length).toBeGreaterThan(0);
    expect(screen.getAllByText("already_claimed").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("https://sonicmemos.app/");
  });
});
