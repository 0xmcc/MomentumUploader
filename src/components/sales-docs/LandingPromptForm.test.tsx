import { fireEvent, render, screen } from "@testing-library/react";
import LandingPromptForm from "./LandingPromptForm";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("LandingPromptForm", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("routes the first prompt into a new /sales-docs session", () => {
    render(<LandingPromptForm />);

    fireEvent.change(
      screen.getByPlaceholderText("Describe your client or situation..."),
      { target: { value: "Discovery call with Jamie, agency owner" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate a call prep doc" })
    );

    expect(push).toHaveBeenCalledWith(
      `/sales-docs?prompt=${encodeURIComponent(
        "Discovery call with Jamie, agency owner"
      )}`
    );
  });

  it("submits on Enter and ignores empty prompts", () => {
    render(<LandingPromptForm />);
    const input = screen.getByPlaceholderText(
      "Describe your client or situation..."
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Prep me" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/sales-docs?prompt=Prep%20me");
  });
});
