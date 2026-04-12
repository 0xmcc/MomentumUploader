import React from "react";
import { render, screen } from "@testing-library/react";
import SharedMemoChatPage from "./page";
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { parseShareRef } from "@/lib/share-contract";
import { resolveMemoShare } from "@/lib/memo-share";

const redirectError = new Error("NEXT_REDIRECT");
const notFoundError = new Error("NEXT_NOT_FOUND");

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw redirectError;
  }),
  notFound: jest.fn(() => {
    throw notFoundError;
  }),
}));

jest.mock("@/lib/share-contract", () => ({
  parseShareRef: jest.fn(),
}));

jest.mock("@/lib/memo-share", () => ({
  resolveMemoShare: jest.fn(),
}));

jest.mock("@/components/memos/SharedMemoSummary", () => ({
  __esModule: true,
  default: ({ memo }: { memo: { title: string } }) => (
    <div data-testid="shared-memo-summary">{memo.title}</div>
  ),
}));

jest.mock("@/components/memos/MemoAgentPanel", () => ({
  __esModule: true,
  default: ({
    memoId,
    shareToken,
  }: {
    memoId: string;
    shareToken: string;
  }) => (
    <div
      data-testid="memo-agent-panel"
      data-memo-id={memoId}
      data-share-token={shareToken}
    />
  ),
}));

describe("/s/[shareRef]/chat page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (parseShareRef as jest.Mock).mockReturnValue({
      shareToken: "sharetoken1234",
      pathFormat: "html",
    });
    (resolveMemoShare as jest.Mock).mockResolvedValue({
      status: "ok",
      memo: {
        memoId: "memo-1",
        title: "Shared Memo",
      },
    });
  });

  it("renders the shared memo summary and agent panel for signed-in viewers", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "viewer-1" });

    const ui = await SharedMemoChatPage({
      params: Promise.resolve({ shareRef: "sharetoken1234.md" }),
    });
    render(ui);

    expect(screen.getByTestId("shared-memo-summary")).toHaveTextContent("Shared Memo");
    expect(screen.getByTestId("memo-agent-panel")).toHaveAttribute(
      "data-memo-id",
      "memo-1"
    );
    expect(screen.getByTestId("memo-agent-panel")).toHaveAttribute(
      "data-share-token",
      "sharetoken1234"
    );
  });

  it("redirects signed-out viewers back to the exact shareRef chat URL", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: null });

    await expect(
      SharedMemoChatPage({
        params: Promise.resolve({ shareRef: "sharetoken1234.md" }),
      })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith(
      "/sign-in?redirect_url=%2Fs%2Fsharetoken1234.md%2Fchat"
    );
  });

  it("calls notFound when the share cannot be resolved", async () => {
    (auth as jest.Mock).mockResolvedValue({ userId: "viewer-1" });
    (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "not_found" });

    await expect(
      SharedMemoChatPage({
        params: Promise.resolve({ shareRef: "sharetoken1234" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
  });
});
