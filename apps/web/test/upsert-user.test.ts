import { describe, it, expect, vi, afterEach } from "vitest";
import { upsertUserViaApi } from "../lib/upsert-user";

describe("upsertUserViaApi (#15)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs only identity fields — never a role — to the API endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await upsertUserViaApi(
      { googleSub: "sub-1", email: "a@example.com", name: "Ada" },
      "http://api:3000",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe("http://api:3000/api/identity/users/upsert");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ googleSub: "sub-1", email: "a@example.com", name: "Ada" });
    expect(body).not.toHaveProperty("role"); // role is never sent (FR-2)
  });

  it("defaults missing email/name to null (no undefined leakage)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await upsertUserViaApi({ googleSub: "sub-2" }, "http://api:3000");

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const body = JSON.parse(String(call![1]?.body));
    expect(body).toEqual({ googleSub: "sub-2", email: null, name: null });
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    );
    await expect(
      upsertUserViaApi({ googleSub: "sub-3" }, "http://api:3000"),
    ).rejects.toThrow(/upsert failed: 500/);
  });
});
