/**
 * The economy at a glance (v0.0.12's retune): every simulated profile over many seeds, with what
 * a typical sortie earns and costs, how often players are broke and how often they need the free
 * emergency plane. Runs under Vitest (the game's modules need Vite):
 *
 *   npx vitest run --config tools/labs/vitest.lab.config.ts economy-report
 */
import { it } from 'vitest';
import { footprint } from '../../src/combat/Collision';
import { layoutTargetRange } from '../../src/combat/Destructibles';
import { AIRCRAFT, AIRCRAFT_ORDER, BASE } from '../../src/config';
import { layoutDefenses } from '../../src/defenses/Layout';
import type { MissionContext } from '../../src/missions/MissionGenerator';
import { generateTerritories } from '../../src/world/WorldGenerator';
import { PROFILE_IDS } from '../../src/director/Performance';
import { simulateEconomy } from '../../src/director/Simulation';

const missions = Number(process.env.MISSIONS ?? 40);
const seeds = Number(process.env.SEEDS ?? 20);

it('prints the economy report', () => {
const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies: range.filter((s) => s.kind === 'dummy'), obstacles: [], installations: layout.installations };

console.log(`base production ${BASE.production}/min; prices: ${AIRCRAFT_ORDER.map((id) => `${id} ${AIRCRAFT[id].cost}/${AIRCRAFT[id].refitCost}`).join(', ')}`);
console.log('profile     | end paper (median, min) | spent/sortie | rewards/sortie | income/sortie | lost | emergencies | longest broke | struggling end');
for (const profile of PROFILE_IDS) {
  const rs = Array.from({ length: seeds }, (_, i) => simulateEconomy({ profile, missions, seed: i + 1, ctx }));
  const ends = rs.map((r) => r.paperEnd).sort((a, b) => a - b);
  const n = rs.reduce((s, r) => s + r.missions, 0);
  const avg = (f: (r: (typeof rs)[number]) => number) => (rs.reduce((s, r) => s + f(r), 0) / n).toFixed(1);
  const broke = Math.max(...rs.map((r) => r.longestBroke));
  console.log(
    `${profile.padEnd(11)} | ${String(ends[Math.floor(ends.length / 2)]).padStart(6)}, ${String(ends[0]).padStart(5)}       | ${avg((r) => r.spent).padStart(12)} | ${avg((r) => r.rewards).padStart(14)} | ${avg((r) => r.income).padStart(13)} | ${avg((r) => r.planesLost).padStart(4)} | ${avg((r) => r.emergencies).padStart(11)} | ${String(broke).padStart(13)} | ${rs.every((r) => r.alwaysFlyable)}`,
  );
}
});
