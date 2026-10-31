import type { RaidReport } from '../base/Raids';
import { AirHud } from './AirHud';
import { Alerts, Tips, type AlertTone } from './Alerts';
import { BaseHud, RaidHud } from './BaseHud';
import { toggle, type ScreenPoint } from './dom';
import { EconomyStrip } from './EconomyStrip';
import { Garage } from './Garage';
import type { IconName } from './icons';
import { Menus } from './Menus';
import { MiniMap } from './MiniMap';
import { MissionPanel } from './MissionPanel';
import { PlaneHud } from './PlaneHud';
import { ReportCard } from './ReportCard';
import { ThreatHud } from './ThreatHud';
import type { HudActions, HudView } from './views';
import { WorldLabels } from './WorldLabels';
import './hud.css';

export type { ScreenPoint } from './dom';
export type * from './views';
export type { AlertTone } from './Alerts';

/**
 * The HUD, laid out in fixed zones so the eye always knows where to look:
 *   top left      paper, production, storage (and the base / logbook / menu buttons at home)
 *   top centre    the objective, the threat panel, the raid alert, alerts and tips
 *   top right     the mini-map with T1's radar (mission cards beneath it at the desk)
 *   bottom left   the plane's condition (the garage inspector or build tray at home)
 *   bottom centre instruments (the garage, ground crew or base inspector)
 *   bottom right  weapons and the one action that matters now
 * The centre stays clear for flying and aiming. Each module draws its own part from the view.
 */
export class HUD {
  private readonly world: WorldLabels;
  private readonly economy: EconomyStrip;
  private readonly missions: MissionPanel;
  private readonly plane: PlaneHud;
  private readonly report: ReportCard;
  private readonly baseHud: BaseHud;
  private readonly raids: RaidHud;
  private readonly menus: Menus;
  private readonly alerts: Alerts;
  private readonly tips: Tips;
  private readonly minimap: MiniMap;
  private readonly garage: Garage;
  private readonly threats: ThreatHud;
  private readonly air: AirHud;
  private readonly zones: Record<'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'centre', HTMLElement>;
  private readonly flash: HTMLElement;
  private readonly lockHint: HTMLElement;
  private lastRender = performance.now();

  constructor(
    readonly root: HTMLElement,
    actions: HudActions,
  ) {
    root.classList.add('hud');
    const layer = div(root, 'world-layer');
    this.flash = div(root, 'damage-flash');
    const zone = (name: string) => div(root, `zone zone-${name}`);
    this.zones = { tl: zone('tl'), tc: zone('tc'), tr: zone('tr'), bl: zone('bl'), bc: zone('bc'), br: zone('br'), centre: zone('centre') };
    this.world = new WorldLabels(layer);
    this.air = new AirHud(layer);
    this.threats = new ThreatHud(layer, this.zones.tc);
    this.economy = new EconomyStrip(this.zones.tl, { base: actions.toggleBase, logbook: actions.openLogbook, menu: actions.openMenu });
    this.baseHud = new BaseHud({ world: layer, tc: this.zones.tc, bl: this.zones.bl, bc: this.zones.bc, br: this.zones.br }, actions);
    this.raids = new RaidHud(this.zones.tc);
    this.alerts = new Alerts(this.zones.tc);
    this.tips = new Tips(this.zones.tc);
    const map = document.createElement('canvas');
    map.className = 'minimap';
    this.zones.tr.appendChild(map);
    this.minimap = new MiniMap(map);
    this.missions = new MissionPanel(this.zones.tr, this.zones.tc, { select: actions.select, swap: actions.swap, abandon: actions.abandonOperation });
    this.zones.tc.prepend(this.zones.tc.querySelector('.objective')!);
    const garageCards = div(this.zones.bc, 'garage-row');
    const inspector = div(this.zones.bl, 'inspector card');
    this.garage = new Garage(garageCards, inspector, actions.selectAircraft);
    this.plane = new PlaneHud({ bl: this.zones.bl, bc: this.zones.bc, br: this.zones.br, centre: this.zones.centre }, { ...actions, base: actions.toggleBase });
    this.report = new ReportCard(this.zones.centre, actions.continueToDesk);
    this.menus = new Menus(root, actions);
    // Zones grow with the window (on top of the HUD size setting), so 1080p isn't a sea of tiny panels.
    const fit = () => root.style.setProperty('--fit-scale', String(Math.min(1.4, Math.max(0.9, window.innerHeight / 740))));
    fit();
    window.addEventListener('resize', fit);
    this.lockHint = div(root, 'hint lock-hint');
    this.lockHint.innerHTML = '<kbd>Esc</kbd> → click';
    this.lockHint.title = 'Mouse not captured: press Esc, then click to capture it';
  }

  render(v: HudView): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    const flying = v.phase === 'flying' && !v.paused;
    const atHome = v.phase === 'desk' || v.phase === 'building' || v.phase === 'ready' || v.phase === 'landed';
    this.root.classList.toggle('in-flight', flying);
    this.root.classList.toggle('base-mode', v.baseMode);
    this.root.classList.toggle('hints', v.hints);
    this.root.classList.toggle('paused', v.paused);
    // In a fight, the less urgent parts of the HUD step back.
    this.root.classList.toggle('combat', flying && !!v.threat && (v.threat.ring.length > 0 || v.threat.lock !== null));

    this.economy.render(v.economy, { buttons: atHome && !v.paused && v.result === null, base: v.baseMode, baseAvailable: atHome, full: v.baseMode, repairs: v.economy.repairs });
    this.missions.render(v);
    this.garage.render(v.paused || v.baseMode ? null : v.garage);
    this.plane.render(v);
    this.report.render(v.result, v.paused);
    this.baseHud.render(v.baseMode ? v.base : null, v.paused);
    this.raids.render(v.paused ? null : v.raid, v.paused);
    this.menus.render(v);
    this.world.render(v);
    this.threats.render(flying ? v.threat : null);
    this.air.render(v.paused ? null : v.air);
    this.minimap.render(v.minimap, dt);
    this.alerts.update();
    this.tips.update();
    toggle(this.lockHint, flying && !v.pointerLocked);
  }

  /** An alert below the objective: an icon, a few words and at most one number. */
  alert(iconName: IconName, title: string, value: string | null, tone: AlertTone, seconds?: number): void {
    this.alerts.show(iconName, title, value, tone, seconds);
  }

  /** A first-time tip. */
  tip(text: string, keys: string[] = []): void {
    this.tips.show(text, keys);
  }

  raidReport(report: RaidReport): void {
    this.raids.showReport(report);
  }

  paperDelta(delta: number): void {
    this.economy.delta(delta);
  }

  pop(word: string, tone: 'good' | 'bad' | 'info', at: ScreenPoint): void {
    this.world.pop(word, tone, at);
  }

  damageNumber(amount: number, at: ScreenPoint, kill = false): void {
    this.world.damageNumber(amount, at, kill);
  }

  hitMarker(kill: boolean): void {
    this.world.hitMarker(kill);
  }

  damageDirection(angle: number, amount: number): void {
    this.threats.damageDirection(angle, amount);
  }

  threatNote(message: string, tone: 'good' | 'bad' | 'info'): void {
    this.threats.note(message, tone);
  }

  damageFlash(amount: number): void {
    const el = this.flash;
    el.style.setProperty('--strength', String(Math.min(1, 0.35 + amount / 60)));
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** HUD size (0.9 / 1 / 1.15): every zone scales from its own corner. */
  setScale(scale: number): void {
    this.root.style.setProperty('--ui-scale', String(scale));
  }
}

function div(parent: HTMLElement, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  parent.appendChild(el);
  return el;
}
