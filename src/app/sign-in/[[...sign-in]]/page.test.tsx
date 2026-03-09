import React from "react";
import { render, screen } from "@testing-library/react";
import SignInPage from "./page";

const signInMock = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  SignIn: (props: unknown) => {
    signInMock(props);
    return <div data-testid="clerk-sign-in" />;
  },
}));

describe("/sign-in page", () => {
  beforeEach(() => {
    signInMock.mockReset();
  });

  it("renders the Clerk sign-in component at /sign-in", () => {
    render(<SignInPage />);

    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(signInMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: "path",
        path: "/sign-in",
      }),
    );
  });
});
