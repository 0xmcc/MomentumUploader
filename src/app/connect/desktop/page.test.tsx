import React from "react";
import { render, screen } from "@testing-library/react";
import ConnectDesktopPage from "./page";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

const redirectError = new Error("NEXT_REDIRECT");

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw redirectError;
  }),
}));

jest.mock("./DesktopConnectClient", () => ({
  __esModule: true,
  default: () => <div data-testid="desktop-connect-client" />,
}));

describe("/connect/desktop page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders desktop connect client when user is authenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_1" });

    const ui = await ConnectDesktopPage();
    render(ui);

    expect(screen.getByTestId("desktop-connect-client")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects signed-out users to sign-in with redirect_url", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    await expect(ConnectDesktopPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/sign-in?redirect_url=%2Fconnect%2Fdesktop");
  });
});
