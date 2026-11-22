/**
 * The rule brain: utility scoring for "what should I do next", emotion from
 * needs, a phrase bank for chatter when no LLM is configured, and a
 * rule-based BlurbScript generator for computer sessions without an LLM.
 *
 * The LLM (when present) layers on top of this; it never replaces the
 * physics or the safety checks.
 */
import {
  BUILTIN_SKINS,
  OBJECT_DEFS,
  WORLD,
  canAfford,
  defOf,
  getBlueprint,
  type BlueprintBase,
  type BlueprintDetail,
  type CapabilitySet,
  type Idea,
  type InventionBehavior,
  type ResourceKind,
  type DropBox,
  type Emotion,
  type Inventory,
  type Needs,
  type ObjectKind,
  type PetState,
  type WorldObject,
} from '@blurb/shared';

export interface BrainContext {
  pet: PetState;
  objects: WorldObject[];
  dropBox: DropBox;
  capabilities: CapabilitySet;
  hasOutbox: boolean;
  hour: number;
  /** seconds since the last computer session */
  sinceCoding: number;
  rng: () => number;
  /** An idea is waiting to be looked up on the tablet. */
  wantsResearch?: boolean;
  /** A researched idea is waiting to be designed at the computer. */
  wantsDesign?: boolean;
  /** An approved invention can be built right now. */
  buildable?: boolean;
  /** Resources still missing for an approved invention. */
  gathering?: Partial<Record<ResourceKind, number>>;
}

export interface Choice {
  objectId?: string;
  x: number;
  score: number;
  reason: string;
  kind: 'use_object' | 'pick_up' | 'wander';
}

const isNight = (h: number) => h >= 22 || h < 7;

export function interactionX(o: WorldObject): number {
  const def = defOf(o);
  switch (o.kind) {
    case 'bed':
      return o.x + 32;
    case 'computer':
      return o.x + 21;
    case 'tablet':
      return o.x + 5;
    case 'trampoline':
      return o.x + 22;
    case 'slide':
      return o.x + 5;
    case 'bookshelf':
      return o.x + def.width + 10;
    case 'tree':
      return o.x + 22;
    case 'comm_box':
      return o.x + def.width + 12;
    case 'drop_box':
      return o.x + def.width + 12;
    default:
      return o.x + def.width / 2;
  }
}

function affordableBuild(objects: WorldObject[], inv: Inventory): ObjectKind | undefined {
  const kinds = [...new Set(objects.map((o) => o.kind))].filter((k) => {
    const d = OBJECT_DEFS[k];
    return d.recipe && !d.unique && k !== 'resource' && canAfford(inv, d.recipe);
  });
  return kinds[0];
}

export function scoreChoices(ctx: BrainContext): Choice[] {
  const { pet, objects, capabilities: caps, rng } = ctx;
  const n = pet.needs;
  const out: Choice[] = [];
  const totalRes = Object.values(pet.inventory.resources).reduce((a, b) => a + (b ?? 0), 0);

  const gather = ctx.gathering ?? {};
  const needs = (...rs: ResourceKind[]) => rs.some((r) => (gather[r] ?? 0) > 0);
  for (const o of objects) {
    if (o.data?.carried) continue;
    const def = defOf(o);
    let s = -Infinity;
    let reason = '';
    switch (o.kind) {
      case 'bed':
        s = n.energy > 85 ? -Infinity : Math.pow(100 - n.energy, 1.5) / 10 + (isNight(ctx.hour) ? 30 : 0);
        reason = 'sleepy';
        break;
      case 'food_bowl':
        if ((o.data?.servings ?? 0) > 0 && n.fullness < 85) s = (100 - n.fullness) * 1.15;
        reason = 'hungry';
        break;
      case 'bookshelf':
        s = n.curiosity * 0.6 + n.boredom * 0.2;
        reason = 'curious';
        break;
      case 'computer':
        if (ctx.wantsDesign && ctx.sinceCoding >= 60) {
          s = 45 + n.curiosity * 0.5;
          reason = 'wants to design an invention';
        } else {
          s = ctx.sinceCoding < 150 ? -Infinity : n.curiosity * 0.5 + n.boredom * 0.35;
          reason = 'wants to tinker';
        }
        break;
      case 'trampoline':
      case 'slide':
        if (caps.jump) s = n.boredom * 0.9 + (n.energy > 35 ? 8 : -40);
        reason = o.kind === 'trampoline' ? 'wants to bounce' : 'wants to slide';
        break;
      case 'tablet':
        // Read when curious, watch a movie when bored; a little novelty bonus.
        s = Math.max(n.curiosity * 0.55, n.boredom * 0.6) + 6 + (ctx.wantsResearch ? 40 : 0);
        reason = ctx.wantsResearch ? 'wants to look something up' : n.boredom > n.curiosity ? 'wants to watch a movie' : 'wants to read';
        break;
      case 'invention': {
        const beh = getBlueprint(o.data?.blueprintId)?.behavior;
        if (beh === 'storage') s = 8 + n.boredom * 0.35 + (totalRes > 20 ? 12 : 0);
        else if (beh === 'wardrobe') s = caps.change_skin && ctx.dropBox.skins.length > 1 ? 6 + n.boredom * 0.5 : -Infinity;
        else if (beh === 'seat') s = n.energy < 70 ? (100 - n.energy) * 0.55 : -Infinity;
        else if (beh === 'bed') s = n.energy > 85 ? -Infinity : Math.pow(100 - n.energy, 1.5) / 10 + (isNight(ctx.hour) ? 30 : 0);
        else if (beh === 'toy') s = n.boredom * 0.8 + (o.data?.bounce ? 45 : 0);
        else if (beh === 'reading') s = n.curiosity * 0.6 + n.boredom * 0.2 + 4;
        reason = beh ? `wants to use the ${def.label.toLowerCase()}` : '';
        break;
      }
      case 'ball':
      case 'yarn':
      case 'blocks':
      case 'top':
      case 'duck':
      case 'plushie':
        s = n.boredom * 0.8 + (o.data?.bounce ? 45 : 0) + (o.kind === 'plushie' ? n.social * 0.3 : 0);
        reason = 'bored';
        break;
      case 'drop_box':
        // Capped so a big delivery never outranks real hunger or exhaustion.
        s = ctx.dropBox.items.length ? 70 + Math.min(4, ctx.dropBox.items.length) * 5 : n.curiosity * 0.08;
        reason = ctx.dropBox.items.length ? 'something in the drop box' : 'checking for mail';
        break;
      case 'comm_box':
        s = ctx.hasOutbox ? 85 : -Infinity;
        reason = 'has a note to deliver';
        break;
      case 'workbench':
        if (caps.build_copies && (ctx.buildable || affordableBuild(objects, pet.inventory))) s = 25 + n.boredom * 0.45 + (ctx.buildable ? 45 : 0);
        reason = ctx.buildable ? 'wants to build an invention' : 'wants to build';
        break;
      case 'tree':
      case 'bush': {
        // Gathering for an approved invention beats the usual "I have enough" limit.
        const forInvention = o.kind === 'tree' ? needs('stick', 'leaf') : needs('berry', 'leaf');
        if (caps.forage && (o.data?.regrowIn ?? 0) <= 0 && (totalRes < 14 || forInvention))
          s = 12 + n.curiosity * 0.3 + n.boredom * 0.25 + (o.kind === 'bush' && n.fullness < 40 ? 20 : 0) + (forInvention ? 25 : 0);
        reason = forInvention ? 'gathering for an invention' : 'foraging';
        break;
      }
      case 'resource': {
        const wanted = needs((o.data?.resource ?? 'pebble') as ResourceKind);
        if (totalRes < 20 || wanted) s = 30 + (wanted ? 25 : 0);
        reason = wanted ? 'needs that for an invention' : 'found something';
        break;
      }
    }
    if (!def.activity && o.kind !== 'resource') continue;
    if (!Number.isFinite(s)) continue;
    const x = interactionX(o);
    const dist = Math.abs(x - pet.position.x);
    out.push({
      objectId: o.id,
      x,
      score: s - dist / 18 + rng() * 14,
      reason,
      kind: o.kind === 'resource' ? 'pick_up' : 'use_object',
    });
  }
  out.push({ x: 20 + rng() * (WORLD.width - 40), score: 14 + rng() * 10, reason: 'wandering', kind: 'wander' });
  return out.sort((a, b) => b.score - a.score);
}

export function moodFromNeeds(n: Needs): Emotion {
  if (n.energy < 18) return 'sleepy';
  if (n.fullness < 18) return 'sad';
  if (n.social > 88 || n.boredom > 88) return 'sad';
  if (n.curiosity > 78) return 'thinking';
  const wellbeing = (n.energy + n.fullness + (100 - n.boredom) + (100 - n.social) + (100 - n.curiosity)) / 5;
  return wellbeing > 66 ? 'happy' : 'neutral';
}

// ---------------------------------------------------------------------------
// Phrase bank (used when the brain is in rules mode, or for tiny reactions)
// ---------------------------------------------------------------------------

export const PHRASES: Record<string, string[]> = {
  wake: ['*yawn* Good morning, world!', 'Mmf… that was a great nap.', 'Fully recharged!'],
  sleep: ['Nap time…', 'Just resting my eyes…', 'Zzz… five more minutes…'],
  eat: ['Nom nom nom!', 'Delicious!', 'Crunchy!'],
  read: ['Ooh, a book about clouds!', 'Did you know octopuses have three hearts?', 'One more chapter…'],
  bounce: ['Boing! Boing! BOING!', 'Higher! Higher!', 'I can almost touch the clouds!'],
  slide: ['Wheeeee!', 'Up the ladder… and WHOOSH!', 'Again! Again!'],
  movie: ['What a movie!', 'I laughed, I cried, I ate imaginary popcorn.', 'Roll the credits!'],
  tuck: ['Nap time, little buddy.', 'Sleep tight, Plushie.', 'There — cozy on your pillow.'],
  book_start: ['Reading "{title}"…', 'Ooh, "{title}"!', 'Opening "{title}"{by}.'],
  book_finish: ['Finished "{title}"! Loved it.', 'The end of "{title}". *happy sigh*', 'That was "{title}"{by}. What a book!'],
  learn_start: ['Ooh, learning about {title}!', 'Reading up on {title}…', 'Wikipedia time: {title}!'],
  learn_finish: ['Did you know? {fact}', 'I learned something: {fact}', 'Fun fact! {fact}'],
  shelf_done: ['I\'ve read every book on my shelf!', 'All my books are read… new ones, please?'],
  code: ['Beep boop. Tinkering…', 'Let me try something…', 'Compiling dreams…'],
  play: ['Wheee!', 'Catch it, catch it!', 'Boing boing!'],
  forage: ['Ooh, found some goodies!', 'Nature provides!', 'Into the bag you go.'],
  build: ['Ta-da! I made a thing!', 'Built it myself!', 'A little workshop magic!'],
  dropbox: ['Let\'s see what\'s in the box…', 'Mail call!', 'Ooh, a delivery!'],
  note: ['I left you a note in the comm box!', 'Check the mailbox, please!'],
  hungry: ['My tummy is rumbling…', 'Is it snack time?'],
  bored: ['So bored… entertain me?', 'Hmm, what should I do…'],
  lonely: ['Hello? Anybody there?', 'I miss you!'],
  treat: ['A treat! Thank you, {name}!', 'Yum! Thanks, {name}!', '{name}, you\'re the best!'],
  toy: ['Ooh, the {toy}!', 'Play time!'],
  petted: ['Hehe, that tickles!', '*happy wiggle*', 'More pats please!'],
  dropped: ['Whoa!', 'Boing!', 'Again! Again!'],
  denied: ['Hmm, I\'m not allowed to do that.', 'That\'s not one of my powers.'],
  approved: ['My new shape got approved!! Thank you!', 'Yay, new look unlocked!'],
  idea: ['Ooh, an idea: a {thing}! I should read up on it first.', 'Hmm… what if I made a {thing}?', 'I want to invent a {thing}! To the tablet!'],
  design: ['Time to design my {thing}!', 'Drawing up plans for a {thing}…', 'Blueprint time: {thing}!'],
  invented: ['Ta-da! My very own {thing}!', 'I built the {thing}! It works!', 'Workshop magic: one {thing}!'],
  tidy: ['Everything in its place!', 'So tidy!', 'Neat and organized.'],
  sit: ['Ahh, a nice sit.', 'Comfy!', 'Just resting my feet.'],
  rejected: ['Aw, back to the drawing board.', 'Okay, I\'ll design something better.'],
  hello_desktop: ['Ooh, the big world!', 'Out for a stroll!', 'Hi from your desktop!'],
  hungry_desktop: ['Psst… my food bowl is back home.', 'Could you open my window? Snack time!'],
};

export function phrase(key: string, rng: () => number, vars: Record<string, string> = {}): string {
  const list = PHRASES[key] ?? ['…'];
  let s = list[Math.floor(rng() * list.length)];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ---------------------------------------------------------------------------
// Rule-based "coding" (no LLM): small, safe, whimsical programs
// ---------------------------------------------------------------------------

const PRETTY = ['#f48fb1', '#80d0f8', '#f5d442', '#7fe0b0', '#c3a6f0', '#ff7f6a', '#9b59d0', '#3f7fdc', '#4caf50', '#e0b23a'];

export function ruleProgram(objects: WorldObject[], dropBox: DropBox, caps: CapabilitySet, inv: Inventory, rng: () => number): unknown[] {
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  const options: Array<() => unknown> = [];
  const decor = objects.filter((o) => !OBJECT_DEFS[o.kind].unique && o.kind !== 'resource');
  if (caps.recolor_objects && decor.length)
    options.push(() => ({ op: 'recolor', target: pick(decor).id, color: pick(PRETTY) }));
  if (caps.change_skin && dropBox.skins.length > 1)
    options.push(() => ({ op: 'set_skin', skin: pick(dropBox.skins.length ? dropBox.skins : BUILTIN_SKINS).id }));
  const plants = objects.filter((o) => OBJECT_DEFS[o.kind].family === 'plant' && o.zone === 'yard');
  if (caps.transform_objects && plants.length)
    options.push(() => {
      const p = pick(plants);
      const into = pick((['tree', 'bush', 'flowers'] as ObjectKind[]).filter((k) => k !== p.kind));
      return { op: 'transform', target: p.id, into };
    });
  const movable = objects.filter((o) => o.zone === 'house' && !OBJECT_DEFS[o.kind].unique && o.kind !== 'rug');
  if (caps.rearrange && movable.length)
    options.push(() => {
      const o = pick(movable);
      return { op: 'move', target: o.id, x: Math.round(WORLD.backDoorX + 10 + rng() * (WORLD.doorX - WORLD.backDoorX - 70)) };
    });
  if (caps.design_shapes && rng() < 0.25)
    options.push(() => ({
      op: 'design_shape',
      name: pick(['Starblob', 'Puddle', 'Mochi', 'Gumdrop', 'Marshmallow', 'Sprout']),
      spec: {
        width: 22 + Math.round(rng() * 14),
        height: 18 + Math.round(rng() * 10),
        peak: pick(['round', 'pointy', 'flat']),
        lean: Math.round((rng() - 0.5) * 8) / 10,
        feet: Math.floor(rng() * 5),
        ears: pick(['none', 'nubs', 'tufts']),
        gloss: rng() > 0.2,
      },
    }));
  if (caps.build_copies) {
    const k = affordableBuild(objects, inv);
    if (k) options.push(() => ({ op: 'build', kind: k, x: Math.round(20 + rng() * (WORLD.width - 60)) }));
  }
  if (!options.length) return [{ op: 'note', text: 'I sat at the computer but all my tinkering powers are switched off!' }];
  const n = 1 + Math.floor(rng() * 2);
  return Array.from({ length: n }, () => pick(options)());
}

// ---------------------------------------------------------------------------
// Rule-based inventing (no LLM): turn a researched idea into a design
// ---------------------------------------------------------------------------

interface DesignTemplate {
  re: RegExp;
  behavior: InventionBehavior;
  base: BlueprintBase;
  details: BlueprintDetail[];
  width: number;
  height: number;
  recipe: Partial<Record<ResourceKind, number>>;
  color: string;
  accent: string;
  zone?: 'house' | 'yard';
  description: string;
}

/** Most specific first: "toy chest" is storage, "reading chair" is a seat. */
const TEMPLATES: DesignTemplate[] = [
  { re: /closet|wardrobe|armoire|dresser|cupboard|costume/, behavior: 'wardrobe', base: 'tall', details: ['doors', 'knobs', 'legs'], width: 24, height: 46, recipe: { stick: 6, wire: 2, pebble: 2 }, color: '#8a5a3b', accent: '#e0b23a', description: 'A tall closet to keep my outfits in.' },
  { re: /chair|stool|sofa|couch|seat|beanbag|throne|ottoman/, behavior: 'seat', base: 'box', details: ['cushion', 'legs'], width: 18, height: 14, recipe: { stick: 3, fluff: 2 }, color: '#c0583a', accent: '#f2d0a4', description: 'A comfy seat for resting my feet.' },
  { re: /bed|hammock|cot|nest|bunk|futon/, behavior: 'bed', base: 'box', details: ['cushion', 'legs'], width: 34, height: 11, recipe: { stick: 4, fluff: 4 }, color: '#6b8fd6', accent: '#f4f0e6', description: 'A cozy little bed for naps.' },
  { re: /nook|library|bookcase|lectern|reading|desk/, behavior: 'reading', base: 'shelf', details: ['cushion'], width: 22, height: 32, recipe: { stick: 5, leaf: 2 }, color: '#7a5233', accent: '#f2d0a4', description: 'A snug spot to read my books.' },
  { re: /box|chest|crate|trunk|bin|storage|basket|bag|jar|cabinet|drawer|locker|bucket/, behavior: 'storage', base: 'chest', details: ['handles'], width: 26, height: 16, recipe: { stick: 4, pebble: 2 }, color: '#a0703c', accent: '#e0b23a', description: 'A sturdy box to keep my sticks and pebbles in.' },
  { re: /ball|toy|kite|puzzle|drum|game|spinner|marble|rattle|yo ?yo/, behavior: 'toy', base: 'round', details: ['stripes'], width: 10, height: 10, recipe: { fluff: 2, leaf: 1 }, color: '#e8303a', accent: '#f5d442', description: 'A new toy to play with.' },
  { re: /birdhouse|bird house|feeder|planter|fountain|statue|sundial|scarecrow|gnome|garden/, behavior: 'decor', base: 'box', details: ['window', 'lid'], width: 14, height: 18, recipe: { stick: 3, pebble: 2 }, color: '#b5793f', accent: '#d94f3d', zone: 'yard', description: 'Something nice for the yard.' },
];
const DEFAULT_TEMPLATE: DesignTemplate = { re: /./, behavior: 'decor', base: 'round', details: ['stripes'], width: 14, height: 18, recipe: { pebble: 2, leaf: 2 }, color: '#7fb3d5', accent: '#f5d442', description: 'A little something to make the house nicer.' };

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** A one-op program that designs the idea from a template. */
export function ruleDesign(idea: Pick<Idea, 'topic' | 'learnedTitle'>, rng: () => number): unknown[] {
  const t = TEMPLATES.find((x) => x.re.test(idea.topic)) ?? DEFAULT_TEMPLATE;
  const wobble = (v: number) => Math.round(v * (0.9 + rng() * 0.2));
  return [
    {
      op: 'invent',
      name: titleCase(idea.topic),
      learnedFrom: idea.learnedTitle,
      behavior: t.behavior,
      base: t.base,
      width: wobble(t.width),
      height: wobble(t.height),
      color: t.color,
      accent: t.accent,
      details: t.details,
      recipe: t.recipe,
      zone: t.zone ?? 'house',
      description: t.description,
    },
  ];
}

/** Things Blurb might want, based on what's going on in its life. */
export function selfIdea(
  c: { inventory: Inventory; cap: number; skins: number; books: number; has: (name: string) => boolean },
  rng: () => number,
): string | undefined {
  const counts = Object.values(c.inventory.resources).map((v) => v ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const most = Math.max(0, ...counts);
  const options: string[] = [];
  if (most >= c.cap * 0.6 || total >= 30) options.push('storage box');
  if (c.skins >= 4) options.push('closet');
  if (c.books >= 4) options.push('reading nook');
  if (!options.length && rng() < 0.3) options.push('armchair', 'toy chest', 'birdhouse');
  const open = options.filter((o) => !c.has(o));
  return open.length ? open[Math.floor(rng() * open.length)] : undefined;
}
