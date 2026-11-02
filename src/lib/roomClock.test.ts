import { describe, expect, it } from "vitest";
import { RoomClock } from "./roomClock";

describe("room presentation clock", () => {
  it("freezes the last countdown during an outage instead of expiring it locally", () => {
    const clock = new RoomClock();
    clock.sync(100000, 1000);
    expect(clock.read(4000)).toBe(103000);
    clock.freeze(4250);
    expect(clock.read(9999999)).toBe(103250);
    expect(Math.ceil((120000 - clock.read(9999999)) / 1000)).toBe(17);
    clock.sync(150000, 10000000);
    expect(clock.read(10000200)).toBe(150200);
  });

  it("uses monotonic elapsed time and ignores invalid server samples", () => {
    const clock = new RoomClock();
    clock.sync(100000, 500);
    clock.sync(NaN, 1000);
    expect(clock.read(1500)).toBe(101000);
    expect(clock.read(400)).toBe(100000);
    clock.freeze(1500);
    clock.freeze(9000);
    expect(clock.read(500000)).toBe(101000);
  });
});
