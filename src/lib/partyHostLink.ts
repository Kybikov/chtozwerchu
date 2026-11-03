import type { Team } from "./music";

export type PartyHostAccess = {
  code: string;
  token: string;
  name: string;
  team: Team;
};

export function readPartyHostLink(url: URL): PartyHostAccess | null {
  if (
    url.searchParams.get("screen") !== "party" ||
    url.searchParams.get("watch") === "1"
  )
    return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("code") || "";
  const token = fragment.get("host") || "";
  const name = fragment.get("host-name") || "";
  const team = fragment.get("host-team");
  if (
    !/^[A-Z2-9]{5}$/.test(code) ||
    !/^[a-f0-9]{64}$/.test(token) ||
    name.trim() !== name ||
    Array.from(name).length < 2 ||
    Array.from(name).length > 32 ||
    (team !== "girls" && team !== "boys")
  )
    return null;
  return { code, token, name, team };
}

export function partyHostLink(origin: string, access: PartyHostAccess): string {
  const url = new URL("/api/app-shell?screen=party", origin);
  url.searchParams.set("code", access.code);
  url.hash = new URLSearchParams({
    host: access.token,
    "host-name": access.name,
    "host-team": access.team,
  }).toString();
  return readPartyHostLink(url) ? url.href : "";
}
