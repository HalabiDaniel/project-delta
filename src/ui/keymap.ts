/**
 * The key map (Settings › Controls, the hints test): every binding as a glyph, an icon and what it
 * does, read from the bindings so rebinding updates it. Moved from the old pause menu (v0.0.16).
 */
import { attrs, glyph, tooltipAttrs } from './components';
import { bind, keyFor, padButtonFor, pair, type Action } from '../input/bindings';
import { padTemplate, type GlyphSpec } from '../input/glyphs';
import { esc } from './dom';
import { icon, type IconName } from './icons';
import { T } from './strings';

/** A row of the pause menu's controls grid: the binding, an icon and what it does. */
export interface ControlRow {
  spec: GlyphSpec;
  icon: IconName;
  label: string;
}

/** A controller template for an action's button ("{rt}"), from the bindings. */
const padOf = (action: Action): string => `{${padButtonFor(action) ?? 'south'}}`;
/** A controller-only row: the glyph is a template filled for the controller family in use. */
const padRow = (template: string, iconName: IconName, label: string): ControlRow => ({ spec: { key: padTemplate(template, 'xbox'), padText: template }, icon: iconName, label });

/**
 * The controller's mapping, shown in the menu while a controller is in use. Read from the
 * bindings and drawn for the controller in use (Xbox, PlayStation or generic labels) by applyGlyphs.
 */
export function padControls(): ControlRow[] {
  return [
    padRow('{lstick}', 'heading', T.menus.controls.steer),
    padRow('{rstick}', 'distance', T.menus.controls.look),
    padRow(padOf('firePrimary'), 'ink', T.menus.controls.ink),
    padRow(padOf('fireSecondary'), 'bombload', T.menus.controls.bomb),
    padRow(padOf('boost'), 'boost', T.menus.controls.boost),
    padRow(padOf('maneuver'), 'maneuver', T.menus.controls.maneuver),
    padRow(padOf('maneuverNext'), 'maneuver', T.menus.controls.maneuverPick),
    padRow(padOf('escortNext'), 'escort', T.menus.controls.escorts),
    padRow(`${padOf('modifier')} + L`, 'speed', T.menus.controls.throttleBank),
    padRow(padOf('confirm'), 'ok', T.menus.controls.confirmLaunch),
    padRow(padOf('back'), 'close', T.menus.controls.back),
    padRow(padOf('service'), 'rearm', T.menus.controls.rearmRepair),
    padRow(padOf('base'), 'base', T.menus.controls.base),
    padRow(`${padOf('prevAircraft')} / ${padOf('nextAircraft')}`, 'plane', T.menus.controls.aircraftHome),
    padRow(`${padOf('prevMission')} / ${padOf('nextMission')}`, 'reach', T.menus.controls.missionHome),
    padRow('{dpad}', 'more', T.menus.controls.menusEmotes),
    padRow(padOf('logbook'), 'book', T.menus.controls.logbookScores),
    padRow(padOf('pause'), 'info', T.menus.controls.pause),
  ];
}

/** The keyboard and mouse mapping, from the bindings. */
export function keyboardControls(): ControlRow[] {
  return [
    { spec: { key: T.keys.mouse, padText: '{lstick}' }, icon: 'heading', label: T.menus.controls.steer },
    { spec: pair(bind('throttleUp'), bind('throttleDown')), icon: 'speed', label: T.menus.controls.throttle },
    { spec: pair(bind('bankLeft'), bind('bankRight')), icon: 'plane', label: T.menus.controls.bank },
    { spec: bind('boost'), icon: 'boost', label: T.menus.controls.boost },
    { spec: bind('maneuver'), icon: 'maneuver', label: T.menus.controls.maneuver },
    { spec: bind('maneuverNext'), icon: 'maneuver', label: T.menus.controls.maneuverPick },
    { spec: bind('escortNext'), icon: 'escort', label: T.menus.controls.escorts },
    { spec: bind('firePrimary'), icon: 'ink', label: T.menus.controls.ink },
    { spec: bind('fireSecondary'), icon: 'bombload', label: T.menus.controls.bomb },
    { spec: { key: `${keyFor('pick1')} – ${keyFor('pick4')}` }, icon: 'reach', label: T.menus.controls.mission },
    { spec: pair(bind('prevAircraft'), bind('nextAircraft')), icon: 'plane', label: T.menus.controls.aircraft },
    { spec: bind('fold'), icon: 'build', label: T.menus.controls.fold },
    { spec: bind('launch'), icon: 'plane', label: T.menus.controls.launch },
    { spec: bind('service'), icon: 'rearm', label: T.menus.controls.rearm },
    { spec: bind('base'), icon: 'base', label: T.menus.controls.base },
    { spec: bind('swap'), icon: 'swap', label: T.menus.controls.swapCard },
    { spec: bind('logbook'), icon: 'book', label: T.menus.controls.logbook },
    { spec: bind('hangar'), icon: 'hangar', label: T.menus.controls.hangar },
    { spec: bind('missions'), icon: 'map', label: T.menus.controls.missions },
    { spec: bind('sound'), icon: 'sound', label: T.menus.controls.sound },
  ];
}

/** The controls grid: a glyph, an icon and a word per row (glyphs follow the device live). */
export function controlsGridHtml(rows: ControlRow[], className: string): string {
  return `<div class="controls ${className}">${rows.map((r) => `<div ${attrs(tooltipAttrs(r.label))}>${glyph(r.spec)}${icon(r.icon)}<span>${esc(r.label)}</span></div>`).join('')}</div>`;
}

