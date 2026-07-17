import { CheckEmail } from "@/app/routes/CheckEmail";
import { getSession, requestMagicLink, verifySignInCode } from "@/lib/account/client";
import { saveLastSigninEmail } from "@/lib/account/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn().mockResolvedValue({ signed_in: false, csrf: "csrf-1" }),
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
  verifySignInCode: vi.fn().mockResolvedValue(false),
}));

function renderCheckEmail() {
  return render(
    <MemoryRouter initialEntries={["/check-email"]}>
      <Routes>
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/" element={<div>Front door</div>} />
        <Route path="/welcome" element={<div>Welcome dispatcher</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CheckEmail", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getSession).mockReset().mockResolvedValue({ signed_in: false, csrf: "csrf-1" });
    vi.mocked(requestMagicLink).mockReset().mockResolvedValue(undefined);
    vi.mocked(verifySignInCode).mockReset().mockResolvedValue(false);
  });

  it("redirects to the front door when no email is on record", () => {
    renderCheckEmail();
    expect(screen.getByText("Front door")).toBeInTheDocument();
  });

  it("shows the neutral 'check your email' copy for the pending email", () => {
    saveLastSigninEmail("moss@example.com");
    renderCheckEmail();
    expect(screen.getByText(/we sent a sign-in link to/i)).toBeInTheDocument();
    expect(screen.getByText("moss@example.com")).toBeInTheDocument();
    expect(screen.getByText(/works once, expires in 10 min/i)).toBeInTheDocument();
  });

  // F6 / §4.1 — the quiet escape, named for what it does (W2-6: a history-
  // aware WizardShell button, falling back to "/" when nothing's behind —
  // exactly this deep-link render).
  it("has a '← Back to sign in' escape that lands on the front door (F6/§4.1)", () => {
    saveLastSigninEmail("moss@example.com");
    renderCheckEmail();
    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));
    expect(screen.getByText("Front door")).toBeInTheDocument();
  });

  // §4.1 rule 1 — the wordmark stays a link on every ceremony step.
  it("renders the linked wordmark (§4.1)", () => {
    saveLastSigninEmail("moss@example.com");
    renderCheckEmail();
    expect(screen.getByRole("link", { name: /parachute/i })).toBeInTheDocument();
  });

  it("resends the link and confirms", async () => {
    saveLastSigninEmail("moss@example.com");
    renderCheckEmail();
    fireEvent.click(screen.getByRole("button", { name: /resend the link/i }));
    await waitFor(() => expect(screen.getByText(/sent again/i)).toBeInTheDocument());
    expect(requestMagicLink).toHaveBeenCalledWith("moss@example.com", "csrf-1", "/welcome");
  });

  it("auto-advances to the dispatcher when the session flips to signed-in", async () => {
    vi.useFakeTimers();
    try {
      saveLastSigninEmail("moss@example.com");
      vi.mocked(getSession).mockResolvedValue({ signed_in: true, csrf: "csrf-1" });
      renderCheckEmail();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(screen.getByText("Welcome dispatcher")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // W2 app half — the 6-digit code field (AUTH-W2-BRIEF §2's "app half of
  // what W1 shipped server-side").
  describe("the sign-in code field", () => {
    it("is hidden until 'Or type the code from the email' is clicked", () => {
      saveLastSigninEmail("moss@example.com");
      renderCheckEmail();
      expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /type the code from the email/i }));
      expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
    });

    it("auto-submits at 6 digits and navigates on a valid code", async () => {
      saveLastSigninEmail("moss@example.com");
      vi.mocked(verifySignInCode).mockResolvedValue(true);
      renderCheckEmail();
      fireEvent.click(screen.getByRole("button", { name: /type the code from the email/i }));
      fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: "123456" } });
      await waitFor(() => expect(screen.getByText("Welcome dispatcher")).toBeInTheDocument());
      expect(verifySignInCode).toHaveBeenCalledWith("moss@example.com", "123456", "csrf-1");
    });

    it("strips non-digits (paste-with-context) before submitting", async () => {
      saveLastSigninEmail("moss@example.com");
      vi.mocked(verifySignInCode).mockResolvedValue(true);
      renderCheckEmail();
      fireEvent.click(screen.getByRole("button", { name: /type the code from the email/i }));
      fireEvent.change(screen.getByLabelText(/6-digit code/i), {
        target: { value: "Your Parachute code: 123 456" },
      });
      await waitFor(() =>
        expect(verifySignInCode).toHaveBeenCalledWith("moss@example.com", "123456", "csrf-1"),
      );
    });

    it("doesn't submit before 6 digits are entered", () => {
      saveLastSigninEmail("moss@example.com");
      renderCheckEmail();
      fireEvent.click(screen.getByRole("button", { name: /type the code from the email/i }));
      fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: "123" } });
      expect(verifySignInCode).not.toHaveBeenCalled();
    });

    it("shows the endpoint's neutral error and clears the field on a wrong code", async () => {
      saveLastSigninEmail("moss@example.com");
      vi.mocked(verifySignInCode).mockResolvedValue(false);
      renderCheckEmail();
      fireEvent.click(screen.getByRole("button", { name: /type the code from the email/i }));
      const input = screen.getByLabelText(/6-digit code/i);
      fireEvent.change(input, { target: { value: "000000" } });
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/didn't work/i));
      expect(input).toHaveValue("");
      // Still on this screen — no navigation on a failed code.
      expect(screen.queryByText("Welcome dispatcher")).not.toBeInTheDocument();
    });
  });
});
