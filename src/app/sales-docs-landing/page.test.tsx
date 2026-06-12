import { render, screen } from "@testing-library/react";
import SalesDocsLandingPage from "./page";

jest.mock("@/components/sales-docs/sales-docs.css", () => ({}));

jest.mock("@/components/sales-docs/SalesDocsWorkspace", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-sales-docs-workspace" />,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("SalesDocsLandingPage hero prompt", () => {
  it("replaces the CTA link with a first-prompt form", () => {
    render(<SalesDocsLandingPage />);

    expect(
      screen.getByPlaceholderText("Describe your client or situation...")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate a call prep doc" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Generate a call prep doc/ })
    ).not.toBeInTheDocument();
  });
});

describe("SalesDocsLandingPage responsive layout", () => {
  it("uses fluid hero type and a scale-to-fit product mockup", () => {
    render(<SalesDocsLandingPage />);

    expect(
      screen.getByRole("heading", {
        name: /Never enter a sales call unprepared again\./,
      })
    ).toHaveClass("text-[clamp(40px,7vw,76px)]");

    const mockup = screen.getByTestId("sales-docs-product-mockup");
    expect(mockup).toHaveClass("overflow-hidden");
    expect(mockup).toHaveStyle({
      width: "min(1160px, calc(100vw - 32px))",
      aspectRatio: "1160 / 721",
    });
    expect(screen.getByTestId("sales-docs-product-mockup-inner")).toHaveStyle({
      width: "calc(100% / 0.7671957671957672)",
      height: "calc(100% / 0.7671957671957672)",
    });
  });
});
