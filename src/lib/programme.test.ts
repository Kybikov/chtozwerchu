import { describe, expect, it, vi } from "vitest";
import { freshSession, restoreSession } from "./music";
import { validProgramme, validProgrammeDraft } from "./programme";

describe("evening programme", () => {
  it("allows an unfinished draft but starts only an equal number of rounds for both teams", () => {
    expect(
      validProgrammeDraft({ title: "Наш вечір", trackIds: [5, 2, 9] }),
    ).toBe(true);
    expect(validProgramme({ title: "Наш вечір", trackIds: [5, 2, 9] })).toBe(
      false,
    );
    expect(validProgramme({ title: "Наш вечір", trackIds: [5, 2, 9, 7] })).toBe(
      true,
    );
    for (const p of [
      { title: " ", trackIds: [1, 2, 3, 4] },
      { title: "Вечір", trackIds: [1, 2, 3, 3] },
      { title: "Вечір", trackIds: [1, 2, 3, NaN] },
      { title: "Вечір", trackIds: Array.from({ length: 17 }, (_, i) => i + 1) },
    ])
      expect(validProgrammeDraft(p)).toBe(false);
  });
  it("restores the exact round order, and discards a corrupted programme without attaching it to a different match", () => {
    const session = {
      ...freshSession(),
      round: 2,
      rounds: 4,
      programme: { title: "Весільна репетиція", trackIds: [9, 3, 8, 4] },
    };
    const storage = { getItem: () => JSON.stringify(session) };
    vi.stubGlobal("localStorage", storage);
    try {
      expect(restoreSession().programme).toEqual(session.programme);
      session.rounds = 8;
      expect(restoreSession().programme).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
