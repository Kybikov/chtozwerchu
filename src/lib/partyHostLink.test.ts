import { describe, expect, it } from "vitest";
import { partyHostLink, readPartyHostLink } from "./partyHostLink";

const access = {
  code: "ABC23",
  token: "a".repeat(64),
  name: "Ведучий & друзі #1",
  team: "boys" as const,
};
const link = () => new URL(partyHostLink("https://show.test", access));
describe("private party recovery link", () => {
  it("round-trips Unicode metadata and the original team", () => {
    expect(readPartyHostLink(link())).toEqual(access);
  });
  it("keeps the bearer key out of the request path and query", () => {
    const url = link();
    expect(url.pathname + url.search).not.toContain(access.token);
    expect(url.searchParams.get("code")).toBe(access.code);
    expect(url.origin).toBe("https://show.test");
    expect(url.pathname).toBe("/api/app-shell");
  });
  it("never treats a public invite as host access", () => {
    const url = link();
    url.hash = "";
    expect(readPartyHostLink(url)).toBeNull();
  });
  it("refuses the key on viewer and other app routes", () => {
    const url = link();
    url.searchParams.set("watch", "1");
    expect(readPartyHostLink(url)).toBeNull();
    url.searchParams.delete("watch");
    url.searchParams.set("screen", "studio");
    expect(readPartyHostLink(url)).toBeNull();
  });
  it("rejects invalid room codes, missing keys and invalid metadata", () => {
    for (const patch of [
      { code: "../23" },
      { token: "" },
      { token: "a".repeat(65) },
      { token: "x".repeat(64) },
      { name: " " },
      { name: "Ж".repeat(33) },
      { name: " padded " },
    ]) {
      expect(partyHostLink("https://show.test", { ...access, ...patch })).toBe(
        "",
      );
    }
  });
  it("requires a real team instead of silently moving the host", () => {
    const url = link();
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set("host-team", "everyone");
    url.hash = fragment.toString();
    expect(readPartyHostLink(url)).toBeNull();
  });
});
