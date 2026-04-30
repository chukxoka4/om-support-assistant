// Pure paginator helper.

import { describe, it, expect } from "vitest";
import { paginate } from "../../lib/paginate.js";

describe("paginate", () => {
  const items20 = Array.from({ length: 20 }, (_, i) => i);

  it("empty array → totalPages 1, page 1, no rows", () => {
    const p = paginate([], 1, 10);
    expect(p.rows).toEqual([]);
    expect(p.totalPages).toBe(1);
    expect(p.totalItems).toBe(0);
  });

  it("non-array input is safe", () => {
    expect(paginate(null, 1, 10).rows).toEqual([]);
    expect(paginate("oops", 1, 10).rows).toEqual([]);
  });

  it("under-full first page returns all items", () => {
    const p = paginate([1, 2, 3], 1, 10);
    expect(p.rows).toEqual([1, 2, 3]);
    expect(p.totalPages).toBe(1);
  });

  it("page 1 of an exact 20-item list shows first 10", () => {
    const p = paginate(items20, 1, 10);
    expect(p.rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.totalPages).toBe(2);
  });

  it("page 2 of 20 shows last 10", () => {
    const p = paginate(items20, 2, 10);
    expect(p.rows).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("page beyond range clamps to last page", () => {
    const p = paginate(items20, 99, 10);
    expect(p.page).toBe(2);
    expect(p.rows).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("page < 1 clamps to 1", () => {
    expect(paginate(items20, 0, 10).page).toBe(1);
    expect(paginate(items20, -5, 10).page).toBe(1);
  });

  it("perPage default is 10", () => {
    const p = paginate(items20);
    expect(p.rows).toHaveLength(10);
  });

  it("partial last page (25 items, page 3) shows remainder", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const p = paginate(items, 3, 10);
    expect(p.rows).toEqual([20, 21, 22, 23, 24]);
    expect(p.totalPages).toBe(3);
  });
});
