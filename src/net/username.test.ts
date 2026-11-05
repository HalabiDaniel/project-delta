import { describe, expect, it } from 'vitest';
import { deskLabel, sameName, suggestUsername, usernameProblem } from './Username';

describe('usernames', () => {
  it('takes 3 to 16 letters, digits or _', () => {
    expect(usernameProblem('Ann')).toBeNull();
    expect(usernameProblem('Sky_Ace_2026')).toBeNull();
    expect(usernameProblem('Al')).toBe('length');
    expect(usernameProblem('a'.repeat(17))).toBe('length');
    expect(usernameProblem('Ann Lee')).toBe('characters');
    expect(usernameProblem('Zoë')).toBe('characters');
    expect(usernameProblem('<script>')).toBe('characters');
  });

  it('refuses the reserved names and offensive ones, also through look-alike spellings', () => {
    for (const n of ['admin', 'ADMIN', 'Mod', 'server', 'a_i', 'System']) expect(usernameProblem(n)).toBe('reserved');
    for (const n of ['fuckface', 'Sh1tPilot', 'b1tch', 'n_a_z_i_99']) expect(usernameProblem(n)).toBe('blocked');
    expect(usernameProblem('Classic')).toBeNull();
  });

  it('suggests a username from an old display name when it would do', () => {
    expect(suggestUsername('Ann Lee')).toBe('Ann_Lee');
    expect(suggestUsername('Bo')).toBeNull();
    expect(suggestUsername("D'Arcy!")).toBe('DArcy');
  });

  it('compares names the way uniqueness and desk names do', () => {
    expect(sameName('Big_Greg', 'Big Greg')).toBe(true);
    expect(sameName("Lil' Kevin", 'lil_kevin')).toBe(true);
    expect(sameName('Ann', 'Anna')).toBe(false);
    expect(deskLabel('Daniel')).toBe("Daniel's desk");
  });
});
