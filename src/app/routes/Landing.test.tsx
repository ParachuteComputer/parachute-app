import { Landing } from "@/app/routes/Landing";
import { beginHostedSignin } from "@/lib/vault/hosted-door";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The arrival is now an ENTRY FORK (Aaron's feedback): sign in / create a hosted
// account (primary) OR connect a self-hosted vault (secondary) — NOT vault-naming
// first. Naming moved to the /welcome first-run screen after account creation.

vi.mock("@/lib/vault/hosted-door", () => ({
  beginHostedSignin: vi.fn().mockResolvedValue(undefined),
}));

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/add" element={<div>Add form</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Landing (arrival) entry fork", () => {
  beforeEach(() => {
    vi.mocked(beginHostedSignin).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leads with the hosted email sign-in, not vault-naming", () => {
    renderLanding();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in or create your parachute/i)).toBeInTheDocument();
    // The naming-first prompt is gone from the arrival.
    expect(screen.queryByText(/what should we call your vault/i)).not.toBeInTheDocument();
  });

  it("keeps the primary CTA disabled until a plausible email is entered", () => {
    renderLanding();
    const cta = screen.getByRole("button", { name: /continue with email/i });
    expect(cta).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "not-an-email" },
    });
    expect(cta).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "moss@example.com" },
    });
    expect(cta).toBeEnabled();
  });

  it("hands off to the hosted door's ceremony with the typed email on submit", () => {
    renderLanding();
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "moss@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));
    expect(beginHostedSignin).toHaveBeenCalledWith("moss@example.com");
  });

  it("offers the self-hosted path as a quieter secondary link to /add", () => {
    renderLanding();
    expect(screen.getByRole("link", { name: /connect your own vault/i })).toHaveAttribute(
      "href",
      "/add",
    );
  });
});
