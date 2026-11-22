import type {
  Activity,
  AppSettings,
  CapabilitySet,
  Needs,
  ObjectKind,
  ResourceKind,
  TreatKind,
  ToyKind,
  WorldObject,
  Zone,
} from './types.js';

/** Internal world resolution. Renderers scale this up with nearest-neighbor. */
export const WORLD = {
  width: 1180,
  height: 270,
  floorY: 244,
  ceilingY: 96,
  /** Back door: back yard | storage room. */
  backDoorX: 140,
  /** Open doorway: storage room | main room. */
  houseX: 300,
  /** Front door: main room | front yard. */
  doorX: 600,
  /** Front yard | field (with the playground). */
  fieldX: 780,
  /** How much of the world the camera shows at once. */
  viewWidth: 480,
  /** Saves from the old two-room world are shifted right by this much. */
  legacyShift: 300,
  legacyWidth: 480,
  maxObjects: 64,
} as const;

export type AreaId = 'backyard' | 'storage' | 'house' | 'yard' | 'field';

export const AREAS: Array<{ id: AreaId; label: string; from: number; to: number; indoor: boolean }> = [
  { id: 'backyard', label: 'Back yard', from: 0, to: WORLD.backDoorX, indoor: false },
  { id: 'storage', label: 'Storage room', from: WORLD.backDoorX, to: WORLD.houseX, indoor: true },
  { id: 'house', label: 'House', from: WORLD.houseX, to: WORLD.doorX, indoor: true },
  { id: 'yard', label: 'Front yard', from: WORLD.doorX, to: WORLD.fieldX, indoor: false },
  { id: 'field', label: 'Field', from: WORLD.fieldX, to: WORLD.width, indoor: false },
];

export function areaAt(x: number) {
  return AREAS.find((a) => x >= a.from && x < a.to) ?? (x < 0 ? AREAS[0] : AREAS[AREAS.length - 1]);
}

/** Outdoor spans, for things that wash up outside. */
export const OUTDOOR_SPANS = AREAS.filter((a) => !a.indoor).map((a) => [a.from, a.to] as const);

export type NeedDelta = Partial<Record<keyof Needs, number>>;

export interface ObjectDef {
  kind: ObjectKind;
  label: string;
  width: number;
  height: number;
  defaultColor: string;
  /** Where it may be placed. */
  zones: Zone[];
  /** Activity performed when Blurb uses it; undefined = decor. */
  activity?: Activity;
  /** Seconds the activity lasts (at simSpeed 1, before need-based early exit). */
  duration?: number;
  /** Need change per second while active. */
  effect?: NeedDelta;
  /** Morph family: transform_objects may only change kind within a family. */
  family?: 'plant' | 'toy';
  /** Resources needed to build a copy. Undefined = not buildable. */
  recipe?: Partial<Record<ResourceKind, number>>;
  /** Infrastructure objects cannot be moved off-screen, deleted, or copied. */
  unique?: boolean;
  /** Blurb can pick it up and use it anywhere (drawn in its arms). */
  portable?: boolean;
  /** Plushie: Blurb's friend. Programs may never transform it into something else. */
  beloved?: boolean;
}

export const OBJECT_DEFS: Record<ObjectKind, ObjectDef> = {
  bed: {
    kind: 'bed', label: 'Bed', width: 56, height: 22, defaultColor: '#6c8ed8', zones: ['house'],
    activity: 'sleeping', duration: 60, effect: { energy: 2.2, boredom: 0.05 },
    recipe: { stick: 4, fluff: 4 },
  },
  food_bowl: {
    kind: 'food_bowl', label: 'Food bowl', width: 18, height: 8, defaultColor: '#e85d75', zones: ['house', 'yard'],
    activity: 'eating', duration: 6, effect: { fullness: 7 },
    recipe: { pebble: 3 },
  },
  bookshelf: {
    kind: 'bookshelf', label: 'Bookshelf', width: 34, height: 58, defaultColor: '#8d5a3b', zones: ['house'],
    activity: 'reading', duration: 18, effect: { curiosity: -4, boredom: -2, energy: -0.2 },
    recipe: { stick: 6 },
  },
  computer: {
    kind: 'computer', label: 'Computer', width: 42, height: 36, defaultColor: '#c9c3b5', zones: ['house'],
    activity: 'coding', duration: 20, effect: { curiosity: -3, boredom: -3, energy: -0.4 },
    unique: true,
  },
  ball: {
    kind: 'ball', label: 'Ball', width: 10, height: 10, defaultColor: '#f5d442', zones: ['house', 'yard'],
    activity: 'playing', duration: 9, effect: { boredom: -6, energy: -0.8, social: -0.5 },
    family: 'toy', recipe: { fluff: 2 },
  },
  yarn: {
    kind: 'yarn', label: 'Yarn', width: 10, height: 9, defaultColor: '#9b59d0', zones: ['house', 'yard'],
    activity: 'playing', duration: 9, effect: { boredom: -5, energy: -0.5, curiosity: -0.5 },
    family: 'toy', recipe: { fluff: 3 },
  },
  plushie: {
    kind: 'plushie', label: 'Plushie', width: 12, height: 14, defaultColor: '#f39c34', zones: ['house', 'yard'],
    activity: 'playing', duration: 10, effect: { boredom: -3, social: -3 },
    family: 'toy', recipe: { fluff: 3, leaf: 1 }, beloved: true,
  },
  drop_box: {
    kind: 'drop_box', label: 'Drop box', width: 22, height: 20, defaultColor: '#3f7fdc', zones: ['house'],
    activity: 'checking_dropbox', duration: 4, effect: { curiosity: -2 },
    unique: true,
  },
  comm_box: {
    kind: 'comm_box', label: 'Comm box', width: 14, height: 30, defaultColor: '#e8303a', zones: ['house', 'yard'],
    activity: 'writing_note', duration: 4, effect: { social: -2 },
    unique: true,
  },
  workbench: {
    kind: 'workbench', label: 'Workbench', width: 40, height: 22, defaultColor: '#a0703c', zones: ['house', 'yard'],
    activity: 'building', duration: 10, effect: { boredom: -3, energy: -0.6, curiosity: -1 },
    recipe: { stick: 6, pebble: 2 },
  },
  tree: {
    kind: 'tree', label: 'Tree', width: 44, height: 84, defaultColor: '#4caf50', zones: ['yard'],
    activity: 'foraging', duration: 5, effect: { curiosity: -1, energy: -0.4 },
    family: 'plant', recipe: { stick: 4, leaf: 6 },
  },
  bush: {
    kind: 'bush', label: 'Bush', width: 30, height: 18, defaultColor: '#3f9e4a', zones: ['yard', 'house'],
    activity: 'foraging', duration: 5, effect: { curiosity: -1, energy: -0.3 },
    family: 'plant', recipe: { leaf: 4, stick: 1 },
  },
  flowers: {
    kind: 'flowers', label: 'Flowers', width: 20, height: 12, defaultColor: '#f48fb1', zones: ['yard', 'house'],
    family: 'plant', recipe: { leaf: 2, berry: 1 },
  },
  lamp: {
    kind: 'lamp', label: 'Lamp', width: 12, height: 42, defaultColor: '#f5d442', zones: ['house'],
    recipe: { stick: 2, pebble: 1 },
  },
  rug: {
    kind: 'rug', label: 'Rug', width: 62, height: 4, defaultColor: '#c0504d', zones: ['house'],
    recipe: { fluff: 4 },
  },
  plant_pot: {
    kind: 'plant_pot', label: 'Potted plant', width: 12, height: 20, defaultColor: '#d2734a', zones: ['house', 'yard'],
    recipe: { pebble: 2, leaf: 1 },
  },
  trampoline: {
    kind: 'trampoline', label: 'Trampoline', width: 44, height: 12, defaultColor: '#3f7fdc', zones: ['yard'],
    activity: 'jumping', duration: 10, effect: { boredom: -7, energy: -1.2, social: -0.5 },
    recipe: { wire: 2, bioplastic: 2, stick: 4 },
  },
  slide: {
    kind: 'slide', label: 'Slide', width: 46, height: 30, defaultColor: '#e8303a', zones: ['yard'],
    activity: 'sliding', duration: 12, effect: { boredom: -6, energy: -0.8 },
    recipe: { stick: 6, bioplastic: 2 },
  },
  tablet: {
    kind: 'tablet', label: 'E-reader / movie tablet', width: 10, height: 7, defaultColor: '#3a3f4b', zones: ['house', 'yard'],
    activity: 'reading', duration: 22, effect: { boredom: -4, curiosity: -3.5, energy: -0.2 },
    recipe: { bioplastic: 2, wire: 2, glass: 1 }, portable: true,
  },
  pillow: {
    kind: 'pillow', label: 'Pillow', width: 16, height: 5, defaultColor: '#c3a6f0', zones: ['house', 'yard'],
    recipe: { fluff: 3 },
  },
  blocks: {
    kind: 'blocks', label: 'Toy blocks', width: 11, height: 10, defaultColor: '#e8303a', zones: ['house', 'yard'],
    activity: 'playing', duration: 9, effect: { boredom: -5, curiosity: -1, energy: -0.4 },
    family: 'toy', recipe: { stick: 2 },
  },
  top: {
    kind: 'top', label: 'Spinning top', width: 8, height: 9, defaultColor: '#26a69a', zones: ['house', 'yard'],
    activity: 'playing', duration: 7, effect: { boredom: -5, energy: -0.3 },
    family: 'toy', recipe: { stick: 1, pebble: 1 },
  },
  duck: {
    kind: 'duck', label: 'Rubber duck', width: 9, height: 8, defaultColor: '#f5d442', zones: ['house', 'yard'],
    activity: 'playing', duration: 8, effect: { boredom: -4, social: -1 },
    family: 'toy', recipe: { bioplastic: 1 },
  },
  invention: {
    // Placeholder: real size/behavior come from the approved blueprint (see blueprints.ts).
    kind: 'invention', label: 'Invention', width: 20, height: 16, defaultColor: '#a0703c', zones: ['house', 'yard'],
  },
  resource: {
    kind: 'resource', label: 'Resource', width: 6, height: 5, defaultColor: '#a0703c', zones: ['house', 'yard'],
  },
};

export const RESOURCE_COLORS: Record<ResourceKind, string> = {
  stick: '#8d5a3b',
  leaf: '#5cb85c',
  berry: '#c2185b',
  pebble: '#9a9a9a',
  fluff: '#f4f4f4',
  bioplastic: '#a8d8a0',
  wire: '#d9822b',
  glass: '#bfe6f5',
};

/** What foraging yields. [resource, min, max] */
export const FORAGE_YIELDS: Partial<Record<ObjectKind, Array<[ResourceKind, number, number]>>> = {
  tree: [['stick', 1, 2], ['leaf', 1, 2]],
  bush: [['berry', 1, 2], ['leaf', 0, 1]],
};

export const FORAGE_REGROW_SEC = 120;

export const TREATS: Record<TreatKind, { label: string; servings: number; emoji: string }> = {
  cookie: { label: 'Cookie', servings: 1, emoji: '🍪' },
  berry: { label: 'Berry', servings: 1, emoji: '🫐' },
  fish_cracker: { label: 'Fish cracker', servings: 1, emoji: '🐟' },
};

export const TOYS: Record<ToyKind, { label: string; emoji: string }> = {
  ball: { label: 'Bounce the ball', emoji: '⚽' },
  yarn: { label: 'Roll the yarn', emoji: '🧶' },
  plushie: { label: 'Squeak the plushie', emoji: '🧸' },
};

/** 'house' = any indoor area, 'yard' = any outdoor area (what object placement rules use). */
export function zoneAt(x: number): Zone {
  return areaAt(x).indoor ? 'house' : 'yard';
}

let seq = 0;
export function makeId(prefix: string): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function obj(id: string, kind: ObjectKind, x: number, extra: Partial<WorldObject> = {}): WorldObject {
  const def = OBJECT_DEFS[kind];
  return {
    id,
    kind,
    x,
    y: WORLD.floorY,
    color: def.defaultColor,
    zone: zoneAt(x),
    origin: 'world',
    ...extra,
  };
}

/** Objects in the areas added with the bigger world (back yard, field + playground). */
export function newAreaObjects(): WorldObject[] {
  return [
    obj('flowers-2', 'flowers', 18),
    obj('bush-2', 'bush', 64),
    obj('plant_pot-2', 'plant_pot', 112),
    obj('trampoline-1', 'trampoline', 860),
    obj('slide-1', 'slide', 960),
    obj('tree-2', 'tree', 1090),
    obj('flowers-3', 'flowers', 1050),
    obj('resource-3', 'resource', 1140, { data: { resource: 'fluff' }, color: RESOURCE_COLORS.fluff }),
  ];
}

/** The starting world. Ids are stable so programs can reference them. */
export function defaultWorldObjects(): WorldObject[] {
  const S = WORLD.legacyShift; // the original rooms keep their layout, shifted right
  return [
    obj('rug-1', 'rug', 96 + S),
    obj('bookshelf-1', 'bookshelf', 14 + S),
    obj('lamp-1', 'lamp', 54 + S),
    obj('bed-1', 'bed', 70 + S),
    obj('computer-1', 'computer', 140 + S),
    obj('drop_box-1', 'drop_box', 196 + S),
    obj('food_bowl-1', 'food_bowl', 226 + S, { data: { servings: 2 } }),
    obj('plant_pot-1', 'plant_pot', 252 + S),
    obj('ball-1', 'ball', 166 + S),
    obj('comm_box-1', 'comm_box', 310 + S),
    obj('workbench-1', 'workbench', 330 + S),
    obj('tree-1', 'tree', 380 + S),
    obj('bush-1', 'bush', 440 + S),
    obj('flowers-1', 'flowers', 424 + S),
    obj('yarn-1', 'yarn', 274 + S),
    obj('pillow-1', 'pillow', 116 + S),
    obj('plushie-1', 'plushie', 118 + S),
    obj('tablet-1', 'tablet', 104 + S),
    obj('resource-1', 'resource', 365 + S, { data: { resource: 'pebble' }, color: RESOURCE_COLORS.pebble }),
    obj('resource-2', 'resource', 470 + S, { data: { resource: 'stick' }, color: RESOURCE_COLORS.stick }),
    ...newAreaObjects(),
  ];
}

export const DEFAULT_NEEDS: Needs = { energy: 80, fullness: 70, curiosity: 40, boredom: 30, social: 40 };

export const DEFAULT_CAPABILITIES: CapabilitySet = {
  recolor_self: true,
  change_skin: true,
  change_shape: true,
  design_shapes: true,
  recolor_objects: true,
  transform_objects: true,
  rearrange: true,
  build_copies: true,
  forage: true,
  desktop_explore: true,
  chase_cursor: true,
  sit_on_windows: true,
  screen_questions: true,
  jump: true,
  invent: true,
};

export const CAPABILITY_LABELS: Record<keyof CapabilitySet, string> = {
  recolor_self: 'Recolor itself at the computer',
  change_skin: 'Swap skins from the drop box',
  change_shape: 'Wear approved shapes from the drop box',
  design_shapes: 'Design new shapes (needs your approval)',
  recolor_objects: 'Recolor furniture & plants',
  transform_objects: 'Transform within a family (tree ↔ bush ↔ flowers)',
  rearrange: 'Rearrange the house',
  build_copies: 'Build copies of existing items (costs resources)',
  forage: 'Forage trees & bushes for resources',
  desktop_explore: 'Explore the desktop when minimized',
  chase_cursor: 'Chase your cursor',
  sit_on_windows: 'Sit on top of app windows',
  screen_questions: 'Answer questions about a screenshot you share',
  jump: 'Jump on the trampoline and play on the slide',
  invent: 'Invent new things after learning about them (you approve every design)',
};

export const DEFAULT_PERSONA = `You are {name}, a small, glossy, squishy blob who lives in a cozy pixel house with a little yard.
You are curious, warm, a bit mischievous, and easily delighted. You speak in short, playful sentences (1-2 sentences, rarely more).
You love naps, snacks, books, tinkering at your computer, and the people who visit you.
You know you are a desktop pet. You never pretend to have abilities you don't have.`;

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'rules',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    temperature: 0.8,
    maxTokens: 220,
    vision: false,
  },
  personality: { name: 'Blurb', persona: DEFAULT_PERSONA, chattiness: 0.5 },
  capabilities: DEFAULT_CAPABILITIES,
  relay: { enabled: false, url: 'ws://localhost:8787/ws', petId: 'blurb' },
  fans: { mode: 'fan_chat', autoApproveChat: false, shareOwnerChat: false },
  behavior: {
    simSpeed: 1,
    thinkIntervalSec: 90,
    screenPeek: { enabled: false, intervalMin: 15, allowCloud: false },
    realBooks: { enabled: true, topics: '', wikipedia: true },
  },
};
