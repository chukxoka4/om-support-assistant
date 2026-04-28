// F2 — extractEmailsFromDom (multi-email regex extraction).

import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { extractEmailsFromDom, EMAIL_RX } from "../../lib/ticket.js";

function dom(html) {
  const w = new Window();
  w.document.body.innerHTML = html;
  return w.document;
}

describe("EMAIL_RX", () => {
  it("matches an email anywhere in a string", () => {
    expect(EMAIL_RX.exec("[a@b.co](mailto:a@b.co)")?.[0]).toBe("a@b.co");
    expect(EMAIL_RX.exec("noise foo@bar.example more")?.[0]).toBe("foo@bar.example");
    expect(EMAIL_RX.exec("nothing here")).toBeNull();
  });
});

describe("extractEmailsFromDom", () => {
  it("returns [] when no contacts list is present", () => {
    expect(extractEmailsFromDom(dom("<div>nothing</div>"))).toEqual([]);
  });

  it("extracts the email from the OM ticket UI shape (decorated text)", () => {
    const root = dom(`
      <ul class="customer-contacts customer-section">
        <li class="customer-email">
          <a href="#" class="contact-main" data-toggle="tooltip">[webtech@synapseresults.com](mailto:webtech@synapseresults.com)</a>
        </li>
      </ul>
    `);
    expect(extractEmailsFromDom(root)).toEqual(["webtech@synapseresults.com"]);
  });

  it("extracts from a plain mailto: anchor as well", () => {
    const root = dom(`
      <ul class="customer-contacts">
        <li class="customer-email">
          <a href="mailto:plain@example.org">plain@example.org</a>
        </li>
      </ul>
    `);
    expect(extractEmailsFromDom(root)).toEqual(["plain@example.org"]);
  });

  it("returns multiple unique emails preserving order", () => {
    const root = dom(`
      <ul class="customer-contacts">
        <li class="customer-email"><a href="#">[a@x.co](mailto:a@x.co)</a></li>
        <li class="customer-email"><a href="mailto:b@x.co">b@x.co</a></li>
        <li class="customer-email"><a href="#">[a@x.co](mailto:a@x.co)</a></li>
      </ul>
    `);
    expect(extractEmailsFromDom(root)).toEqual(["a@x.co", "b@x.co"]);
  });

  it("ignores list items without a valid email", () => {
    const root = dom(`
      <ul class="customer-contacts">
        <li class="customer-email"><a href="#">no email here</a></li>
        <li class="customer-email"><a href="#">[good@x.co](mailto:good@x.co)</a></li>
      </ul>
    `);
    expect(extractEmailsFromDom(root)).toEqual(["good@x.co"]);
  });

  it("only scans inside ul.customer-contacts li.customer-email", () => {
    const root = dom(`
      <ul class="other"><li><a href="mailto:noise@x.co">noise@x.co</a></li></ul>
      <ul class="customer-contacts"><li class="customer-email"><a href="#">real@x.co</a></li></ul>
    `);
    expect(extractEmailsFromDom(root)).toEqual(["real@x.co"]);
  });

  it("safe on null / non-element input", () => {
    expect(extractEmailsFromDom(null)).toEqual([]);
    expect(extractEmailsFromDom({})).toEqual([]);
  });
});
