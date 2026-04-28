// Inline-SVG chart helpers — smoke tests asserting structure of returned strings.

import { describe, it, expect } from "vitest";
import { bar, line, pie, stackedBar, counter } from "../../lib/charts.js";

describe("counter", () => {
  it("renders value and label", () => {
    const html = counter({ label: "Library", value: 24 });
    expect(html).toContain("counter-value");
    expect(html).toContain("24");
    expect(html).toContain("Library");
  });

  it("renders footnote when supplied", () => {
    const html = counter({ label: "x", value: 1, footnote: "n=2 small sample" });
    expect(html).toContain("counter-footnote");
    expect(html).toContain("n=2");
  });

  it("escapes HTML in label and value", () => {
    const html = counter({ label: "<script>", value: "</div>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("bar", () => {
  it("returns SVG with one row per item", () => {
    const svg = bar([
      { label: "A", value: 10 },
      { label: "B", value: 5 }
    ]);
    expect(svg).toContain("<svg");
    expect(svg.match(/<rect/g).length).toBe(2);
  });

  it("empty data renders 'no data' fallback", () => {
    expect(bar([])).toContain("no data");
  });
});

describe("pie", () => {
  it("renders one path per slice + a legend row", () => {
    const html = pie([
      { label: "A", value: 60 },
      { label: "B", value: 40 }
    ]);
    expect((html.match(/<path /g) || []).length).toBe(2);
    expect((html.match(/legend-row/g) || []).length).toBe(2);
  });

  it("zero total → no data", () => {
    expect(pie([{ label: "A", value: 0 }])).toContain("no data");
  });

  it("single 100% slice still produces a valid arc path", () => {
    const html = pie([{ label: "Solo", value: 100 }]);
    expect(html).toContain("<path");
  });
});

describe("line", () => {
  it("renders one circle per data point", () => {
    const svg = line([{ x: "Mon", y: 1 }, { x: "Tue", y: 2 }, { x: "Wed", y: 3 }]);
    expect((svg.match(/<circle/g) || []).length).toBe(3);
  });

  it("single point renders centred", () => {
    const svg = line([{ x: "Mon", y: 5 }]);
    expect(svg).toContain("<circle");
  });
});

describe("stackedBar", () => {
  it("renders one rect per segment", () => {
    const html = stackedBar([
      { label: "Applied", value: 4 },
      { label: "Rejected", value: 1 }
    ]);
    expect((html.match(/<rect /g) || []).length).toBe(2);
    expect(html).toContain("Applied");
  });

  it("zero total → no data", () => {
    expect(stackedBar([{ label: "A", value: 0 }])).toContain("no data");
  });
});
