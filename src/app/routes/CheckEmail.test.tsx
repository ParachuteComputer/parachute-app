import { CheckEmail } from "@/app/routes/CheckEmail";
import { getSession, requestMagicLink } from "@/lib/account/client";
import { saveLastSigninEmail } from "@/lib/account/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/account/client", () => ({
  getSession: vi.fn().mockResolvedValue({ signed_in: false, csrf: "csrf-1" }),
  requestMagicLink: vi.fn().mockResolvedValue(undefined),
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
});
