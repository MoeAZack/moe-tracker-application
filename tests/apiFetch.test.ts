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

  it("renews an expired desktop session without the token ever reaching page storage", async () => {
    const stored = new Map<string, string>([["team_tracker_key", "old-build-token"]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const bootstrapSession = vi.fn().mockResolvedValue({ success: true, role: "coach", username: "Coach", expiresAt: null });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: {
        href: "http://127.0.0.1:43123/?desktop=1",
        origin: "http://127.0.0.1:43123",
        reload: vi.fn(),
      },
      moeDesktop: { bootstrapSession },
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });

    const response = await apiFetch("/api/data");

    expect(response.status).toBe(200);
    expect(bootstrapSession).toHaveBeenCalledWith(true);
    const retry = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(retry.get("authorization")).toBeNull();
    expect(stored.has("team_tracker_key")).toBe(false);
    expect(stored.get("team_tracker_role")).toBe("coach");
    expect([...stored.values()].some((value) => value.includes("undefined"))).toBe(false);
  });
});
