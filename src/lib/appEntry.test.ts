import { describe, expect, it } from "vitest";
import { appEntryURL, publicRoomEntryURL } from "./appEntry";
const origin = "https://show.test";
describe("new app window entry", () => {
  it("routes a five-character contest code with the party code parameter", () => {
    const url = new URL(publicRoomEntryURL("ABC23", origin));
    expect(url.searchParams.get("screen")).toBe("party");
    expect(url.searchParams.get("code")).toBe("ABC23");
    expect(url.pathname).toBe("/api/app-shell");
  });
  it("routes a six-character studio code with the required room parameter", () => {
    const url = new URL(publicRoomEntryURL("ABC234", origin));
    expect(url.searchParams.get("screen")).toBe("room");
    expect(url.searchParams.get("room")).toBe("ABC234");
    expect(url.searchParams.has("code")).toBe(false);
    expect(url.hash).toBe("");
  });
  it("does not build a room destination from invalid input", () => {
    expect(publicRoomEntryURL("../bad", origin)).toBe("");
  });
  it.each(["party", "room", "remote", "show", "studio"])(
    "uses the network shell for %s",
    (screen) => {
      const url = new URL(appEntryURL(`/?screen=${screen}&code=ABC23`, origin));
      expect(url.pathname).toBe("/api/app-shell");
      expect(url.searchParams.get("screen")).toBe(screen);
      expect(url.searchParams.get("code")).toBe("ABC23");
    },
  );
  it("preserves TV roles and keeps the private key in the fragment", () => {
    const url = new URL(
      appEntryURL(
        "/?screen=party&code=ABC23&watch=1&audio=1#tv=private",
        origin,
      ),
    );
    expect(url.searchParams.get("audio")).toBe("1");
    expect(url.searchParams.get("watch")).toBe("1");
    expect(url.hash).toBe("#tv=private");
    expect(url.pathname + url.search).not.toContain("private");
  });
  it("preserves a host key without placing it in the request", () => {
    const url = new URL(
      appEntryURL("/?screen=remote&room=ABC234#token=private", origin),
    );
    expect(url.hash).toBe("#token=private");
    expect(url.searchParams.get("room")).toBe("ABC234");
    expect(url.pathname + url.search).not.toContain("private");
  });
  it("uses the cached navigation entry for an offline local show", () => {
    const url = new URL(
      appEntryURL("/?screen=show&room=local-uuid", origin, false),
    );
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("room")).toBe("local-uuid");
  });
  it("is stable for already converted links", () => {
    const url = appEntryURL("/?screen=room&room=ABC234", origin);
    expect(appEntryURL(url, origin)).toBe(url);
  });
  it.each([
    "https://elsewhere.test/?screen=party",
    "/classic/?screen=party",
    "/api/music?screen=party",
    "/?screen=another-app",
    "/",
  ])("leaves unrelated destinations unchanged: %s", (href) => {
    expect(appEntryURL(href, origin)).toBe(href);
  });
});
