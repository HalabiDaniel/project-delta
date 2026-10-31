import { AIRCRAFT, AIRCRAFT_ORDER, DIRECTOR, TIER_ORDER, TIERS, type AircraftId, type Tier } from '../config';
import { MissionDirector, SLOT_LABELS, SLOTS, type Situation } from '../director/MissionDirector';
import { INDICATOR_LABELS, PROFILE_IDS, simulatedProfile, skillBand, type Indicator, type ProfileId } from '../director/Performance';
import { simulateAll, type SimulationResult } from '../director/Simulation';
import { CATEGORY_LABELS, categoryOf } from '../director/Templates';
import { EVENT_LABELS } from '../director/WorldEvents';
import type { Game } from '../Game';
import type { MissionType } from '../missions/Mission';
import { EVENT_TYPES, MISSION_TYPES } from '../missions/MissionGenerator';
import { seededRng } from '../systems/Random';
import { bindButton, esc } from './dom';
import { MISSION_TYPE_LABELS } from './HUD';

/**
 * The developer panel (` key, or ?dev in the address): why the director dealt what it dealt, the
 * player's performance rating, multipliers and reward breakdowns, world events and territory
 * states, plus tools to force a mission, preview or apply a simulated player, run the economy
 * simulation and read the mission history. Not for players; it never changes the rules.
 */
export class DevPanel {
  private readonly el: HTMLElement;
  private readonly live: HTMLElement;
  private readonly extra: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private preview: string = '';
  private simulation: SimulationResult[] | null = null;
  private analysisSlot: number = 1;

  constructor(root: HTMLElement, private readonly game: Game) {
    this.el = document.createElement('aside');
    this.el.className = 'dev-panel';
    this.el.hidden = true;
    const option = (v: string, label: string) => `<option value="${v}">${esc(label)}</option>`;
    const regular = MISSION_TYPES.filter((t) => !EVENT_TYPES.includes(t));
    this.el.innerHTML = `
      <div class="dev-head"><b>Mission director · developer panel</b><button class="dev-btn" data-dev-close>Close <kbd>\`</kbd></button></div>
      <div data-dev-live></div>
      <section>
        <h4>Force a mission</h4>
        <div class="dev-form">
          <select data-f-slot>${SLOTS.map((s, i) => option(String(i), `Slot ${i + 1}: ${SLOT_LABELS[s]}`)).join('')}</select>
          <select data-f-type>${regular.map((t) => option(t, MISSION_TYPE_LABELS[t])).join('')}</select>
          <select data-f-tier>${TIER_ORDER.map((t) => option(t, TIERS[t].label)).join('')}</select>
          <select data-f-target>${option('', 'Any target')}${game.world.territories.filter((t) => !t.isHome).map((t) => option(t.id, `${t.id} (threat ${t.threat})`)).join('')}</select>
          <button class="dev-btn" data-f-go>Generate</button>
        </div>
        <p class="dev-note" data-f-note></p>
      </section>
      <section>
        <h4>World events</h4>
        <div class="dev-form">
          <button class="dev-btn" data-ev="high-value">Shipment</button>
          <button class="dev-btn" data-ev="convoy">Convoy</button>
          <button class="dev-btn" data-ev="supply-run">Supply run</button>
          <button class="dev-btn" data-ev="raid">Raid on T1</button>
        </div>
      </section>
      <section>
        <h4>Simulated players</h4>
        <div class="dev-form profiles">${PROFILE_IDS.map((id) => `<span><b>${esc(simulatedProfile(id).label)}</b> <button class="dev-btn" data-preview="${id}">Preview</button><button class="dev-btn" data-apply="${id}">Apply</button></span>`).join('')}</div>
        <div data-dev-preview></div>
      </section>
      <section>
        <h4>Economy simulation</h4>
        <div class="dev-form"><button class="dev-btn" data-sim>Run 30 sorties per profile</button></div>
        <div data-dev-sim></div>
      </section>`;
    this.live = this.el.querySelector('[data-dev-live]')!;
    this.extra = this.el.querySelector('[data-dev-preview]')!;
    bindButton(this.el.querySelector('[data-dev-close]')!, () => this.toggle(false));
    bindButton(this.el.querySelector('[data-f-go]')!, () => this.force());
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-ev]')) bindButton(b, () => this.event(b.dataset.ev!));
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-preview]')) bindButton(b, () => this.previewProfile(b.dataset.preview as ProfileId));
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-apply]')) bindButton(b, () => this.applyProfile(b.dataset.apply as ProfileId));
    bindButton(this.el.querySelector('[data-sim]')!, () => this.simulate());
    this.live.addEventListener('click', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-analysis]');
      if (slot) {
        this.analysisSlot = Number(slot.dataset.analysis);
        this.render();
      }
    });
    // The panel takes the mouse; keep clicks from reaching the game underneath.
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open): void {
    this.el.hidden = !open;
    if (this.timer) clearInterval(this.timer);
    this.timer = open ? setInterval(() => this.render(), 400) : null;
    if (open) this.render();
  }

  private render(): void {
    const { director, events, state } = this.game;
    const perf = director.performance;
    const b = perf.breakdown;
    const indicators = (Object.keys(b.indicators) as Indicator[])
      .map((k) => {
        const v = b.indicators[k];
        return `<tr><td>${INDICATOR_LABELS[k]}</td><td class="bar-cell"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></td><td>${v === null ? '—' : v.toFixed(2)}</td><td class="muted">×${DIRECTOR.weights[k]}</td></tr>`;
      })
      .join('');
    const board = director.offers
      .map((o, i) => {
        const p = o.mission.spec.rewardParts;
        return `<li class="${i === this.analysisSlot ? 'on' : ''}" data-analysis="${i}"><b>${i + 1}. ${SLOT_LABELS[o.slot]} · ${o.source}</b> ${esc(MISSION_TYPE_LABELS[o.mission.spec.type])} · ${TIERS[o.mission.tier].label} · <b>+${o.mission.reward}</b>
          ${p ? `<div class="muted">B ${p.base.toFixed(1)} × D ${p.difficulty} × M ${p.modifier.toFixed(2)}${p.floor ? ` ≥ ${p.floor}` : ''} · par ${o.mission.spec.par ?? '—'} s · ${o.mission.spec.aircraft?.length ?? 0} aircraft</div>` : ''}
          <ul>${o.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></li>`;
      })
      .join('');
    const ev = director.event ? `<li><b>4. World event</b> ${esc(director.event.mission.title)} · +${director.event.mission.reward}</li>` : '';
    const analysis = director.analysis.get(SLOTS[this.analysisSlot] ?? 'balanced');
    const candidates = analysis
      ? analysis.candidates
          .slice()
          .sort((a, c) => Number(!!a.reason) - Number(!!c.reason) || c.weight - a.weight)
          .map((c) => `<tr class="${c.type === analysis.picked ? 'picked' : c.reason ? 'out' : ''}"><td>${esc(MISSION_TYPE_LABELS[c.type])}</td><td class="muted">${CATEGORY_LABELS[categoryOf(c.type)]}</td><td>${c.reason ? '—' : c.weight.toFixed(2)}</td><td class="muted">${esc(c.reason ?? (c.type === analysis.picked ? 'picked' : 'eligible'))}</td></tr>`)
          .join('')
      : '';
    const tiers = TIER_ORDER.map((t) => `<td>${TIERS[t].label}<br><b>×${TIERS[t].multiplier}</b></td>`).join('');
    const mods = (Object.keys(DIRECTOR.modifiers) as Array<keyof typeof DIRECTOR.modifiers>).map((m) => `<span class="dev-chip">${DIRECTOR.modifiers[m].label} ×${DIRECTOR.modifiers[m].reward}</span>`).join(' ');
    const worldEvents = events.events.slice(-6).reverse().map((e) => `<li><b>${EVENT_LABELS[e.kind]}</b> · ${e.status}${e.timeLeft !== null ? ` · ${Math.ceil(e.timeLeft)} s left` : ''} · ${esc(e.title)}${e.outcome ? ` <span class="muted">(${esc(e.outcome)})</span>` : ''}</li>`).join('') || '<li class="muted">None yet</li>';
    const states = [...events.territoryStates].map(([id, st]) => `<span class="dev-chip">${id}: ${st}${events.stateTimeLeft(id) !== null ? ` ${Math.ceil(events.stateTimeLeft(id)!)} s` : ''}</span>`).join(' ') || '<span class="muted">All territories at peace</span>';
    const recent = director.history.slice(-40);
    const freq = new Map<MissionType, number>();
    for (const h of recent) if (h.kind === 'offered') freq.set(h.type, (freq.get(h.type) ?? 0) + 1);
    const history = director.history.slice(-18).reverse().map((h) => `<li><span class="dev-kind" data-kind="${h.kind}">${h.kind}</span> ${esc(h.title)} <span class="muted">${TIERS[h.tier].label} · ${SLOT_LABELS[h.slot]}${h.detail ? ` · ${esc(h.detail)}` : ''}</span></li>`).join('');
    const ledger = this.game.ledger.aircraftReturns().map((r) => `<span class="dev-chip">${AIRCRAFT[r.id].name}: −${r.spent} / +${r.earned}${r.ratio !== null ? ` (${r.ratio.toFixed(1)}×)` : ''}</span>`).join(' ') || '<span class="muted">No sorties yet</span>';
    const op = director.operation;
    const html = `
      <section><h4>Performance</h4>
        <p>Rating <b>${b.rating.toFixed(2)}</b> over ${b.missions} missions · skill <b>${perf.skill.toFixed(2)}</b> (${skillBand(perf.skill)}) · recommended <b>${TIERS[perf.recommendedTier].label}</b> · ${perf.struggling ? '<b class="bad">struggling</b>' : 'not struggling'} · ${perf.newcomer ? 'newcomer' : 'settled'}</p>
        <table class="dev-table">${indicators}</table></section>
      <section><h4>Board <span class="muted">(click a card to see its candidates) · swaps ${director.swaps} · paper ${state.resources.paper} · sky room ${this.game.airTraffic.room}</span></h4><ul class="dev-board">${board}${ev}</ul>
        ${op ? `<p><b>${esc(op.codename)}</b> (${op.template}, ${op.status}) on ${op.territoryId}: ${op.stages.map((s) => `${s.status === 'done' ? '✓' : s.status === 'open' ? '▶' : '·'} ${esc(s.label)}`).join(' · ')} · bonus +${op.bonus} · earned ${op.earned}</p>` : `<p class="muted">No operation (completed ${director.completedMissions}, ${director.sinceOperation} since the last one)</p>`}</section>
      <section><h4>Candidates for slot ${this.analysisSlot + 1}${analysis ? `: ${esc(analysis.tierNote)}` : ''}</h4><table class="dev-table">${candidates}</table></section>
      <section><h4>Difficulty multipliers (D) and modifiers (M)</h4><table class="dev-table tiers"><tr>${tiers}</tr></table><p>${mods}</p></section>
      <section><h4>World <span class="muted">· next event in ${events.active.length ? '(one is on)' : `${Math.max(0, Math.ceil(events.cooldown))} s`}</span></h4><ul class="dev-list">${worldEvents}</ul><p>${states}</p></section>
      <section><h4>History <span class="muted">(offered lately: ${[...freq].sort((a, c) => c[1] - a[1]).slice(0, 6).map(([t, n]) => `${MISSION_TYPE_LABELS[t]} ${n}`).join(', ') || '—'})</span></h4><ul class="dev-list">${history}</ul></section>
      <section><h4>Paper efficiency by aircraft</h4><p>${ledger}</p></section>`;
    if (this.live.dataset.html !== html) {
      this.live.dataset.html = html;
      this.live.innerHTML = html;
    }
    if (this.extra.dataset.html !== this.preview) {
      this.extra.dataset.html = this.preview;
      this.extra.innerHTML = this.preview;
    }
    const simEl = this.el.querySelector<HTMLElement>('[data-dev-sim]')!;
    const sim = this.simulation ? simulationTable(this.simulation) : '';
    if (simEl.dataset.html !== sim) {
      simEl.dataset.html = sim;
      simEl.innerHTML = sim;
    }
  }

  private force(): void {
    const { director, state } = this.game;
    const value = (name: string) => this.el.querySelector<HTMLSelectElement>(`[data-f-${name}]`)!.value;
    const note = this.el.querySelector<HTMLElement>('[data-f-note]')!;
    if (state.phase !== 'desk' && state.phase !== 'building' && state.phase !== 'ready') {
      note.textContent = 'Only at the desk, before launch.';
      return;
    }
    const slot = Number(value('slot'));
    const mission = director.force(slot, { type: value('type') as MissionType, tier: value('tier') as Tier, target: value('target') || undefined });
    if (!mission) {
      note.textContent = "That mission can't be made in this world (no fitting target).";
      return;
    }
    state.updateOffers(director.missions);
    state.select(slot);
    note.textContent = `Slot ${slot + 1}: ${mission.title} (+${mission.reward}).`;
    this.render();
  }

  private event(kind: string): void {
    const g = this.game;
    if (kind === 'raid') g.airTraffic.startRaid('medium', false, undefined, () => false);
    else g.events.start(kind as 'high-value' | 'convoy' | 'supply-run');
    this.render();
  }

  /** What the director would deal this profile, without touching the real game. */
  private previewProfile(id: ProfileId): void {
    const profile = simulatedProfile(id);
    const hangar = new Map(profile.hangar.map((h) => [h.id, h.condition]));
    const costs = Object.fromEntries(AIRCRAFT_ORDER.map((a) => [a, hangar.get(a) === 'ready' ? 0 : hangar.get(a) === 'recovered' ? AIRCRAFT[a].refitCost : AIRCRAFT[a].cost])) as Record<AircraftId, number>;
    const situation: Situation = { paper: profile.paper, costs, airRoom: this.game.airTraffic.room, raidActive: false };
    const lines: string[] = [];
    for (let seed = 1; seed <= 3; seed++) {
      const d = new MissionDirector(this.game.missionContext, () => situation, seededRng(seed * 101));
      d.performance.load(profile.records, profile.skill);
      d.completedMissions = profile.records.filter((r) => r.success).length;
      d.deal();
      lines.push(d.offers.map((o) => `${SLOT_LABELS[o.slot]}: ${MISSION_TYPE_LABELS[o.mission.spec.type]} · ${TIERS[o.mission.tier].label} · +${o.mission.reward}${o.source !== 'director' ? ` (${o.source})` : ''}`).join('<br>'));
    }
    this.preview = `<p><b>${esc(profile.label)}</b>: skill ${profile.skill.toFixed(2)} (${skillBand(profile.skill)}), ${profile.paper} paper, ${profile.records.length} missions in history. Three sample deals:</p><ol class="dev-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ol>`;
    this.render();
  }

  /** Makes the real game look like this profile: its record, paper and hangar (at the desk only). */
  private applyProfile(id: ProfileId): void {
    const { director, state } = this.game;
    if (state.phase !== 'desk') {
      this.preview = '<p class="bad">Apply a profile at the desk, with no plane on the pad.</p>';
      this.render();
      return;
    }
    const profile = simulatedProfile(id);
    director.performance.load(profile.records, profile.skill);
    director.completedMissions = profile.records.filter((r) => r.success).length;
    state.resources.restore(profile.paper);
    state.hangar.clear();
    for (const h of profile.hangar) state.hangar.set(h.id, { condition: h.condition, health: AIRCRAFT[h.id].maxHealth * (h.condition === 'ready' ? 1 : 0.7), invested: 0 });
    director.deal();
    state.updateOffers(director.missions);
    this.game.requestSave();
    this.preview = `<p>Applied <b>${esc(profile.label)}</b>.</p>`;
    this.render();
  }

  private simulate(): void {
    this.simulation = simulateAll(this.game.missionContext(), 30, Math.floor(Math.random() * 1000));
    this.render();
  }
}

function simulationTable(rows: SimulationResult[]): string {
  const body = rows
    .map((r) => {
      const profile = simulatedProfile(r.profile);
      return `<tr><td>${esc(profile.label)}</td><td>${r.paperStart} → <b>${r.paperEnd}</b><br><span class="muted">min ${r.paperMin}</span></td><td>${r.successes}/${r.missions}</td><td>${r.planesLost}</td><td>${r.emergencies}</td><td>${r.successes ? Math.round(r.rewards / r.successes) : 0}</td><td>${r.longestBroke}</td><td>${r.skillEnd.toFixed(2)}</td></tr>`;
    })
    .join('');
  return `<table class="dev-table"><thead><tr><th>Profile</th><th>Paper</th><th>Done</th><th>Lost</th><th>Emerg.</th><th>Paper / success</th><th>Broke run</th><th>Skill</th></tr></thead><tbody>${body}</tbody></table>`;
}
