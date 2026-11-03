import { describe, expect, it, vi } from "vitest";
import { watchPWAController } from "./pwaUpdate";

class Container extends EventTarget {
  controller: ServiceWorker | null = null;
  change(controller: ServiceWorker | null) {
    this.controller = controller;
    this.dispatchEvent(new Event("controllerchange"));
  }
}
const worker = () =>
  ({ scriptURL: "https://show.test/sw.js" }) as ServiceWorker;
describe("PWA controller recovery", () => {
  it("adopts first installation without a reload, then notices an external replacement exactly once", () => {
    const container = new Container(),
      replaced = vi.fn();
    const stop = watchPWAController(container, replaced);
    const first = worker(),
      second = worker();
    container.change(first);
    expect(replaced).not.toHaveBeenCalled();
    container.change(second);
    container.change(second);
    expect(replaced).toHaveBeenCalledTimes(1);
    stop();
  });
  it("notices a new controller for an already open game and releases its listener on close", () => {
    const container = new Container(),
      replaced = vi.fn();
    container.controller = worker();
    const stop = watchPWAController(container, replaced);
    container.change(worker());
    expect(replaced).toHaveBeenCalledTimes(1);
    stop();
    container.change(worker());
    expect(replaced).toHaveBeenCalledTimes(1);
  });
  it("does not treat loss or a repeated controller as a new version", () => {
    const container = new Container(),
      replaced = vi.fn(),
      first = worker();
    container.controller = first;
    const stop = watchPWAController(container, replaced);
    container.change(null);
    container.change(first);
    expect(replaced).not.toHaveBeenCalled();
    container.change(null);
    container.change(worker());
    expect(replaced).toHaveBeenCalledTimes(1);
    stop();
  });
});
