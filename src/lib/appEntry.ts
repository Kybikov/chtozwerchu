const appScreens = new Set(["studio", "party", "show", "room", "remote"]);

/** New online windows bypass an older worker's cached navigation shell.
 * Local preparation and the BroadcastChannel show may use the cached offline entry. */
export function appEntryURL(
  href: string,
  origin: string,
  online = true,
): string {
  try {
    const url = new URL(href, origin);
    if (
      url.origin !== new URL(origin).origin ||
      !["/", "/index.html", "/api/app-shell"].includes(url.pathname) ||
      !appScreens.has(url.searchParams.get("screen") || "")
    )
      return href;
    url.pathname = online ? "/api/app-shell" : "/";
    return url.href;
  } catch {
    return href;
  }
}

export function publicRoomEntryURL(code: string, origin: string): string {
  if (!/^[A-Z2-9]{5,6}$/.test(code)) return "";
  const url = new URL("/", origin);
  url.searchParams.set("screen", code.length === 6 ? "room" : "party");
  url.searchParams.set(code.length === 6 ? "room" : "code", code);
  return appEntryURL(url.href, origin);
}
