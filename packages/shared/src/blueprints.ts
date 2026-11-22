/**
 * Inventions.
 *
 * Blurb can design new kinds of things, but only from a fixed menu of parts
 * (a base shape + details) and a fixed menu of BEHAVIORS. A new invention is
 * a new *thing*, never a new *power*: a closet is a wardrobe Blurb changes
 * outfits at, a storage box raises how much it can carry, and so on. Every
 * design needs the owner's approval before it can be built.
 */
import { OBJECT_DEFS, type NeedDelta, type ObjectDef } from './catalog.js';
import { findProfanity } from './safety.js';
import { normalizeColor } from './palettes.js';
import {
  RESOURCE_KINDS,
  type Activity,
  type ObjectKind,
  type ResourceKind,
} from './types.js';

export const INVENTION_BEHAVIORS = ['storage', 'wardrobe', 'seat', 'bed', 'toy', 'reading', 'decor'] as const;
export type InventionBehavior = (typeof INVENTION_BEHAVIORS)[number];

export const BLUEPRINT_BASES = ['box', 'chest', 'cabinet', 'shelf', 'table', 'round', 'tall'] as const;
export type BlueprintBase = (typeof BLUEPRINT_BASES)[number];

export const BLUEPRINT_DETAILS = ['doors', 'drawers', 'handles', 'legs', 'lid', 'shelves', 'stripes', 'window', 'knobs', 'cushion'] as const;
export type BlueprintDetail = (typeof BLUEPRINT_DETAILS)[number];

export const BEHAVIOR_DEFS: Record<InventionBehavior, { label: string; does: string; activity?: Activity; duration?: number; effect?: NeedDelta }> = {
  storage: { label: 'Storage: Blurb can hold more, and tidies up here', does: 'it holds my stuff, so I can carry more', activity: 'organizing', duration: 10, effect: { boredom: -3, curiosity: -0.5 } },
  wardrobe: { label: 'Wardrobe: Blurb changes outfits here', does: 'I can change outfits at it', activity: 'dressing', duration: 6, effect: { boredom: -3 } },
  seat: { label: 'Seat: Blurb sits and rests', does: 'I can sit on it and rest', activity: 'resting', duration: 15, effect: { energy: 0.8, social: -0.3 } },
  bed: { label: 'Bed: Blurb sleeps here', does: 'I can nap in it', activity: 'sleeping', duration: 60, effect: { energy: 2.2 } },
  toy: { label: 'Toy: Blurb plays with it', does: 'I can play with it', activity: 'playing', duration: 9, effect: { boredom: -5, energy: -0.5 } },
  reading: { label: 'Reading spot: Blurb reads a book from its shelf here', does: 'I can read my books there', activity: 'reading', duration: 18, effect: { curiosity: -4, boredom: -2 } },
  decor: { label: 'Decoration', does: "it's just for looking nice" },
};

/** What fans' renderers need to draw an invented object. */
export interface PublicBlueprint {
  id: string;
  name: string;
  behavior: InventionBehavior;
  base: BlueprintBase;
  width: number;
  height: number;
  color: string;
  accent: string;
  details: BlueprintDetail[];
  zone: 'house' | 'yard';
}

export interface Blueprint extends PublicBlueprint {
  recipe: Partial<Record<ResourceKind, number>>;
  /** The book or article Blurb learned this from. */
  learnedFrom: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

/** Something Blurb wants to invent. Learn first, then design. */
export interface Idea {
  topic: string;
  status: 'curious' | 'researched' | 'designed';
  source: 'self' | 'owner';
  addedAt: number;
  learnedTitle?: string;
  summary?: string;
  /** Failed lookups (offline, or reading switched off). */
  tries?: number;
}

export const LIMITS_INVENT = {
  width: [8, 48],
  height: [6, 60],
  maxDetails: 4,
  maxRecipeKinds: 4,
  maxPerResource: 8,
  maxRecipeTotal: 16,
  maxPending: 3,
  maxIdeas: 5,
} as const;

const NOUNS: Record<ResourceKind, [string, string]> = {
  stick: ['stick', 'sticks'],
  leaf: ['leaf', 'leaves'],
  berry: ['berry', 'berries'],
  pebble: ['pebble', 'pebbles'],
  fluff: ['fluff', 'fluff'],
  bioplastic: ['bioplastic', 'bioplastic'],
  wire: ['wire', 'wire'],
  glass: ['piece of glass', 'pieces of glass'],
};

/** "4 sticks, 2 wire, 1 piece of glass" */
export function recipeText(r: Partial<Record<ResourceKind, number>>): string {
  return Object.entries(r)
    .map(([k, n]) => `${n} ${(NOUNS[k as ResourceKind] ?? [k, k])[n === 1 ? 0 : 1]}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Registry: approved (and pending, for previews) blueprints this process knows.
// ---------------------------------------------------------------------------

const registry = new Map<string, PublicBlueprint>();
const defCache = new Map<string, ObjectDef>();

export function setBlueprints(list: PublicBlueprint[]) {
  registry.clear();
  defCache.clear();
  for (const b of list) registry.set(b.id, b);
}

export function getBlueprint(id: string | undefined): PublicBlueprint | undefined {
  return id ? registry.get(id) : undefined;
}

export function toPublicBlueprint(b: Blueprint | PublicBlueprint): PublicBlueprint {
  return { id: b.id, name: b.name, behavior: b.behavior, base: b.base, width: b.width, height: b.height, color: b.color, accent: b.accent, details: [...b.details], zone: b.zone };
}

function blueprintDef(b: PublicBlueprint & { recipe?: Blueprint['recipe'] }): ObjectDef {
  const beh = BEHAVIOR_DEFS[b.behavior];
  return {
    kind: 'invention',
    label: b.name,
    width: b.width,
    height: b.height,
    defaultColor: b.color,
    zones: [b.zone],
    activity: beh.activity,
    duration: beh.duration,
    effect: beh.effect,
    recipe: (b as Blueprint).recipe,
  };
}

/**
 * The definition for any object, built-in or invented. Works with world
 * objects ({kind, data.blueprintId}) and public objects ({k, bp}).
 */
export function defOf(o: { kind?: ObjectKind; k?: ObjectKind; data?: { blueprintId?: string }; bp?: string }): ObjectDef {
  const kind = (o.kind ?? o.k) as ObjectKind;
  if (kind !== 'invention') return OBJECT_DEFS[kind];
  const id = o.data?.blueprintId ?? o.bp;
  const b = getBlueprint(id);
  if (!b) return OBJECT_DEFS.invention;
  let d = defCache.get(b.id);
  if (!d) defCache.set(b.id, (d = blueprintDef(b)));
  return d;
}

// ---------------------------------------------------------------------------
// Validation of a design (from the LLM or the rule brain)
// ---------------------------------------------------------------------------

const clampInt = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d;
const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>[\]{}`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export interface DesignContext {
  knowledge: string[];
  existingNames: string[];
  pendingCount: number;
}

/** Turn raw input into a safe pending Blueprint, or explain why not. */
export function validateDesign(raw: Record<string, unknown>, ctx: DesignContext, id: string, now: number): Blueprint | { reason: string } {
  const name = text(raw.name, 24);
  if (name.length < 3) return { reason: 'an invention needs a name' };
  if (findProfanity(name).length) return { reason: 'that name is not okay' };
  const lower = name.toLowerCase();
  if (ctx.existingNames.some((n) => n.toLowerCase() === lower)) return { reason: `I already have a ${name.toLowerCase()}` };
  if (ctx.pendingCount >= LIMITS_INVENT.maxPending) return { reason: 'I already have designs waiting for approval' };

  const learnedFrom = text(raw.learnedFrom, 100);
  const known = ctx.knowledge.find((k) => k.toLowerCase() === learnedFrom.toLowerCase());
  if (!known) return { reason: `I have to learn about it first (read about "${learnedFrom || name}")` };

  const behavior = (INVENTION_BEHAVIORS as readonly string[]).includes(raw.behavior as string) ? (raw.behavior as InventionBehavior) : null;
  if (!behavior) return { reason: 'inventions can only do things I can already do (storage, wardrobe, seat, bed, toy, reading, decor)' };
  const base = (BLUEPRINT_BASES as readonly string[]).includes(raw.base as string) ? (raw.base as BlueprintBase) : 'box';
  const details = Array.isArray(raw.details)
    ? [...new Set(raw.details.filter((d): d is BlueprintDetail => (BLUEPRINT_DETAILS as readonly string[]).includes(d as string)))].slice(0, LIMITS_INVENT.maxDetails)
    : [];

  const recipe: Partial<Record<ResourceKind, number>> = {};
  let total = 0;
  if (raw.recipe && typeof raw.recipe === 'object') {
    for (const [k, v] of Object.entries(raw.recipe as Record<string, unknown>)) {
      if (!(RESOURCE_KINDS as readonly string[]).includes(k)) continue;
      if (Object.keys(recipe).length >= LIMITS_INVENT.maxRecipeKinds) break;
      const n = clampInt(v, 1, LIMITS_INVENT.maxPerResource, 0);
      if (!n || total + n > LIMITS_INVENT.maxRecipeTotal) continue;
      recipe[k as ResourceKind] = n;
      total += n;
    }
  }
  if (!total) return { reason: 'a design needs a recipe made of real resources' };

  const zone = raw.zone === 'yard' ? 'yard' : 'house';
  return {
    id,
    name,
    behavior,
    base,
    width: clampInt(raw.width, LIMITS_INVENT.width[0], LIMITS_INVENT.width[1], 20),
    height: clampInt(raw.height, LIMITS_INVENT.height[0], LIMITS_INVENT.height[1], 16),
    color: normalizeColor(raw.color) ?? '#a0703c',
    accent: normalizeColor(raw.accent) ?? '#e0b23a',
    details,
    zone,
    recipe,
    learnedFrom: known,
    description: text(raw.description, 140),
    status: 'pending',
    createdAt: now,
  };
}
