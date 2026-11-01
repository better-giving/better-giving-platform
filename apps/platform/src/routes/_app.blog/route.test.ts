import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const fetch = vi.hoisted(() =>
  vi.fn(async (_query: string, _params: { from: number; to: number }) => ({
    items: [],
    total: 0,
  }))
);

vi.mock("#/api/sanity", () => ({ sanity: { fetch }, urlFor: vi.fn() }));

import { loader } from "./route";

const load = (search: string) =>
  loader({ ...doc_args(new Request(`https://app.test/blog${search}`)) } as any);

const slice_of = () => fetch.mock.calls[0][1];

beforeEach(() => {
  fetch.mockClear();
});

describe("/blog loader ?page=", () => {
  it.each([
    "abc",
    "0",
    "-1",
    "1.5",
    "",
    " 3",
    "0x3",
    "3e0",
    "1e21",
    "9007199254740993",
    "10001",
  ])("treats page=%j as page 1", async (page) => {
    const res = await load(`?page=${encodeURIComponent(page)}`);
    expect(slice_of()).toEqual({ from: 0, to: 10 });
    expect(res.pageNum).toBe(1);
  });

  it("treats a request with no page as page 1", async () => {
    const res = await load("");
    expect(slice_of()).toEqual({ from: 0, to: 10 });
    expect(res.pageNum).toBe(1);
  });

  it("accepts the last page under the cap", async () => {
    const res = await load("?page=10000");
    expect(slice_of()).toEqual({ from: 99990, to: 100000 });
    expect(res.pageNum).toBe(10000);
  });

  it("passes a positive integer page through", async () => {
    const res = await load("?page=3");
    expect(slice_of()).toEqual({ from: 20, to: 30 });
    expect(res.pageNum).toBe(3);
  });
});

describe("/blog loader nextPageNum", () => {
  it("is absent when page 1 holds every post", async () => {
    fetch.mockResolvedValueOnce({ items: [], total: 10 });
    const res = await load("?page=1");
    expect(res.nextPageNum).toBeUndefined();
  });

  it("points at page 2 when posts remain past page 1", async () => {
    fetch.mockResolvedValueOnce({ items: [], total: 11 });
    const res = await load("?page=1");
    expect(res.nextPageNum).toBe(2);
  });

  it("is absent on the last page under the cap, even with posts remaining", async () => {
    fetch.mockResolvedValueOnce({ items: [], total: 200_000 });
    const res = await load("?page=10000");
    expect(res.nextPageNum).toBeUndefined();
  });
});
