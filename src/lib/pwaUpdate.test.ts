import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { requestPWAUpdate } from "./pwaUpdate";

class Port {
  peer!: Port;
  onmessage?: (event: { data: unknown }) => void;
  onmessageerror?: () => void;
  postMessage(data: unknown) {
    queueMicrotask(() => this.peer.onmessage?.({ data }));
  }
  close() {}
}
class Channel {
  port1 = new Port();
  port2 = new Port();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}
type Client = {
  id: string;
  url: string;
  postMessage: (message: unknown, ports: Port[]) => void;
};
const client = (
  id: string,
  busy: boolean | null,
  url = "https://show.test/?screen=studio",
): Client => ({
  id,
  url,
  postMessage: (_message, ports) => {
    if (busy !== null) ports[0].postMessage({ protocol: 1, busy });
  },
});
const script = readFileSync(
  new URL("../../public/pwa-update-guard.js", import.meta.url),
  "utf8",
);
function worker(before: Client[], after = before) {
  let handler!: (event: unknown) => void;
  const matchAll = vi
    .fn()
    .mockResolvedValueOnce(before)
    .mockResolvedValue(after);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  runInNewContext(script, {
    self: {
      location: { origin: "https://show.test" },
      clients: { matchAll },
      skipWaiting,
      addEventListener: (_type: string, callback: typeof handler) => {
        handler = callback;
      },
    },
    URL,
    MessageChannel: Channel,
    setTimeout,
    clearTimeout,
  });
  return {
    skipWaiting,
    matchAll,
    apply: async (source = before[0]) => {
      let task: Promise<void> | undefined;
      const postMessage = vi.fn();
      handler({
        data: { type: "KHZ_PWA_APPLY", protocol: 1 },
        source,
        ports: [{ postMessage, close: vi.fn() }],
        waitUntil: (promise: Promise<void>) => {
          task = promise;
        },
      });
      await task;
      return postMessage.mock.calls[0]?.[0];
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waiting worker update guard", () => {
  it("activates only after all live application windows report idle", async () => {
    const state = worker([
      client("home", false),
      client("host", false),
      client("tv", false),
    ]);
    expect(await state.apply()).toMatchObject({
      status: "applied",
      busy: 0,
      unknown: 0,
    });
    expect(state.skipWaiting).toHaveBeenCalledOnce();
    expect(state.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
  });
  it("keeps the update waiting while another window is busy", async () => {
    const state = worker([client("home", false), client("answer", true)]);
    expect(await state.apply()).toMatchObject({ status: "blocked", busy: 1 });
    expect(state.skipWaiting).not.toHaveBeenCalled();
  });
  it("fails closed for old or unresponsive windows", async () => {
    vi.useFakeTimers();
    const state = worker([client("home", false), client("old", null)]);
    const task = state.apply();
    await vi.advanceTimersByTimeAsync(1801);
    expect(await task).toMatchObject({ status: "blocked", unknown: 1 });
    expect(state.skipWaiting).not.toHaveBeenCalled();
  });
  it("ignores a busy window closed during the check", async () => {
    const home = client("home", false);
    const state = worker([home, client("closed", true)], [home]);
    expect(await state.apply()).toMatchObject({ status: "applied" });
  });
  it("requires a retry for a window opened during the check", async () => {
    const home = client("home", false);
    const state = worker([home], [home, client("new", false)]);
    expect(await state.apply()).toMatchObject({
      status: "blocked",
      unknown: 1,
    });
    expect(state.skipWaiting).not.toHaveBeenCalled();
  });
  it("ignores legacy pages but refuses requests from them", async () => {
    const legacy = client("classic", null, "https://show.test/classic/");
    const state = worker([client("home", false), legacy]);
    expect(await state.apply()).toMatchObject({ status: "applied" });
    expect(await state.apply(legacy)).toBeUndefined();
  });
  it("does not activate when the browser cannot enumerate windows", async () => {
    const state = worker([client("home", false)]);
    state.matchAll.mockReset().mockRejectedValue(new Error("unavailable"));
    expect(await state.apply()).toMatchObject({
      status: "blocked",
      unknown: 1,
    });
    expect(state.skipWaiting).not.toHaveBeenCalled();
  });
  it("reports a failed activation instead of reporting success", async () => {
    const state = worker([client("home", false)]);
    state.skipWaiting.mockRejectedValueOnce(new Error("activation failed"));
    expect(await state.apply()).toMatchObject({
      status: "blocked",
      unknown: 1,
    });
  });
});

describe("update request channel", () => {
  it("returns the worker result through a private response port", async () => {
    vi.stubGlobal("MessageChannel", Channel);
    const postMessage = vi.fn((_message, ports: Port[]) =>
      ports[0].postMessage({
        type: "KHZ_PWA_RESULT",
        status: "blocked",
        busy: 1,
        unknown: 0,
      }),
    );
    expect(
      await requestPWAUpdate({ postMessage } as unknown as ServiceWorker),
    ).toMatchObject({ status: "blocked", busy: 1 });
  });
  it("rejects invalid worker replies", async () => {
    vi.stubGlobal("MessageChannel", Channel);
    const postMessage = (_message: unknown, ports: Port[]) =>
      ports[0].postMessage({
        type: "KHZ_PWA_RESULT",
        status: "applied",
        busy: -1,
        unknown: 0,
      });
    await expect(
      requestPWAUpdate({ postMessage } as unknown as ServiceWorker),
    ).rejects.toThrow("Не вдалося перевірити");
  });
  it("times out without activating or bypassing the waiting worker", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MessageChannel", Channel);
    const task = requestPWAUpdate({
      postMessage: vi.fn(),
    } as unknown as ServiceWorker);
    const assertion = expect(task).rejects.toThrow("Не вдалося перевірити");
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });
  it("rejects an activation result that still reports busy windows", async () => {
    vi.stubGlobal("MessageChannel", Channel);
    const postMessage = (_message: unknown, ports: Port[]) =>
      ports[0].postMessage({
        type: "KHZ_PWA_RESULT",
        status: "applied",
        busy: 1,
        unknown: 0,
      });
    await expect(
      requestPWAUpdate({ postMessage } as unknown as ServiceWorker),
    ).rejects.toThrow("Не вдалося перевірити");
  });
});
