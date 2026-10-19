import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/utils/api";

describe("apiFetch application request defaults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks string bodies as JSON while preserving authorization", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: {
        href: "http://127.0.0.1:43123/review",
        origin: "http://127.0.0.1:43123",
      },
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "team_tracker_key" ? "coach-key" : null,
    });

    await apiFetch("/api/coaching/signals/signal-1/status", {
      method: "POST",
      body: JSON.stringify({ status: "dismissed" }),
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer coach-key");
  });
});
