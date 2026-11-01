import type { SuitabilityLevel } from '../aircraft/Aircraft';
import type { Base } from '../base/Base';
import { AIRCRAFT, type AircraftId } from '../config';
import type { BuildKind } from '../systems/GameState';
import { controlLabel } from './controlLabels';
import type { DashboardView, NextStepView } from './views';

/** What the dashboard is built from: the same in single-player and multiplayer. */
export interface DashboardInput {
  paper: number;
  /** Paper per minute right now. */
  rate: number;
  base: Base;
  hangar: Iterable<[AircraftId, { condition: 'ready' | 'recovered'; health: number }]>;
  mission: { title: string; reward: number; bombs: number } | null;
  plane: { id: AircraftId; fit: SuitabilityLevel; cost: number; kind: BuildKind; canBuild: boolean };
  /** The plane lost last sortie (null once something else was flown, or nothing was lost). */
  lostPlane: AircraftId | null;
  /** A plane is on the pad, being folded or ready. */
  onPad: boolean;
  /** A raid is on its way to the home desk. */
  raidInbound: boolean;
  /** Free emergency plane on offer. */
  emergency: boolean;
}

export function dashboardView(d: DashboardInput): DashboardView {
  const { base } = d;
  const r = base.readiness;
  const radar = base.radar;
  const repairs = base.needsRepair.length;
  const repairCost = base.repairAllCost;
  const capacity = base.capacity;
  const hangar = [...d.hangar].map(([id, h]) => ({ id, name: AIRCRAFT[id].name, condition: h.condition, health: Math.min(1, h.health / AIRCRAFT[id].maxHealth) }));

  const rebuild =
    d.lostPlane && !d.onPad && !hangar.some((h) => h.id === d.lostPlane)
      ? { id: d.lostPlane, name: AIRCRAFT[d.lostPlane].name, cost: AIRCRAFT[d.lostPlane].cost, canAfford: d.paper >= AIRCRAFT[d.lostPlane].cost, key: d.plane.id === d.lostPlane ? controlLabel('quickRebuild') : null }
      : null;

  const next: NextStepView[] = [];
  if (d.raidInbound) next.push({ text: 'A raid is coming: fold a fighter and meet it, or trust your guns.', key: controlLabel('fold'), tone: 'warn' });
  if (repairs > 0) {
    next.push(
      d.paper >= repairCost
        ? { text: `Repair ${repairs} damaged structure${repairs === 1 ? '' : 's'} (${repairCost} paper).`, key: null, tone: 'warn' }
        : { text: `${repairs} structure${repairs === 1 ? '' : 's'} need${repairs === 1 ? 's' : ''} repairs: ${repairCost} paper, ${repairCost - d.paper} short.`, key: controlLabel('base'), tone: 'warn' },
    );
  }
  if (d.paper >= capacity * 0.9) next.push({ text: 'Storage is nearly full: spend paper, or build storage boxes.', key: controlLabel('base'), tone: 'warn' });
  if (!d.onPad) {
    if (d.plane.fit === 'unsuitable') next.push({ text: `${AIRCRAFT[d.plane.id].name} can't do this mission: choose another plane or card.`, key: `${controlLabel('prevPlane')} / ${controlLabel('nextPlane')}`, tone: 'warn' });
    else if (d.plane.canBuild) {
      const verb = d.plane.kind === 'refit' ? 'Refit' : d.plane.kind === 'rollout' ? 'Roll out' : 'Fold';
      next.push({ text: `${verb} the ${AIRCRAFT[d.plane.id].name}${d.plane.cost > 0 ? ` (${d.plane.cost} paper)` : ''} and launch.`, key: controlLabel('fold'), tone: 'info' });
    } else if (d.emergency) next.push({ text: 'Not enough paper for any plane: the free emergency plane can fly a mission without bombs.', key: controlLabel('fold'), tone: 'info' });
    else next.push({ text: `Not enough paper for the ${AIRCRAFT[d.plane.id].name}: pick a cheaper plane, or wait for production.`, key: null, tone: 'info' });
  } else next.push({ text: 'The plane is on the pad: launch when ready.', key: controlLabel('launch'), tone: 'good' });
  if (r.total === 0 && d.paper >= 60) next.push({ text: 'Your desk has no defenses yet: a turret helps against raids.', key: controlLabel('base'), tone: 'info' });

  return {
    paper: d.paper,
    capacity,
    rate: d.rate,
    protectedPaper: base.protectedPaper,
    base: { ready: r.ready, total: r.total, integrity: base.integrity, repairs, repairCost, canRepair: repairs > 0 && d.paper >= repairCost, radar: !radar ? 'none' : radar.alive ? 'on' : 'off' },
    hangar,
    mission: d.mission
      ? { title: d.mission.title, reward: d.mission.reward, plane: AIRCRAFT[d.plane.id].name, fit: d.plane.fit, cost: d.plane.cost, kind: d.plane.kind }
      : null,
    rebuild,
    next: next.slice(0, 3),
  };
}
