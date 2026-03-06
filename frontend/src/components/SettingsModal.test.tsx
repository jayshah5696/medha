import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock fetch globally for settings loading
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import SettingsModal from "./SettingsModal";

beforeEach(() => {
  mockFetch.mockReset();
  // Default: settings endpoint returns defaults
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (url === "/api/settings" && (!opts || opts.method !== "POST")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            model_inline: "openai/gpt-4o-mini",
            model_chat: "openai/gpt-4o-mini",
            agent_profile: "default",
            openai_api_key: "",
            openrouter_api_key: "",
            lm_studio_url: "http://localhost:1234/v1",
          }),
      });
    }
    if (url === "/api/settings" && opts?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

describe("SettingsModal", () => {
  it("modal renders when mounted", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("settings")).toBeInTheDocument();
    });
  });

  it("model dropdown has expected options", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("settings")).toBeInTheDocument();
    });
    // Check that model options exist in the DOM
    const options = screen.getAllByRole("option");
    const optionValues = options.map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toContain("openai/gpt-4o-mini");
    expect(optionValues).toContain("openai/gpt-4o");
  });

  it("save button calls api", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("settings")).toBeInTheDocument();
    });
    const saveBtn = screen.getByText("save");
    fireEvent.click(saveBtn);
    await waitFor(() => {
      // Check that POST was called
      const postCalls = (mockFetch.mock.calls as [string, RequestInit?][]).filter(
        (call) => call[1]?.method === "POST"
      );
      expect(postCalls.length).toBeGreaterThan(0);
    });
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("settings")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("x"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
