import { vi } from "vitest";

const queue = [];

export function queueResponse(text) {
  queue.push({ kind: "ok", text });
}

export function queueError(err) {
  queue.push({ kind: "err", err });
}

export function resetQueue() {
  queue.length = 0;
}

export const callProviderMock = vi.fn(async () => {
  const next = queue.shift();
  if (!next) throw new Error("provider-mock: no queued response");
  if (next.kind === "err") throw next.err;
  return next.text;
});
