/**
 * Usernames (v0.0.12, approved by the developer on 2026-11-05): what everyone sees a player as,
 * chosen once and shown everywhere a name is shown (scoreboard, name tags, kill feed, "{username}'s
 * desk"). Shared by the browser (to say what's wrong before asking) and the server (which decides).
 *
 * - 3 to 16 letters, digits or `_`.
 * - Unique across the game, ignoring case (the store enforces it).
 * - Not offensive (a block list, also matched through simple look-alike spellings) and not one of
 *   the reserved names.
 * - Changed at most once every USERNAME.cooldown seconds; who owns what never depends on it.
 */

export const USERNAME = {
  min: 3,
  max: 16,
  /** A username can be changed this often (seconds): once a week. */
  cooldown: 7 * 24 * 3600,
} as const;

export const RESERVED_USERNAMES: readonly string[] = ['admin', 'mod', 'server', 'ai', 'system'];

/**
 * Words no username may contain (after look-alikes are undone: 0→o, 1→i, 3→e, 4→a, 5→s, 7→t,
 * @→a, $→s, and `_` removed). Kept short and obvious; the developer can extend it.
 */
const BLOCKED: readonly string[] = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'dick', 'cock', 'pussy', 'wank', 'twat', 'slut', 'whore', 'porn', 'sex',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'spastic', 'tranny', 'kike', 'chink', 'spic', 'paki', 'wetback', 'gook',
  'nazi', 'hitler', 'rape', 'rapist', 'pedo', 'kill yourself', 'kys',
];

/** Why a username can't be used, in words for the player. */
export type UsernameProblem = 'length' | 'characters' | 'reserved' | 'blocked';

export const USERNAME_PROBLEMS: Record<UsernameProblem | 'taken' | 'cooldown', string> = {
  length: `A username is ${USERNAME.min} to ${USERNAME.max} characters.`,
  characters: 'Use only letters, digits and _ in a username.',
  reserved: 'That username is reserved.',
  blocked: "That username isn't allowed. Try another.",
  taken: 'That username is taken. Try another.',
  cooldown: 'You can change your username once a week.',
};

/** Undoes simple look-alike spellings, for the block list. */
function plain(name: string): string {
  const map: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };
  return name
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => map[c])
    .replace(/_/g, '');
}

/** What's wrong with `name` as a username, or null if it can be used (if nobody else has it). */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME.min || name.length > USERNAME.max) return 'length';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'characters';
  const lower = name.toLowerCase().replace(/_/g, '');
  if (RESERVED_USERNAMES.includes(lower)) return 'reserved';
  const p = plain(name);
  if (BLOCKED.some((w) => p.includes(w.replace(/\s/g, '')))) return 'blocked';
  return null;
}

/**
 * A username made from a display name, if it would do: spaces become `_`, anything else that isn't
 * allowed goes. Null if nothing usable is left. (Existing players are asked on their next join, with
 * this filled in.)
 */
export function suggestUsername(display: string): string | null {
  const s = display.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, USERNAME.max);
  return usernameProblem(s) === null ? s : null;
}

/** The same name as far as uniqueness goes (and for keeping AI desk names apart from players'). */
export function sameName(a: string, b: string): boolean {
  const k = (s: string) => s.toLowerCase().replace(/[\s_'.-]/g, '');
  return k(a) === k(b);
}

/** "Daniel's desk". */
export function deskLabel(name: string): string {
  return `${name}'s desk`;
}
