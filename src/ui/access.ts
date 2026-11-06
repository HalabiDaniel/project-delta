/**
 * Accessibility and display settings (plan v0.0.15 §7B, §8): the theme (Daylight / Lights out,
 * from the developer's style guide), the colour palette, text size
 * (independent of the HUD size), high-contrast panels, reduced motion, sound captions and the
 * ultrawide 16:9 safe area. Single-player keeps them in its save (SaveGame `settings.access`),
 * multiplayer in this browser (MpSettings `access`); the HUD applies them live (`HUD.setAccess`).
 */

import { systemTokenOptions, type PaletteName, type ThemeName, type TokenOptions } from './tokens';

/** Reduced motion: follow the system (prefers-reduced-motion), or always full, or always reduced. */
export type MotionMode = 'auto' | 'full' | 'reduced';
/** Sound captions: while the sound is off (auto), always, or never. */
export type CaptionMode = 'auto' | 'on' | 'off';

/** Text size: 90 / 100 / 115 / 130 %. */
export const TEXT_SCALES: readonly number[] = [0.9, 1, 1.15, 1.3];

/** Button prompts: follow the device in use (auto), or always one glyph set. */
export type PromptMode = 'auto' | 'keyboard' | 'xbox' | 'playstation' | 'generic';

export interface AccessSettings {
  /** The style guide's theme: Daylight (default) or Lights out. The palette and contrast apply on top. */
  theme: ThemeName;
  palette: PaletteName;
  textScale: number;
  highContrast: boolean;
  motion: MotionMode;
  captions: CaptionMode;
  /** Keep the HUD inside a centred 16:9 area on ultrawide screens. */
  safeArea: boolean;
  /** Which glyph set the hints use (v0.0.16). */
  prompts: PromptMode;
}

export const DEFAULT_ACCESS: Readonly<AccessSettings> = {
  theme: 'daylight',
  palette: 'standard',
  textScale: 1,
  highContrast: false,
  motion: 'auto',
  captions: 'auto',
  safeArea: true,
  prompts: 'auto',
};

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

/** Only what we recognise; anything else falls back to the default, field by field. */
export function normaliseAccess(raw: unknown): AccessSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    theme: oneOf(o.theme, ['daylight', 'lightsOut'] as const, DEFAULT_ACCESS.theme),
    palette: oneOf(o.palette, ['standard', 'colourblind'] as const, DEFAULT_ACCESS.palette),
    textScale: TEXT_SCALES.includes(o.textScale as number) ? (o.textScale as number) : DEFAULT_ACCESS.textScale,
    highContrast: typeof o.highContrast === 'boolean' ? o.highContrast : DEFAULT_ACCESS.highContrast,
    motion: oneOf(o.motion, ['auto', 'full', 'reduced'] as const, DEFAULT_ACCESS.motion),
    captions: oneOf(o.captions, ['auto', 'on', 'off'] as const, DEFAULT_ACCESS.captions),
    safeArea: typeof o.safeArea === 'boolean' ? o.safeArea : DEFAULT_ACCESS.safeArea,
    prompts: oneOf(o.prompts, ['auto', 'keyboard', 'xbox', 'playstation', 'generic'] as const, DEFAULT_ACCESS.prompts),
  };
}

/** Whether motion is reduced: the setting, or the system's preference on auto. */
export function reducedMotion(mode: MotionMode, systemPrefersReduced: boolean): boolean {
  return mode === 'reduced' || (mode === 'auto' && systemPrefersReduced);
}

/** Whether captions show: always, never, or while the sound is off (auto). */
export function captionsShown(mode: CaptionMode, muted: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && muted);
}

/** The token options for these settings (applyTokens). */
export function accessTokens(s: AccessSettings, system: TokenOptions = systemTokenOptions()): TokenOptions {
  return { theme: s.theme, palette: s.palette, highContrast: s.highContrast, reducedMotion: reducedMotion(s.motion, system.reducedMotion === true), textScale: s.textScale };
}
