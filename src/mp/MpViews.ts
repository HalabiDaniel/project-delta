import { emergencyPlane } from '../systems/GameState';
import { dashboardView } from '../ui/dashboardView';
import { failureText, nextStepText, paperBreakdown } from '../ui/reportText';
import * as pc from 'playcanvas';
import { aircraftRatings, RATING_KEYS, RATING_LABELS } from '../aircraft/Aircraft';
import { assessTouchdown } from '../aircraft/Landing';
import { leadPoint } from '../ai/Gunnery';
import { AI, AIRCRAFT, AIRCRAFT_ORDER, BOMB, DEFENSES, DIRECTOR, PVP, STARTER_AIRCRAFT, THREAT, TIERS, WORLD, type AiRole } from '../config';
import type { Installation } from '../defenses/Installation';
import type { InstallationKind } from '../defenses/Layout';
import type { Mission, Objective } from '../missions/Mission';
import { defenseList } from '../missions/MissionGenerator';
import { planeOwner } from '../net/protocol';
import { ownerOfSide, sideOf, territoryName } from '../net/World';
import type { AircraftMarkerView, AirView } from '../ui/AirHud';
import { BUILDING_ICONS } from '../ui/BaseHud';
import { compass } from '../ui/format';
import type { GarageView } from '../ui/Garage';
import type {
  AircraftStatusView,
  GroundView,
  HudView,
  MissionCardView,
  ObjectiveView,
  RaidAlertView,
  ResultView,
  ScreenPoint,
  TargetIndicator,
  TargetLabelView,
  TerritoryLabel,
  ThreatSummary,
  TrackerView,
} from '../ui/HUD';
import type { IconName } from '../ui/icons';
import type { MiniMapView } from '../ui/MiniMap';
import type { ThreatRingItem, ThreatView } from '../ui/ThreatHud';
import { matchesPreset, outlineChoice } from '../render/GraphicsSettings';
import type { MultiplayerGame, RemoteAircraft } from './MultiplayerGame';

const RETICLE_RANGE = 60;
const MAX_TARGET_LABELS = 8;
const ROCKET_WARNING_RANGE = 160;
const AIRCRAFT_MARKER_RANGE = 230;
const AIRCRAFT_EDGE_RANGE = 140;
const SIGHT_RANGE = 120;
const CRASH_REPORT_DELAY = 1200;

const KIND_ICONS: Record<InstallationKind, IconName> = { turret: 'turret', launcher: 'launcher', radar: 'radar', supply: 'supply', workshop: 'workshop', storage: 'storage' };

interface Goal {
  point: pc.Vec3;
  label: string;
  tone: TargetIndicator['tone'];
  icon: IconName;
  solid: boolean;
  territoryId: string | null;
  targetId?: string;
}

/**
 * Builds single-player's HUD view for multiplayer, from the mirrors the server keeps up to date
 * (GameState, Base, Mission) and the aircraft and installations it reports. It follows Game.ts's
 * view code closely (same cards, garage, tracker, report, mini-map, threat ring and aircraft
 * markers), with other players added: their planes are hostile markers with their names, their
 * bases show on the mini-map, and a raid on your base takes the place of single-player's raid alert.
 */
export class MpViews {
  private readonly v1 = new pc.Vec3();
  private readonly v2 = new pc.Vec3();
  private readonly v3 = new pc.Vec3();
  private readonly rel = new pc.Vec3();
  private readonly screen = new pc.Vec3();

  constructor(private readonly g: MultiplayerGame) {}

  /** The transfer code from the pause menu, while it is still valid. */
  private transferView(): { code: string; minutes: number } | null {
    const t = this.g.net.transfer;
    if (!t) return null;
    const left = t.expires - (Date.now() - t.at) / 1000;
    return left > 0 ? { code: t.code, minutes: Math.max(1, Math.ceil(left / 60)) } : null;
  }

  private get myPlane(): string {
    return `pl:${this.g.me}`;
  }

  hud(): HudView {
    const g = this.g;
    const st = g.state;
    const phase = st?.phase ?? 'desk';
    const plane = g.plane;
    const flying = phase === 'flying';
    const choosing = phase === 'desk' || phase === 'building' || phase === 'ready';
    const mission = st ? (choosing ? (st.offers[st.selected] ?? null) : st.mission) : null;
    const baseOpen = !!g.baseMode?.open;
    const eco = g.priv.economy;

    let nose: ScreenPoint | null = null;
    let aim: ScreenPoint | null = null;
    if (flying) {
      nose = this.project(plane.getForward(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
      aim = this.project(plane.getAimDirection(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
    }
    const from = choosing ? g.launch : plane.position;
    const goal = st ? this.currentGoal(mission, from) : null;
    let target: TargetIndicator | null = null;
    if (goal && !(goal.targetId && this.aircraft(goal.targetId))) {
      const distance = goal.solid ? this.v2.copy(goal.point).sub(from).length() : Math.hypot(goal.point.x - from.x, goal.point.z - from.z);
      target = { ...this.indicator(goal.point), label: goal.label, distance, tone: goal.tone, icon: goal.icon, near: !goal.solid && distance < 15 };
    }

    const labels: TerritoryLabel[] = [];
    const eye = g.camera.entity.getPosition();
    const roles = this.objectiveTerritories(mission);
    for (const t of g.territories) {
      if (flying && Math.hypot(t.x - eye.x, t.z - eye.z) < t.size * 0.75) continue;
      if (goal?.territoryId === t.id && target?.onScreen) continue;
      if (g.owners.has(t.id) && t.id !== g.home?.id) continue; // the owner's tag says it
      const p = this.project(this.v3.set(t.x, 0.3, t.z));
      if (p) labels.push({ id: t.id, role: t.id === g.home?.id ? 'home' : roles.get(t.id) === false ? 'objective' : 'neutral', state: 'peaceful', x: p.x, y: p.y });
    }

    // The fold / launch button and its note.
    let note: string | null = null;
    let tag: string | null = null;
    let noteTone: 'bad' | 'info' = 'info';
    const buildCost = st?.buildCost ?? 0;
    const name = st ? (st.plane ?? st.chosen).name : '';
    if (st && mission && (phase === 'desk' || phase === 'ready')) {
      const fit = st.suitability(st.plane?.id ?? st.aircraft, mission);
      if (fit.level === 'unsuitable') {
        noteTone = 'bad';
        tag = '✗';
        note = `The ${name} can't fly this mission: ${fit.reason}. Choose another plane (Q/E) or mission.`;
      } else if (phase === 'desk' && g.priv.garage?.emergency) {
        noteTone = 'bad';
        tag = 'Scrap';
        note = `You can't afford any plane: a free emergency Swift has half the ink, no bomb, for one sortie.${mission.spec.bombs > 0 ? ' Pick a mission without bombs for it.' : ''}`;
      } else if (phase === 'desk' && !g.resources.canAfford(buildCost)) {
        const wait = st.income.timeToAfford(g.resources.paper, buildCost);
        noteTone = 'bad';
        tag = `−${buildCost - g.resources.paper}`;
        note = `Need ${buildCost} paper, you have ${g.resources.paper}.${wait !== null ? ` Ready in about ${Math.ceil(wait)} s.` : ' Fly a mission to earn more.'}`;
      }
    }
    const card = mission ? g.cards.get(mission) : undefined;
    if (!note && card?.pvp && choosing) {
      note = pvpNote(card.pvp.kind, card.pvp.name);
      tag = 'Rival';
    }

    const m = plane.motion;
    const f = m.flight;
    const emergencyNow = !!g.priv.garage?.emergency && !g.resources.canAfford(buildCost);
    const landing = flying && this.onApproach()
      ? (() => {
          const s = m.touchdownState();
          return { speed: s.speed, sink: s.sink, rollDeg: (s.roll * 180) / Math.PI, check: assessTouchdown(s) };
        })()
      : null;
    return {
      phase,
      paused: g.paused,
      baseMode: baseOpen,
      hints: g.input.isHeld('KeyH') || (st?.phase === 'desk' && (g.room?.state.players.get(g.me ?? '')?.missions ?? 0) < 2),
      economy: {
        paper: eco?.paper ?? 0,
        capacity: eco?.capacity ?? 0,
        rate: eco?.rate ?? 0,
        state: eco?.state ?? 'producing',
        progress: eco?.progress ?? 0,
        protectedPaper: eco?.protectedPaper ?? 0,
        streak: 0,
        repairs: g.base?.needsRepair.length ?? 0,
      },
      desk: {
        cost: buildCost,
        kind: st ? (phase === 'desk' ? st.buildKindFor(st.aircraft) : st.buildKind) : 'fold',
        name,
        note,
        tag,
        noteTone,
        progress: st?.buildProgress ?? 0,
        emergency: emergencyNow,
        canBuild: !!st && !!mission && phase === 'desk' && (g.resources.canAfford(buildCost) || emergencyNow) && st.suitability(st.aircraft, mission).level !== 'unsuitable',
      },
      swaps: g.priv.swaps ?? 0,
      welcome: null,
      menu: {
        session: { missionsCompleted: 0, missionsFailed: 0, paperEarned: 0, paperSpent: 0, aircraftLost: 0, enemiesDestroyed: 0, best: '—', achievements: [], minutes: 0 },
        settings: {
          muted: g.sounds.muted,
          hints: 'auto',
          uiScale: 1,
          graphics: { preset: matchesPreset(g.graphics) ? g.graphics.preset : null, outlines: outlineChoice(g.graphics), intensity: g.graphics.outlineIntensity },
        },
        saveNote: 'Multiplayer: your paper, base and planes live on the server. "Leave classroom" frees your desk.',
        transfer: this.transferView(),
        confirmingReset: false,
      },
      garage: st && choosing && !baseOpen && mission ? this.garageView(mission) : null,
      cards: st && choosing ? st.offers.map((x) => this.cardView(x)) : null,
      selected: st?.selected ?? 0,
      tracker: st && !choosing && mission && !baseOpen ? this.tracker(mission, from) : null,
      flight: flying
        ? {
            speed: m.speed,
            speedFrac: (m.speed - f.minSpeed) / (f.maxSpeed + f.boostSpeed - f.minSpeed),
            throttleFrac: (m.throttleSpeed - f.minSpeed) / (f.maxSpeed + f.boostSpeed - f.minSpeed),
            altitude: m.position.y,
            boost: { state: m.boost.state, level: m.boost.level },
            autopilot: g.predictor.flight.boundary.state === 'autopilot',
          }
        : null,
      aircraft: this.aircraftStatus(),
      ground: this.groundView(),
      landing,
      boundary: { state: flying ? g.predictor.flight.boundary.state : 'inside', countdown: g.predictor.flight.boundary.countdown },
      result: this.result(),
      pointerLocked: g.input.pointerLocked || g.controls.padFlying,
      nose,
      aim,
      target,
      labels,
      targets: flying || (phase === 'landed' && !baseOpen) ? this.targetLabels(mission) : [],
      minimap: this.minimapView(mission, goal?.point ?? null),
      threat: flying ? this.threatView() : null,
      air: this.airView(flying, aim),
      raid: this.raidAlert(),
      base: baseOpen && g.baseMode && g.base ? g.baseMode.view((x, z) => this.project(this.v3.set(x, 1.2, z)), phase === 'ready' || phase === 'landed', g.priv.raid ?? null) : null,
      tutorial: st && g.tutorialReady ? g.tutorial.view(g.tutorialContext()) : null,
      dashboard:
        st && g.base && choosing && !baseOpen
          ? dashboardView({
              paper: g.resources.paper,
              rate: eco?.rate ?? 0,
              base: g.base,
              hangar: st.hangar,
              mission: mission ? { title: mission.title, reward: mission.reward, bombs: mission.spec.bombs } : null,
              plane: {
                id: st.aircraft,
                fit: mission ? st.suitability(st.aircraft, mission).level : 'possible',
                cost: buildCost,
                kind: phase === 'desk' ? st.buildKindFor(st.aircraft) : st.buildKind,
                canBuild: !!mission && phase === 'desk' && g.resources.canAfford(buildCost) && st.suitability(st.aircraft, mission).level !== 'unsuitable',
              },
              lostPlane: g.lostPlane,
              onPad: phase !== 'desk',
              raidInbound: this.raidAlert() !== null,
              emergency: emergencyNow,
            })
          : null,
    };
  }

  // ---- Cards, garage, status ------------------------------------------------------------------------

  private cardView(m: Mission): MissionCardView {
    const g = this.g;
    const st = g.state!;
    const card = g.cards.get(m);
    const tier = TIERS[m.tier];
    const parts = m.spec.rewardParts;
    const slot = card?.slot === 'pvp' ? 'risky' : (card?.slot ?? 'safe');
    return {
      type: m.spec.type,
      codename: m.spec.codename ?? '',
      title: m.title,
      description: m.spec.description,
      slot,
      slotLabel: card?.pvp ? `Rival · ${card.pvp.name}` : (card?.slotLabel ?? 'Safe'),
      tier: m.tier,
      tierLabel: tier.label,
      stars: tier.stars,
      multiplier: tier.multiplier,
      reward: m.reward,
      rewardNote: parts ? `Reward = B ${Math.round(parts.base)} × D ${parts.difficulty} × M ${parts.modifier.toFixed(2)}${parts.floor ? ` (at least ${parts.floor})` : ''}` : card?.pvp ? 'Paid by the game, not taken from your rival' : '',
      modifiers: (m.spec.modifiers ?? []).map((id) => ({ id, label: DIRECTOR.modifiers[id].label, detail: DIRECTOR.modifiers[id].detail })),
      recommended: false,
      expires: null,
      operation: null,
      bombs: m.spec.bombs,
      timeLimit: m.spec.timeLimit,
      threat: card?.pvp ? this.pvpThreat(card.pvp.territoryId) : threatSummary(m),
      fits: AIRCRAFT_ORDER.map((id) => ({ id, name: AIRCRAFT[id].name, level: st.suitability(id, m).level, selected: id === (st.plane?.id ?? st.aircraft) })),
    };
  }

  /** The danger on a rival's base: their weapons and radar as the server reports them. */
  private pvpThreat(territoryId: string | null): ThreatSummary {
    if (!territoryId) return { level: 2, label: 'Rival pilot', detail: 'A player who shoots back', icons: ['fighter'] };
    const on = this.g.network.on(territoryId).filter((i) => i.alive);
    const turrets = on.filter((i) => i.spec.kind === 'turret').length;
    const launchers = on.filter((i) => i.spec.kind === 'launcher').length;
    const radar = on.some((i) => i.spec.kind === 'radar');
    const level = Math.min(3, (turrets > 0 ? 1 : 0) + (launchers > 0 ? 1 : 0) + (radar ? 1 : 0)) as 0 | 1 | 2 | 3;
    const parts = [turrets || launchers ? defenseList(turrets, launchers) : 'no guns', radar ? 'radar' : 'no radar'];
    const icons: IconName[] = [...(turrets ? ['turret' as const] : []), ...(launchers ? ['launcher' as const] : []), ...(radar ? ['radar' as const] : []), 'fighter'];
    return { level, label: 'Player base', detail: `${territoryName(territoryId)}: ${parts.join(' · ')} · its owner may fly up`, icons };
  }

  private garageView(mission: Mission): GarageView {
    const g = this.g;
    const st = g.state!;
    const chosen = st.chosen;
    const ratings = aircraftRatings(chosen);
    const fit = st.suitability(chosen.id, mission);
    const bombKind = BOMB.kinds[chosen.bombs.kind];
    return {
      cards: AIRCRAFT_ORDER.map((id) => {
        const spec = AIRCRAFT[id];
        const waiting = st.hangar.get(id);
        const cost = st.buildCostFor(id);
        return {
          id, name: spec.name, roleLabel: spec.roleLabel, accent: css(spec.accent), cost: spec.cost, buildCost: cost, buildKind: st.buildKindFor(id),
          hangar: waiting?.condition ?? null, hangarHealth: waiting ? waiting.health / spec.maxHealth : null,
          suitability: st.suitability(id, mission).level, selected: id === st.aircraft, affordable: g.resources.canAfford(cost),
        };
      }),
      inspector: {
        name: chosen.name,
        roleLabel: chosen.roleLabel,
        accent: css(chosen.accent),
        tagline: chosen.tagline,
        ratings: RATING_KEYS.map((key) => ({ key, label: RATING_LABELS[key], value: ratings[key] })),
        loadout: [
          { icon: 'ink', value: String(chosen.gun.ammo), label: `${chosen.gunLabel} · ink` },
          { icon: 'bombload', value: String(chosen.bombs.capacity), label: bombKind.label + (chosen.bombs.capacity === 1 ? '' : 's') },
          { icon: 'health', value: String(chosen.maxHealth), label: 'Health' },
          { icon: 'range', value: `${(chosen.range / 1000).toFixed(1)} km`, label: 'Range' },
        ],
        record: null,
        suitability: { level: fit.level, reason: fit.reason, missionTitle: mission.title },
      },
      locked: st.phase === 'building',
    };
  }

  private aircraftStatus(): AircraftStatusView | null {
    const st = this.g.state;
    const spec = st?.plane;
    if (!st || !spec || !st.durability || !st.gun || (st.phase !== 'flying' && st.phase !== 'landed')) return null;
    const bomb = BOMB.kinds[spec.bombs.kind];
    return {
      name: spec.name,
      roleLabel: spec.roleLabel,
      accent: css(spec.accent),
      health: st.durability.health,
      maxHealth: spec.maxHealth,
      rangeLeft: this.g.predictor.range === Infinity ? st.rangeLeft : Math.min(st.rangeLeft, this.g.predictor.range + 50),
      range: spec.range,
      gun: { label: spec.gunLabel, ammo: st.gun.ammo, capacity: st.gun.capacity, ready: st.gun.ammo > 0 },
      bombs: {
        label: bomb.label + 's',
        loaded: st.bombsLoaded,
        capacity: Math.min(spec.bombs.capacity, st.mission?.spec.bombs ?? 0),
        falling: st.bombsFalling,
        cooldown: st.bombCooldown / BOMB.dropCooldown,
        ready: st.bombsLoaded > 0 && st.bombCooldown <= 0 && st.phase === 'flying',
      },
      airborne: st.phase === 'flying',
    };
  }

  private groundView(): GroundView | null {
    const st = this.g.state;
    if (!st || st.phase !== 'landed') return null;
    const mission = st.mission;
    return {
      stopped: !!this.g.priv.plane?.stopped,
      rearming: st.rearmProgress,
      canRearm: st.canRearm(),
      status: mission?.status ?? null,
      reward: mission?.reward ?? 0,
      timeLeft: mission?.timeLeft ?? null,
    };
  }

  private result(): ResultView | null {
    const g = this.g;
    const st = g.state;
    const r = g.priv.result;
    if (!st || !r || (st.phase !== 'debrief' && st.phase !== 'crashed')) return null;
    if (st.phase === 'crashed' && performance.now() - g.crashedAt < CRASH_REPORT_DELAY) return null;
    const failure: Record<string, string> = {
      missed: 'Failed: out of bombs',
      'out-of-time': 'Failed: out of time',
      'aircraft-lost': 'Failed: plane lost',
      abandoned: 'Failed: landed before finishing',
      'target-escaped': 'Failed: it got away',
      'target-bombed': 'Failed: the bomb was released',
      'escort-lost': 'Failed: your bomber was lost',
    };
    const spec = AIRCRAFT[r.sortie.aircraft];
    const s = r.sortie;
    const succeeded = r.status === 'succeeded';
    const killedBy = s.killedBy;
    const report = g.priv.report;
    return {
      recovered: r.recovered,
      headline: r.recovered ? 'Plane recovered' : killedBy ? 'Shot down' : 'Plane destroyed',
      aircraftName: s.emergency ? `Emergency ${AIRCRAFT[STARTER_AIRCRAFT].name}` : spec.name,
      missionTitle: r.missionTitle,
      missionLine: succeeded ? `Complete · +${r.reward}` : failure[r.failure ?? 'abandoned'],
      missionTone: succeeded ? 'good' : 'bad',
      planeLine: r.recovered ? `in the hangar, refit ${spec.refitCost}` : `destroyed, next costs ${spec.cost}`,
      time: r.elapsed,
      damageDealt: s.damageDealt,
      damageTaken: s.damageTaken,
      targetsDestroyed: s.targetsDestroyed,
      bombsDropped: s.bombsDropped,
      bombHits: s.bombHits,
      shotsFired: s.shotsFired,
      shotsHit: s.shotsHit,
      defensesDestroyed: s.defensesDestroyed,
      enemyShots: s.enemyShots,
      enemyHits: s.enemyHits,
      aircraftDestroyed: s.aircraftDestroyed,
      bombersIntercepted: s.bombersIntercepted,
      objectivesProtected: s.objectivesProtected,
      paperLost: s.paperLost,
      paperOverflow: s.paperOverflow,
      survival: r.recovered ? 'Survived' : killedBy ? `Shot down by ${killedBy}` : 'Lost: crashed',
      survived: r.recovered,
      health: r.recovered ? (st.durability?.fraction ?? 1) : 0,
      paperSpent: s.paperSpent,
      paperEarned: s.paperEarned,
      medal: null,
      criteria: null,
      bonuses: [],
      records: [],
      achievements: [],
      streak: 0,
      failure: succeeded ? null : failureText(r.failure ?? null),
      paper: paperBreakdown({ reward: succeeded ? r.reward : 0, missionTitle: r.missionTitle, bonuses: [], earned: s.paperEarned, spent: s.paperSpent, lost: s.paperLost, overflow: s.paperOverflow }),
      next: nextStepText({ succeeded, recovered: r.recovered, aircraftName: s.emergency ? emergencyPlane().name : spec.name, refitCost: spec.refitCost, cost: spec.cost, repairs: g.base?.needsRepair.length ?? 0 }),
      operation: report && report.role === 'attacker' ? `Raid on ${report.other}: ${report.outcome === 'bombed' ? `got through${report.paperLost > 0 ? `, they lost ${report.paperLost} paper` : ''}` : report.outcome === 'repelled' ? 'repelled' : 'called off'}` : null,
    };
  }

  // ---- Missions in flight ---------------------------------------------------------------------------

  private currentGoal(mission: Mission | null, from: pc.Vec3): Goal | null {
    const g = this.g;
    const st = g.state!;
    const home = g.home;
    if (st.phase === 'debrief' || st.phase === 'crashed' || !mission || !home) return null;
    if ((st.phase === 'flying' || st.phase === 'landed') && !mission.isActive) {
      if (st.phase === 'landed') return null;
      return { point: new pc.Vec3(home.x, 0.5, home.z), label: `${home.id} · Land`, tone: 'home', icon: 'land', solid: false, territoryId: home.id };
    }
    let best: Goal | null = null;
    let bestDistance = Infinity;
    for (const i of mission.openObjectives()) {
      const o = mission.objectives[i];
      if (o.kind === 'intercept' || o.kind === 'escort') {
        const ids = o.kind === 'intercept' ? o.targets : [o.escort];
        let flying = false;
        for (const id of ids) {
          const a = this.aircraft(this.serverId(id));
          if (!a) continue;
          flying = true;
          const d = Math.hypot(a.model.position.x - from.x, a.model.position.z - from.z);
          if (d >= bestDistance) continue;
          bestDistance = d;
          const name = this.aircraftName(a);
          best = o.kind === 'escort'
            ? { point: new pc.Vec3().copy(a.model.position), label: `Your ${AIRCRAFT[a.spec.id].name}`, tone: 'home', icon: 'escort', solid: true, territoryId: null, targetId: a.id }
            : { point: new pc.Vec3().copy(a.model.position), label: name, tone: 'target', icon: (a.role as IconName) ?? 'fighter', solid: true, territoryId: null, targetId: a.id };
        }
        if (flying) continue;
      }
      if (o.kind === 'destroy') {
        const done = mission.progress[i] >= 1;
        for (const id of o.targets) {
          const inst = g.network.get(id);
          if (!inst || !inst.alive || done) continue;
          const at = g.defenseModels.centre(id, new pc.Vec3());
          const d = Math.hypot(at.x - from.x, at.z - from.z);
          if (d >= bestDistance) continue;
          bestDistance = d;
          best = { point: at, label: inst.spec.name, tone: 'target', icon: inst.spec.kind, solid: true, territoryId: o.territoryId, targetId: id };
        }
        continue;
      }
      const p = this.objectivePoint(o, new pc.Vec3());
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= bestDistance) continue;
      bestDistance = d;
      const owner = 'territoryId' in o ? this.ownerName(o.territoryId) : null;
      const where = 'territoryId' in o ? (owner ? `${owner}'s base` : o.territoryId) : '';
      switch (o.kind) {
        case 'bomb': best = { point: p, label: o.precision ? `${where} spot` : where, tone: 'target', icon: 'bomb', solid: false, territoryId: o.territoryId }; break;
        case 'recon': best = { point: p, label: where, tone: 'target', icon: 'recon', solid: false, territoryId: o.territoryId }; break;
        case 'reach': best = { point: p, label: where, tone: 'target', icon: 'reach', solid: false, territoryId: o.territoryId }; break;
        case 'survive': best = { point: p, label: `Hold out over ${where}`, tone: 'target', icon: 'survive', solid: false, territoryId: o.territoryId }; break;
        case 'escape': best = { point: p, label: 'Escape', tone: 'home', icon: 'escape', solid: false, territoryId: null }; break;
        case 'ring': best = { point: p, label: `Ring ${o.number}/${mission.objectives.length}`, tone: 'ring', icon: 'ring', solid: true, territoryId: null }; break;
        case 'land': best = { point: p, label: `${home.id} · Land`, tone: 'home', icon: 'land', solid: false, territoryId: home.id }; break;
        case 'intercept': best = { point: p, label: where, tone: 'target', icon: o.what === 'aircraft' ? 'fighter' : o.what === 'convoy' ? 'bomber' : o.what, solid: false, territoryId: o.territoryId }; break;
        case 'escort': best = { point: p, label: `${where} · bomber's target`, tone: 'target', icon: 'bomb', solid: false, territoryId: o.territoryId }; break;
        case 'patrol': best = { point: p, label: `Patrol over ${where}`, tone: 'target', icon: 'patrol', solid: false, territoryId: o.territoryId }; break;
      }
    }
    return best;
  }

  private objectivePoint(o: Objective, out: pc.Vec3): pc.Vec3 {
    const home = this.g.home ?? { x: 0, z: 0 };
    switch (o.kind) {
      case 'bomb':
      case 'escort': return out.set(o.zone.x, o.zone.top + 0.5, o.zone.z);
      case 'recon':
      case 'reach':
      case 'survive':
      case 'patrol': return out.set(o.airspace.x, 0.5, o.airspace.z);
      case 'ring': return out.set(o.gate.x, o.gate.y, o.gate.z);
      case 'land': return out.set(home.x, 0.5, home.z);
      case 'escape': {
        const dx = home.x - o.x;
        const dz = home.z - o.z;
        const len = Math.hypot(dx, dz) || 1;
        return out.set(o.x + (dx / len) * o.distance, 0.5, o.z + (dz / len) * o.distance);
      }
      case 'destroy':
      case 'intercept': {
        const t = this.g.territories.find((x) => x.id === o.territoryId);
        return out.set(t?.x ?? 0, 0.5, t?.z ?? 0);
      }
    }
  }

  private objectiveTerritories(mission: Mission | null): Map<string, boolean> {
    const result = new Map<string, boolean>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind === 'ring' || o.kind === 'land' || o.kind === 'escape') return;
      result.set(o.territoryId, (result.get(o.territoryId) ?? true) && mission.isDone(i));
    });
    return result;
  }

  private objectiveLabel(mission: Mission, index: number): string {
    const o = mission.objectives[index];
    const where = (id: string) => this.ownerName(id) ?? id;
    switch (o.kind) {
      case 'bomb':
        if (o.approach) return `Low bomb ${where(o.territoryId)} <${o.approach.ceiling} m`;
        return o.precision ? `Ink spot ${where(o.territoryId)}` : `Bomb ${where(o.territoryId)}`;
      case 'recon': return `Scout ${where(o.territoryId)} <${o.airspace.ceiling} m`;
      case 'reach': return `Reach ${where(o.territoryId)}`;
      case 'ring': return `Ring ${o.number}/${mission.objectives.length}`;
      case 'land': return `Land ${o.territoryId}`;
      case 'survive': return `Hold ${o.territoryId} ${Math.floor(mission.progress[index] * o.duration)}/${o.duration}s`;
      case 'escape': return `Escape ${o.territoryId} ${o.distance} m`;
      case 'destroy': {
        const n = Math.round(mission.progress[index] * o.count);
        switch (o.what) {
          case 'radar': return `Radar ${o.territoryId}`;
          case 'supply': return `Depot ${o.territoryId}`;
          case 'defense': return `Defenses ${o.territoryId} ${n}/${o.count}`;
          case 'shipment': return `Shipment ${o.territoryId}`;
          default: return `Practice ${o.territoryId} ${n}/${o.count}`;
        }
      }
      case 'intercept': {
        const rival = o.targets.map((id) => planeOwner(id)).find((id) => id !== null);
        if (rival) return `Down ${this.g.room?.state.players.get(rival)?.name ?? 'rival'}`;
        const n = Math.round(mission.progress[index] * o.count);
        switch (o.what) {
          case 'bomber': return 'Bomber';
          case 'scout': return 'Scout';
          case 'fighter': return o.count > 1 ? `Fighters ${o.territoryId} ${n}/${o.count}` : `Fighter ${o.territoryId}`;
          case 'convoy': return 'Convoy';
          default: return `Intruders ${n}/${o.count}`;
        }
      }
      case 'escort': return `Escort to ${o.territoryId}`;
      case 'patrol': return `Patrol ${o.territoryId} ${Math.floor(mission.progress[index] * o.duration)}/${o.duration}s`;
    }
  }

  private objectiveIcon(o: Objective): IconName {
    switch (o.kind) {
      case 'destroy':
        return o.what === 'radar' ? 'radar' : o.what === 'supply' || o.what === 'shipment' ? 'supply' : o.what === 'defense' ? 'turret' : 'practice';
      case 'intercept':
        return o.what === 'scout' ? 'scout' : o.what === 'fighter' ? 'fighter' : o.what === 'aircraft' ? 'patrol' : 'bomber';
      default:
        return o.kind;
    }
  }

  private tracker(mission: Mission, from: pc.Vec3): TrackerView {
    const objectives: ObjectiveView[] = [];
    const rings = mission.objectives.filter((o) => o.kind === 'ring');
    if (rings.length > 0) {
      const done = mission.progress.filter((p) => p >= 1).length;
      const next = mission.openObjectives()[0];
      const gate = next !== undefined ? mission.objectives[next] : null;
      objectives.push({
        label: `Rings ${done}/${rings.length}`, icon: 'ring', done: mission.allDone, open: !mission.allDone, progress: done / rings.length,
        distance: gate?.kind === 'ring' ? Math.hypot(gate.gate.x - from.x, gate.gate.y - from.y, gate.gate.z - from.z) : null,
      });
    } else {
      mission.objectives.forEach((o, i) => {
        const p = this.objectivePoint(o, this.v3);
        objectives.push({
          label: this.objectiveLabel(mission, i),
          icon: this.objectiveIcon(o),
          done: mission.isDone(i),
          open: mission.isOpen(i) && mission.isActive,
          progress: o.kind === 'recon' || o.kind === 'destroy' || o.kind === 'survive' || o.kind === 'patrol' || (o.kind === 'intercept' && o.count > 1) ? mission.progress[i] : null,
          distance: Math.hypot(p.x - from.x, p.z - from.z),
        });
      });
    }
    const d = TIERS[mission.tier];
    const card = this.g.cards.get(mission);
    return {
      title: mission.title,
      codename: mission.spec.codename ?? '',
      operation: null,
      modifiers: (mission.spec.modifiers ?? []).map((id) => DIRECTOR.modifiers[id].label),
      threat: card?.pvp ? this.pvpThreat(card.pvp.territoryId) : threatSummary(mission),
      type: mission.spec.type,
      difficultyLabel: d.label,
      stars: d.stars,
      multiplier: d.multiplier,
      reward: mission.reward,
      status: mission.status,
      failure: mission.failure,
      timeLeft: mission.timeLeft,
      objectives,
      hint: this.trackerHint(mission),
    };
  }

  private trackerHint(mission: Mission): string {
    const st = this.g.state!;
    const phase = st.phase;
    if (phase === 'debrief' || phase === 'crashed') return '';
    const home = this.g.home?.id ?? 'home';
    const spec = st.plane;
    if (mission.status === 'succeeded') {
      return phase === 'landed' ? 'Rearm (R) and take off (Space), or end the sortie (Enter).' : `Now land on ${home} to recover your plane: a refit costs ${spec?.refitCost ?? 0} instead of ${spec?.cost ?? 0}.`;
    }
    if (mission.status === 'failed') return `The mission is lost. Land on ${home} to recover the plane anyway.`;
    if (phase === 'landed') return 'R rearms ink and range for free. Space takes off again.';
    const card = this.g.cards.get(mission);
    if (card?.pvp) return pvpNote(card.pvp.kind, card.pvp.name);
    const next = mission.objectives[mission.openObjectives()[0]];
    switch (next?.kind) {
      case 'bomb': return 'Line up on the target and right-click (or Space) to drop. The ball keeps your speed, so release before you are over it.';
      case 'recon': return `Stay low over ${next.territoryId}: time only counts inside the zone, below ${next.airspace.ceiling} m.`;
      case 'reach': return `Get into ${next.territoryId}'s airspace before the clock runs out. Shift boosts.`;
      case 'ring': return 'Fly through the orange ring. The next one lights up when you pass.';
      case 'land': return `Slow down (S), line up with ${home} and descend gently.`;
      case 'survive': return `Stay inside the zone over ${next.territoryId}, below ${next.airspace.ceiling} m. Keep turning.`;
      case 'escape': return `Get out past the line, more than ${next.distance} m from ${next.territoryId}.`;
      case 'destroy': return 'Shoot or bomb the ringed targets.';
      case 'intercept': return 'Find them, get behind them and keep firing. Aim at the small circle to lead your shots.';
      case 'escort': return 'Stay close to your bomber and shoot down the fighters that go for it.';
      case 'patrol': return `Stay over ${next.territoryId}, below ${next.airspace.ceiling} m. Intruders turn up while you patrol.`;
      default: return '';
    }
  }

  // ---- What's around --------------------------------------------------------------------------------

  private targetLabels(mission: Mission | null): TargetLabelView[] {
    const g = this.g;
    const eye = g.camera.entity.getPosition();
    const wanted = new Set<string>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind === 'destroy' && mission.isOpen(i) && mission.isActive) for (const id of o.targets) wanted.add(id);
    });
    type Near = Omit<TargetLabelView, 'x' | 'y' | 'far' | 'mission'> & { point: pc.Vec3; distance: number };
    const near: Near[] = [];
    const mine = sideOf(g.me ?? '');
    for (const i of g.network.installations) {
      if (!i.alive) continue;
      const point = g.defenseModels.labelPoint(i.id, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > DEFENSES.labelRange) continue;
      const own = i.side === mine;
      if (own && i.durability.fraction >= 1 && !i.engaged) continue;
      const state: TargetLabelView['state'] = !i.isWeapon ? null : i.targetId === this.myPlane && i.state !== 'destroyed' ? i.state : 'idle';
      const owner = ownerOfSide(i.side);
      const role = own && i.engaged ? 'Firing at intruders' : owner && !own ? `${g.room?.state.players.get(owner)?.name ?? 'Rival'}'s` : i.spec.role;
      near.push({ id: i.id, name: i.spec.name, role, health: i.durability.fraction, icon: KIND_ICONS[i.spec.kind], state, side: own ? 'player' : 'enemy', point, distance });
    }
    near.sort((a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || a.distance - b.distance);
    const views: TargetLabelView[] = [];
    for (const n of near) {
      if (views.length >= MAX_TARGET_LABELS) break;
      const p = this.project(n.point);
      if (!p) continue;
      views.push({ id: n.id, x: p.x, y: p.y, name: n.name, role: n.role, health: n.health, icon: n.icon, state: n.state, side: n.side, mission: wanted.has(n.id), far: clamp((n.distance - 30) / (DEFENSES.labelRange - 30), 0, 1) });
    }
    return views;
  }

  private minimapView(mission: Mission | null, objective: pc.Vec3 | null): MiniMapView {
    const g = this.g;
    const plane = g.plane;
    const st = g.state;
    const roles = this.objectiveTerritories(mission);
    const zones: MiniMapView['zones'] = [];
    const rings: MiniMapView['rings'] = [];
    const targets: MiniMapView['targets'] = [];
    mission?.objectives.forEach((o, i) => {
      if (mission.isDone(i)) return;
      if (o.kind === 'bomb') zones.push({ x: o.zone.x, z: o.zone.z, precision: o.precision });
      if (o.kind === 'ring') rings.push({ x: o.gate.x, z: o.gate.z, yaw: o.gate.yaw, state: mission.isOpen(i) ? 'open' : 'waiting' });
      if (o.kind === 'destroy') for (const id of o.targets) {
        const at = g.network.get(id)?.spec;
        if (at) targets.push({ x: at.x, z: at.z });
      }
    });
    const showPlane = st?.phase === 'flying' || st?.phase === 'landed';
    const reachFor = new Set(mission?.spec.threat?.territories ?? []);
    const mine = sideOf(g.me ?? '');
    const radar = g.base?.radar;
    const detection = g.base?.detectionRange ?? 0;
    const home = g.home;
    const aircraft: MiniMapView['aircraft'] = [];
    for (const a of g.ais.values()) {
      if (!a.alive) continue;
      const friendly = a.side === mine;
      const seen = friendly || (home && Math.hypot(a.model.position.x - home.x, a.model.position.z - home.z) <= detection) || (showPlane && a.model.position.distance(plane.position) < SIGHT_RANGE);
      if (!seen) continue;
      aircraft.push({ x: a.model.position.x, z: a.model.position.z, yaw: a.model.yaw, side: friendly ? 'player' : 'enemy', role: a.role as AiRole, raid: null, mission: false });
    }
    for (const r of g.remotes.values()) {
      if (!r.alive || r.status !== 'flying') continue;
      const seen = (home && Math.hypot(r.model.position.x - home.x, r.model.position.z - home.z) <= Math.max(detection, home.half + 45)) || (showPlane && r.model.position.distance(plane.position) < SIGHT_RANGE * 1.4);
      if (!seen) continue;
      aircraft.push({ x: r.model.position.x, z: r.model.position.z, yaw: r.model.yaw, side: 'enemy', role: AIRCRAFT[r.spec.id].role === 'bomber' ? 'bomber' : 'fighter', raid: null, mission: true });
    }
    return {
      territories: g.territories.map((t) => {
        const done = roles.get(t.id);
        const owned = g.owners.has(t.id);
        return { id: t.id, x: t.x, z: t.z, half: t.half, threat: owned ? 0 : t.threat, role: t.id === home?.id ? 'home' : done === undefined ? (owned ? 'objective' : 'neutral') : done ? 'done' : 'objective' };
      }),
      defenses: g.network.installations.map((i) => {
        const near = showPlane && Math.hypot(i.spec.x - plane.position.x, i.spec.z - plane.position.z) < i.spec.range + DEFENSES.approachMargin * 2;
        const reach = i.isWeapon && (near || reachFor.has(i.spec.territoryId)) ? { range: i.spec.range, facing: i.spec.facing, arc: i.spec.arc } : null;
        return { x: i.spec.x, z: i.spec.z, kind: i.spec.kind, alive: i.alive, engaged: i.alive && i.isWeapon && i.engaged, friendly: i.side === mine, reach };
      }),
      zones,
      rings,
      targets,
      plane: showPlane ? { x: plane.position.x, z: plane.position.z, yaw: plane.yaw, autopilot: g.predictor.flight.boundary.state === 'autopilot' } : null,
      aircraft,
      objective: showPlane && objective ? { x: objective.x, z: objective.z } : null,
      radar: home ? { x: home.x, z: home.z, range: detection, state: !radar ? 'none' : radar.alive ? 'on' : 'off' } : null,
      boundaryRadius: WORLD.boundaryRadius,
      warning: st?.phase === 'flying' && g.predictor.flight.boundary.state !== 'inside',
    };
  }

  /** The defended territory the plane is over or about to reach, as single-player's. */
  approachedTerritory(): string | null {
    const p = this.g.plane.position;
    let best: string | null = null;
    let bestGap: number = DEFENSES.approachMargin;
    for (const t of this.g.territories) {
      const weapons = this.g.network.on(t.id).filter((i) => i.isWeapon);
      if (weapons.length === 0) continue;
      if (t.containsXZ(p.x, p.z)) return t.id;
      for (const w of weapons) {
        const gap = Math.hypot(w.spec.x - p.x, w.spec.z - p.z) - w.spec.range;
        if (gap < bestGap) {
          bestGap = gap;
          best = t.id;
        }
      }
    }
    return best;
  }

  private threatView(): ThreatView {
    const g = this.g;
    const p = g.plane.position;
    let panel: ThreatView['panel'] = null;
    const tid = this.approachedTerritory();
    const t = g.territories.find((x) => x.id === tid);
    if (t) {
      const all = g.network.on(t.id);
      const weapons = all.filter((i) => i.isWeapon);
      const engaged = weapons.some((w) => w.alive && w.targetId === this.myPlane && (w.state === 'firing' || w.state === 'locking'));
      const owned = g.owners.get(t.id);
      const level = owned ? (Math.min(3, weapons.filter((w) => w.alive).length) as 0 | 1 | 2 | 3) : t.threat;
      panel = {
        territoryId: t.id,
        level,
        label: owned ? `${g.room?.state.players.get(owned)?.name ?? 'Rival'}'s base` : THREAT.levels[t.threat].label,
        status: weapons.every((w) => !w.alive) ? 'neutralised' : engaged ? 'engaged' : weapons.some((w) => w.targetId === this.myPlane) ? 'spotted' : 'clear',
        installations: all.map((i) => ({ id: i.id, kind: i.spec.kind, alive: i.alive, engaged: i.alive && i.engaged })),
      };
    }
    const ring: ThreatRingItem[] = [];
    for (const i of g.network.installations) {
      if (!i.alive || !i.isWeapon || i.targetId !== this.myPlane || !i.engaged) continue;
      const reach = Math.hypot(i.spec.x - p.x, i.spec.z - p.z) - i.spec.range;
      if (i.state === 'tracking' && reach > 10) continue;
      ring.push({ id: i.id, angle: this.bearing(i.spec.x, i.spec.z), icon: i.spec.kind, state: i.state === 'idle' || i.state === 'destroyed' ? 'tracking' : i.state, distance: Math.hypot(i.spec.x - p.x, i.spec.ground + i.spec.pivot - p.y, i.spec.z - p.z) });
    }
    for (const a of g.ais.values()) {
      if (!a.alive || a.target !== this.myPlane || !a.attacking) continue;
      const d = a.model.position.distance(p);
      ring.push({ id: a.id, angle: this.bearing(a.model.position.x, a.model.position.z), icon: a.role as IconName, state: d < AIRCRAFT[a.spec.id].gun.range ? 'firing' : 'tracking', distance: d });
    }
    // Rival players closing in from behind or ahead, close enough to shoot.
    for (const r of g.remotes.values()) {
      if (!r.alive || r.status !== 'flying') continue;
      const d = r.model.position.distance(p);
      if (d > 70) continue;
      ring.push({ id: r.id, angle: this.bearing(r.model.position.x, r.model.position.z), icon: AIRCRAFT[r.spec.id].role === 'bomber' ? 'bomber' : 'fighter', state: d < AIRCRAFT[r.spec.id].gun.range ? 'firing' : 'tracking', distance: d });
    }
    let nearest = Infinity;
    let rockets = 0;
    for (const shot of g.fx.shots) {
      if (shot.kind !== 'rocket' || shot.side === 'player') continue;
      const d = Math.hypot(shot.x - p.x, shot.y - p.y, shot.z - p.z);
      if (d > ROCKET_WARNING_RANGE) continue;
      rockets++;
      nearest = Math.min(nearest, d);
      ring.push({ id: `rocket-${shot.id}`, angle: this.bearing(shot.x, shot.z), icon: 'rocket', state: 'incoming', distance: d });
    }
    const locking = g.network.installations.filter((i) => i.state === 'locking' && i.targetId === this.myPlane);
    const lock: ThreatView['lock'] =
      rockets > 0 ? { state: 'incoming', progress: 1, distance: nearest, count: rockets }
      : locking.length > 0 ? { state: 'locking', progress: Math.max(...locking.map((i) => i.lock)), distance: 0, count: locking.length }
      : null;
    return { panel, ring, lock };
  }

  lockingOnMe(i: Installation): boolean {
    return i.targetId === this.myPlane;
  }

  threatened(): boolean {
    for (const a of this.g.ais.values()) if (a.attacking && a.target === this.myPlane) return true;
    return false;
  }

  private airView(flying: boolean, aim: ScreenPoint | null): AirView {
    const g = this.g;
    const markers: AircraftMarkerView[] = [];
    let lead: ScreenPoint | null = null;
    if (flying) {
      const p = g.plane.position;
      const st = g.state!;
      const wanted = new Set<string>();
      st.mission?.objectives.forEach((o) => {
        if (o.kind === 'intercept') for (const id of o.targets) wanted.add(this.serverId(id));
        if (o.kind === 'escort') wanted.add(this.serverId(o.escort));
      });
      const now = performance.now();
      const gun = st.plane?.gun ?? g.plane.spec.gun;
      const fwd = g.plane.getForward(new pc.Vec3());
      let leadTarget: RemoteAircraft | null = null;
      let leadAngle = 0.5;
      const mine = sideOf(g.me ?? '');
      for (const a of [...g.ais.values(), ...g.remotes.values()]) {
        if (!a.alive || a.status === 'hidden' || a.status === 'crashed') continue;
        const player = planeOwner(a.id);
        if (player && a.status !== 'flying') continue;
        const d = a.model.position.distance(p);
        const friendly = a.side === mine;
        const important = wanted.has(a.id) || friendly || (!!player && d < AIRCRAFT_MARKER_RANGE);
        if (d > AIRCRAFT_MARKER_RANGE && !important) continue;
        const at = this.indicator(new pc.Vec3().copy(a.model.position));
        if (!at.onScreen && d > AIRCRAFT_EDGE_RANGE && !important) continue;
        const aimedAt = !!aim && at.onScreen && Math.hypot(aim.x - at.x, aim.y - at.y) < 70;
        const recentlyHit = now - (g.hitAt.get(a.id) ?? -Infinity) < 3000;
        const attackingMe = !player && a.attacking && a.target === this.myPlane;
        const icon: IconName = player ? (AIRCRAFT[a.spec.id].role === 'bomber' ? 'bomber' : 'fighter') : (a.role as IconName);
        markers.push({
          id: a.id, x: at.x, y: at.y, onScreen: at.onScreen, angle: at.angle,
          side: friendly ? 'player' : 'enemy', icon, name: this.aircraftName(a),
          detail: player ? `Rival · ${AIRCRAFT[a.spec.id].name}` : attackingMe ? 'Attacking you!' : a.leaving ? 'Heading home' : `${AI.roleLabels[a.role as AiRole] ?? 'Aircraft'}`,
          status: attackingMe ? 'attacking' : a.leaving ? 'leaving' : null,
          distance: d, health: a.durability.fraction, showHealth: recentlyHit || aimedAt || d < 45 || wanted.has(a.id) || !!player,
          far: clamp((d - 40) / 160, 0, 1), mission: wanted.has(a.id), attacking: attackingMe, compact: false,
        });
        if (friendly || d > gun.range * 1.1) continue;
        const angle = Math.acos(clamp(((a.model.position.x - p.x) * fwd.x + (a.model.position.y - p.y) * fwd.y + (a.model.position.z - p.z) * fwd.z) / (d || 1), -1, 1));
        if (angle < leadAngle) {
          leadAngle = angle;
          leadTarget = a;
        }
      }
      if (leadTarget) {
        const m = leadTarget.model;
        const v = this.v2.copy(m.position).sub(m.prevPosition).mulScalar(60);
        const point = leadPoint(p, g.plane.getVelocity(new pc.Vec3()), m.position, { x: v.x, y: v.y, z: v.z }, gun.speed, 1);
        lead = this.project(new pc.Vec3(point.x, point.y, point.z));
      }
    }
    const rank = (m: AircraftMarkerView) => (m.attacking ? 0 : m.mission ? 1 : 2) * 1000 + m.distance;
    const placed: AircraftMarkerView[] = [];
    for (const m of [...markers].sort((a, b) => rank(a) - rank(b))) {
      if (!m.onScreen) continue;
      m.compact = placed.some((o) => Math.abs(o.x - m.x) < 130 && Math.abs(o.y - m.y) < 64);
      if (!m.compact) placed.push(m);
    }
    return { markers, lead };
  }

  /** Another player raiding our base: single-player's raid alert, pointed at them. */
  private raidAlert(): RaidAlertView | null {
    const g = this.g;
    const attack = (g.priv.attacks ?? []).find((a) => a.victim === g.me && a.detected);
    const home = g.home;
    if (!attack || !home || !g.base) return null;
    const raider = g.remotes.get(attack.attacker);
    const r = g.base.readiness;
    const phase = g.state?.phase;
    const response = phase === 'flying' ? null : phase === 'landed' ? { key: 'Space', label: 'Take off' } : phase === 'ready' ? { key: 'Space', label: 'Launch' } : phase === 'desk' ? { key: 'F', label: 'Fold' } : null;
    const pos = raider?.model.position;
    return {
      state: 'inbound',
      direction: pos ? compass(pos.x - home.x, pos.z - home.z) : '?',
      eta: pos ? Math.hypot(pos.x - home.x, pos.z - home.z) / 18 : 0,
      target: attack.attackerName,
      targetIcon: BUILDING_ICONS.turret,
      ready: r.ready,
      total: r.total,
      escorted: false,
      distance: phase === 'flying' && pos ? pos.distance(g.plane.position) : null,
      reward: PVP.defenseReward,
      mission: false,
      response,
    };
  }

  // ---- Helpers ----------------------------------------------------------------------------------------

  /** The landing checks show on the approach to home: low, slow and close. */
  onApproach(): boolean {
    const g = this.g;
    const home = g.home;
    if (!home || g.state?.phase !== 'flying') return false;
    const p = g.plane.position;
    return p.y < 14 && Math.hypot(p.x - home.x, p.z - home.z) < home.half + 25;
  }

  /** An AI aircraft id in a mission (as the generator named it) → its id on the server. */
  private serverId(id: string): string {
    if (id.startsWith('pl:')) return id;
    return `${this.g.me}/${id}`;
  }

  private aircraft(id: string): RemoteAircraft | null {
    const owner = planeOwner(id);
    if (owner) return this.g.remotes.get(owner) ?? null;
    return this.g.ais.get(id) ?? null;
  }

  private aircraftName(a: RemoteAircraft): string {
    const owner = planeOwner(a.id);
    if (owner) return this.g.room?.state.players.get(owner)?.name ?? 'Rival';
    const mine = a.side === sideOf(this.g.me ?? '');
    const sideOwner = ownerOfSide(a.side);
    if (mine) return `Your ${AIRCRAFT[a.spec.id].name}`;
    if (sideOwner) return `${this.g.room?.state.players.get(sideOwner)?.name ?? 'Rival'}'s ${AIRCRAFT[a.spec.id].name}`;
    return `Enemy ${AIRCRAFT[a.spec.id].name}`;
  }

  private ownerName(territoryId: string): string | null {
    const owner = this.g.owners.get(territoryId);
    if (!owner || owner === this.g.me) return null;
    return this.g.room?.state.players.get(owner)?.name ?? null;
  }

  /** Screen position of a world point, or null when it is behind the camera or off screen. */
  project(point: pc.Vec3): ScreenPoint | null {
    const cam = this.g.camera.entity;
    const depth = this.rel.copy(point).sub(cam.getPosition()).dot(cam.forward);
    if (depth <= 0.1) return null;
    const s = this.g.camera.camera.worldToScreen(point, this.screen);
    const { clientWidth: w, clientHeight: h } = this.g.app.graphicsDevice.canvas;
    if (s.x < 0 || s.y < 0 || s.x > w || s.y > h) return null;
    return { x: s.x, y: s.y };
  }

  private indicator(point: pc.Vec3): { x: number; y: number; onScreen: boolean; angle: number } {
    const cam = this.g.camera.entity;
    const { clientWidth: w, clientHeight: h } = this.g.app.graphicsDevice.canvas;
    const cx = w / 2;
    const cy = h / 2;
    const margin = 56;
    const rel = this.rel.copy(point).sub(cam.getPosition());
    let dx: number;
    let dy: number;
    if (rel.dot(cam.forward) > 0.1) {
      const s = this.g.camera.camera.worldToScreen(point, this.screen);
      if (s.x >= margin && s.x <= w - margin && s.y >= margin && s.y <= h - margin) return { x: s.x, y: s.y, onScreen: true, angle: 0 };
      dx = s.x - cx;
      dy = s.y - cy;
    } else {
      dx = rel.dot(cam.right);
      dy = -rel.dot(cam.up);
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    }
    const scale = Math.min((cx - margin) / Math.max(Math.abs(dx), 1e-6), (cy - margin) / Math.max(Math.abs(dy), 1e-6));
    return { x: cx + dx * scale, y: cy + dy * scale, onScreen: false, angle: Math.atan2(dy, dx) };
  }

  /** Bearing of (x, z) relative to the plane's heading, for the threat ring. */
  bearing(x: number, z: number): number {
    const p = this.g.plane.position;
    const yaw = this.g.plane.yaw;
    const toward = Math.atan2(-(x - p.x), -(z - p.z));
    let a = toward - yaw;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return -a;
  }
}

/** What a card against another player is about, in a sentence. */
function pvpNote(kind: 'raid' | 'recon' | 'hunt' | 'intercept', name: string): string {
  switch (kind) {
    case 'raid': return `Bomb ${name}'s marked building. Their guns are awake and they can come up to stop you. If it gets through they lose a little paper (never their reserve); your reward is paid by the game.`;
    case 'recon': return `Fly low over ${name}'s base for a while. Their guns will notice.`;
    case 'hunt': return `${name} is in the air. Shoot them down before the clock runs out.`;
    case 'intercept': return `${name} is raiding your base. Get up there and shoot them down; your guns help over home.`;
  }
}

/** The danger on a mission card (single-player's). */
function threatSummary(m: Mission): ThreatSummary {
  const t = m.spec.threat;
  const airIcons: IconName[] = t?.air ? [...(t.air.fighters ? ['fighter' as const] : []), ...(t.air.scouts ? ['scout' as const] : []), ...(t.air.bombers ? ['bomber' as const] : [])] : [];
  const air = t?.air ? `Air: ${[t.air.fighters ? `${t.air.fighters} fighter${t.air.fighters > 1 ? 's' : ''}` : '', t.air.scouts ? `${t.air.scouts} scout${t.air.scouts > 1 ? 's' : ''}` : '', t.air.bombers ? `${t.air.bombers} bomber${t.air.bombers > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ')} (${AI.skill[t.air.skill].label.toLowerCase()})` : null;
  if (t?.air && t.level === 0) {
    const level = ({ easy: 1, medium: 2, hard: 3 } as const)[t.air.skill];
    return { level, label: 'Air threat', detail: `No ground defenses · ${air}`, icons: airIcons };
  }
  if (!t || t.level === 0) return { level: 0, label: THREAT.levels[0].label, detail: m.spec.type === 'rings' ? 'Course clear of defenses' : 'No known defenses', icons: [] };
  const parts: string[] = [];
  if (t.turrets || t.launchers) parts.push(defenseList(t.turrets, t.launchers));
  if (t.radars) parts.push(t.radars === 1 ? 'radar' : `${t.radars} radars`);
  if (air) parts.push(air);
  const icons: IconName[] = [...(t.turrets ? ['turret' as const] : []), ...(t.launchers ? ['launcher' as const] : []), ...(t.radars ? ['radar' as const] : []), ...airIcons];
  return { level: t.level, label: THREAT.levels[t.level].label, detail: `${t.territories.join(' + ')}: ${parts.join(' · ')}`, icons };
}

function css(color: readonly [number, number, number]): string {
  return `rgb(${color.map((c) => Math.round(c * 255)).join(', ')})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
