import { get, set } from "idb-keyval";

export type Programme = { title: string; trackIds: number[] };
export const programmeSizes = [4, 8, 12, 16];
export const emptyProgramme = (): Programme => ({
  title: "Наш музичний вечір",
  trackIds: [],
});

export function validProgrammeDraft(value: unknown): value is Programme {
  if (!value || typeof value !== "object") return false;
  const p = value as Programme;
  return (
    typeof p.title === "string" &&
    !!p.title.trim() &&
    p.title.length <= 80 &&
    Array.isArray(p.trackIds) &&
    p.trackIds.length <= 16 &&
    p.trackIds.every(
      (id) => Number.isSafeInteger(id) && id > 0 && id <= 999999999999999,
    ) &&
    new Set(p.trackIds).size === p.trackIds.length
  );
}

export function validProgramme(value: unknown): boolean {
  return (
    validProgrammeDraft(value) && programmeSizes.includes(value.trackIds.length)
  );
}

export async function readProgramme(): Promise<Programme> {
  const p: unknown = await get("khz:programme:v1");
  return validProgrammeDraft(p) ? p : emptyProgramme();
}

export async function saveProgramme(p: Programme) {
  if (!validProgrammeDraft(p))
    throw new Error("Перевір назву та порядок пісень.");
  await set("khz:programme:v1", {
    title: p.title.trim(),
    trackIds: [...p.trackIds],
  });
}
