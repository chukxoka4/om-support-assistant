import { beforeEach, vi } from "vitest";

/** Persists across installChromeMock() so module-level listeners stay valid. */
const storageOnChangedListeners = [];

function makeArea() {
  const store = new Map();
  return {
    _store: store,
    get: vi.fn(async (keys) => {
      if (keys == null) return Object.fromEntries(store);
      if (typeof keys === "string") {
        return store.has(keys) ? { [keys]: store.get(keys) } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
        return out;
      }
      const out = {};
      for (const [k, def] of Object.entries(keys)) {
        out[k] = store.has(k) ? store.get(k) : def;
      }
      return out;
    }),
    set: vi.fn(async (obj) => {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    }),
    remove: vi.fn(async (keys) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
    }),
    clear: vi.fn(async () => store.clear()),
  };
}

function installChromeMock() {
  globalThis.chrome = {
    storage: {
      local: makeArea(),
      sync: makeArea(),
      session: makeArea(),
      onChanged: {
        addListener: vi.fn((fn) => {
          storageOnChangedListeners.push(fn);
        }),
        removeListener: vi.fn((fn) => {
          const i = storageOnChangedListeners.indexOf(fn);
          if (i !== -1) storageOnChangedListeners.splice(i, 1);
        }),
      },
    },
    runtime: {
      getURL: vi.fn((p) => `chrome-extension://test/${p}`),
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      lastError: null,
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(),
      onUpdated: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: null }]),
    },
  };
}

installChromeMock();

/** Fire `chrome.storage.onChanged` listeners (e.g. incoming_selection) in UI tests. */
globalThis.__testFireChromeStorageLocalChange = (changes) => {
  for (const fn of [...storageOnChangedListeners]) {
    fn(changes, "local");
  }
};

beforeEach(() => {
  installChromeMock();
});
