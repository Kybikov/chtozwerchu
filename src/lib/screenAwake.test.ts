import { describe, expect, it, vi } from "vitest";
import { keepScreenAwake } from "./screenAwake";

class Lock extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}
function setup(request = vi.fn(async () => new Lock())) {
  let isVisible = true;
  const visibility = new EventTarget();
  const onStatus = vi.fn();
  const stop = keepScreenAwake({
    request,
    visibility,
    visible: () => isVisible,
    onStatus,
  });
  const show = (next: boolean) => {
    isVisible = next;
    visibility.dispatchEvent(new Event("visibilitychange"));
  };
  return { stop, show, onStatus, request };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("screen wake lock ownership", () => {
  it("does not request a lock until an initially hidden scene becomes visible", async () => {
    let visible = false;
    const events = new EventTarget();
    const request = vi.fn(async () => new Lock());
    const onStatus = vi.fn();
    const stop = keepScreenAwake({
      request,
      visibility: events,
      visible: () => visible,
      onStatus,
    });
    expect(request).not.toHaveBeenCalled();
    visible = true;
    events.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(onStatus).toHaveBeenLastCalledWith("active");
    stop();
  });
  it("acquires once, releases while hidden, and reacquires on return", async () => {
    const locks: Lock[] = [];
    const request = vi.fn(async () => {
      const l = new Lock();
      locks.push(l);
      return l;
    });
    const s = setup(request);
    await settle();
    expect(s.onStatus).toHaveBeenLastCalledWith("active");
    s.show(true);
    expect(request).toHaveBeenCalledTimes(1);
    s.show(false);
    expect(locks[0].release).toHaveBeenCalledTimes(1);
    s.show(true);
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    s.stop();
    expect(locks[1].release).toHaveBeenCalledTimes(1);
    s.show(false);
    s.show(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("releases a late grant after the scene has unmounted", async () => {
    let resolve!: (lock: Lock) => void;
    const s = setup(
      vi.fn(
        () =>
          new Promise<Lock>((r) => {
            resolve = r;
          }),
      ),
    );
    s.stop();
    const lock = new Lock();
    resolve(lock);
    await settle();
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(s.onStatus).not.toHaveBeenCalledWith("active");
  });
  it("does not fight a system release with repeated requests", async () => {
    const lock = new Lock();
    const s = setup(vi.fn(async () => lock));
    await settle();
    await lock.release();
    await settle();
    expect(s.onStatus).toHaveBeenLastCalledWith("idle");
    expect(s.request).toHaveBeenCalledTimes(1);
    s.stop();
  });
  it("handles a denial without retrying until visibility changes", async () => {
    const s = setup(
      vi.fn(async () => {
        throw new Error("battery saver");
      }),
    );
    await settle();
    expect(s.onStatus).toHaveBeenLastCalledWith("denied");
    expect(s.request).toHaveBeenCalledTimes(1);
    s.show(false);
    s.show(true);
    await settle();
    expect(s.request).toHaveBeenCalledTimes(2);
    s.stop();
  });
  it("retries a request denied during a hide/return race, without overlap", async () => {
    let reject!: (error: Error) => void;
    const request = vi
      .fn<() => Promise<Lock>>()
      .mockImplementationOnce(
        () =>
          new Promise((_, r) => {
            reject = r;
          }),
      )
      .mockResolvedValueOnce(new Lock());
    const s = setup(request);
    s.show(false);
    s.show(true);
    expect(request).toHaveBeenCalledTimes(1);
    reject(new Error("hidden"));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(s.onStatus).toHaveBeenLastCalledWith("active");
    s.stop();
  });
  it("releases a grant received while the page is hidden", async () => {
    let resolve!: (lock: Lock) => void;
    const s = setup(
      vi.fn(
        () =>
          new Promise<Lock>((r) => {
            resolve = r;
          }),
      ),
    );
    s.show(false);
    const lock = new Lock();
    resolve(lock);
    await settle();
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(s.onStatus).not.toHaveBeenCalledWith("active");
    s.stop();
  });
});
