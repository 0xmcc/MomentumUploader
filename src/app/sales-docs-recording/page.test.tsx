import { render, screen } from "@testing-library/react";
import SalesDocsRecordingPage from "./page";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

const redirectError = new Error("NEXT_REDIRECT");

jest.mock("@/components/sales-docs/sales-docs.css", () => ({}));

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw redirectError;
  }),
}));

describe("SalesDocsRecordingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the recording workspace for signed-in users", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_sales_123" });

    render(await SalesDocsRecordingPage());

    expect(
      screen.getByRole("heading", { name: "New Recording" })
    ).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects signed-out users to sign-in with a recording redirect_url", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    await expect(SalesDocsRecordingPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith(
      "/sign-in?redirect_url=%2Fsales-docs-recording"
    );
  });
});
