import { describe, expect, it } from 'vitest';
import {
  WORLD,
  areaAt,
  getBlueprint,
  parseTag,
  setBlueprints,
  toPublicBlueprint,
  toPublicState,
  validateDesign,
  validateProgram,
  type BookRef,
  type Blueprint,
} from '@blurb/shared';
import { PetSim } from '../src/index.js';
import { ruleDesign } from '../src/brain.js';

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeSim() {
  const sim = new PetSim();
  sim.rng = seeded();
  sim.hourOverride = 14;
  sim.dropBox.items = [];
  return sim;
}

/** Tick with real awaits in between, so article/program promises resolve. */
async function runUntil(sim: PetSim, done: () => boolean, maxSeconds = 1500, step = 0.1) {
  const t0 = Date.now();
  for (let t = 0; t < maxSeconds && !done(); t += step) {
    sim.tick(step, t0 + t * 1000);
    if (Math.round(t * 10) % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return done();
}

const CHEST: BookRef = {
  key: 'wiki:Chest (furniture)',
  title: 'Chest (furniture)',
  author: 'Wikipedia',
  blurb: 'A chest is a box with a lid, used to store things.',
};

const ctx = (over: Partial<Parameters<typeof validateDesign>[1]> = {}) => ({ knowledge: ['Chest (furniture)'], existingNames: ['Bed'], pendingCount: 0, ...over });
const good = { name: 'Storage Box', learnedFrom: 'Chest (furniture)', behavior: 'storage', base: 'chest', recipe: { stick: 4, pebble: 2 } };

describe('validateDesign: inventions are new things, never new powers', () => {
  it('accepts a sensible design', () => {
    const d = validateDesign(good, ctx(), 'bp-1', 0);
    expect('reason' in d).toBe(false);
    expect((d as Blueprint).status).toBe('pending');
    expect((d as Blueprint).learnedFrom).toBe('Chest (furniture)');
  });

  it('requires having read about it first', () => {
    const d = validateDesign({ ...good, learnedFrom: 'Some Book I Never Read' }, ctx(), 'bp-1', 0);
    expect('reason' in d && d.reason).toMatch(/learn about it first/);
  });

  it('only allows behaviors from the fixed menu', () => {
    for (const behavior of ['flying', 'teleport', 'open_files', undefined]) {
      const d = validateDesign({ ...good, behavior }, ctx(), 'bp-1', 0);
      expect('reason' in d).toBe(true);
    }
  });

  it('recipes only use real resources, within limits', () => {
    const d = validateDesign({ ...good, recipe: { stick: 99, unobtainium: 5, wire: 3, glass: 2, leaf: 2, fluff: 2 } }, ctx(), 'bp-1', 0) as Blueprint;
    expect(Object.keys(d.recipe)).not.toContain('unobtainium');
    expect(d.recipe.stick).toBe(8); // clamped
    expect(Object.keys(d.recipe).length).toBeLessThanOrEqual(4);
    expect(Object.values(d.recipe).reduce((a, b) => a + (b ?? 0), 0)).toBeLessThanOrEqual(16);
    expect('reason' in validateDesign({ ...good, recipe: { gold: 3 } }, ctx(), 'bp-1', 0)).toBe(true);
  });

  it('caps pending designs, names and sizes', () => {
    expect('reason' in validateDesign(good, ctx({ pendingCount: 3 }), 'bp-1', 0)).toBe(true);
    expect('reason' in validateDesign({ ...good, name: 'bed' }, ctx(), 'bp-1', 0)).toBe(true); // duplicate
    const big = validateDesign({ ...good, width: 5000, height: -3, color: 'javascript:alert(1)' }, ctx(), 'bp-1', 0) as Blueprint;
    expect(big.width).toBe(48);
    expect(big.height).toBe(6);
    expect(big.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('the invent instruction is gated by the ability toggle', () => {
    const sim = makeSim();
    sim.knowledge = ['Chest (furniture)'];
    const pctx = sim.programContext();
    expect(validateProgram([{ op: 'invent', ...good }], pctx).ops).toHaveLength(1);
    expect(validateProgram([{ op: 'invent', ...good }], { ...pctx, capabilities: { ...pctx.capabilities, invent: false } }).rejected[0].reason).toMatch(/turned off/);
  });

  it('can only build inventions the owner approved', () => {
    const sim = makeSim();
    sim.pet.inventory.resources = { stick: 20, pebble: 20 };
    const bp = { ...(validateDesign(good, ctx(), 'bp-x', 0) as Blueprint) };
    sim.blueprints = [bp];
    expect(validateProgram([{ op: 'build', kind: 'invention', blueprint: 'bp-x' }], sim.programContext()).rejected[0].reason).toMatch(/approved/);
    bp.status = 'approved';
    expect(validateProgram([{ op: 'build', kind: 'invention', blueprint: 'bp-x' }], sim.programContext()).ops).toHaveLength(1);
  });

  it('parses invent tags, with or without spaces', () => {
    expect(parseTag('[[action:invent:storage-box]]')).toEqual({ type: 'action', action: 'invent', arg: 'storage-box' });
    expect(parseTag('[[action:invent:storage box]]')).toEqual({ type: 'action', action: 'invent', arg: 'storage box' });
  });
});

describe('the invention pipeline', () => {
  it('idea → research on the tablet → design → letter → approval → gather → build', async () => {
    const sim = makeSim();
    // a small world: just the things the pipeline uses
    sim.world.objects = sim.world.objects.filter((o) => ['tablet', 'computer', 'workbench', 'comm_box'].includes(o.kind));
    sim.pet.needs = { energy: 95, fullness: 95, curiosity: 50, boredom: 20, social: 0 };
    const topics: Array<string | undefined> = [];
    sim.articleProvider = async (topic) => (topics.push(topic), CHEST);

    expect(sim.addIdea('storage box', 'owner')).toBe(true);
    expect(sim.addIdea('Storage-Box', 'self')).toBe(false); // already on the list

    // 1. research: Blurb looks it up on the tablet
    expect(await runUntil(sim, () => sim.ideas[0].status === 'researched')).toBe(true);
    expect(topics).toContain('storage box');
    expect(sim.knowledge).toContain('Chest (furniture)');
    expect(sim.ideas[0].learnedTitle).toBe('Chest (furniture)');

    // 2. design at the computer (rule designer, no LLM) → a letter in the comm box
    expect(await runUntil(sim, () => sim.notes.some((n) => n.invention))).toBe(true);
    const note = sim.notes.find((n) => n.invention)!;
    const bp = sim.blueprints.find((b) => b.id === note.invention!.blueprintId)!;
    expect(bp.name).toBe('Storage Box');
    expect(bp.behavior).toBe('storage');
    expect(bp.status).toBe('pending');
    expect(note.text).toMatch(/Chest \(furniture\)/);
    expect(note.text).toMatch(/Can I build it/);
    expect(sim.ideas[0].status).toBe('designed');

    // nothing gets built before approval, even with plenty of resources
    sim.pet.inventory.resources = { stick: 20, pebble: 20 };
    await runUntil(sim, () => false, 200);
    expect(sim.world.objects.some((o) => o.kind === 'invention')).toBe(false);

    // 3. approve, but short on resources: Blurb says what it still needs
    sim.pet.inventory.resources = { stick: 1 };
    expect(sim.decideInvention(note.id, true)).toBe(true);
    expect(bp.status).toBe('approved');
    expect(sim.pet.speech?.text).toMatch(/still need/);
    expect(sim.missingFor(bp)).toEqual({ stick: 3, pebble: 2 });
    expect(sim.decideInvention(note.id, false)).toBe(false); // already decided

    // 4. resources arrive → built at the workbench, into the storage room
    sim.pet.inventory.resources = { stick: 6, pebble: 3 };
    expect(await runUntil(sim, () => sim.world.objects.some((o) => o.kind === 'invention'))).toBe(true);
    const built = sim.world.objects.find((o) => o.kind === 'invention')!;
    expect(built.data?.blueprintId).toBe(bp.id);
    expect(areaAt(built.x + bp.width / 2).id).toBe('storage');
    expect(sim.pet.inventory.resources).toMatchObject({ stick: 2, pebble: 1 });

    // fans can draw it: the blueprint travels with the public state, nothing pending does
    const pub = toPublicState(sim.pet, sim.world, sim.look(), 'view_only', Date.now(), sim.blueprints.map(toPublicBlueprint));
    expect(pub.objects.find((o) => o.id === built.id)?.bp).toBe(bp.id);
    expect(pub.blueprints?.map((b) => b.id)).toEqual([bp.id]);
    expect(JSON.stringify(pub.blueprints)).not.toMatch(/recipe|learnedFrom|description/);
  });

  it('a storage invention lets Blurb carry more', () => {
    const sim = makeSim();
    expect(sim.resourceCap()).toBe(40);
    const bp = { ...(validateDesign(good, ctx(), 'bp-s', 0) as Blueprint), status: 'approved' as const };
    sim.blueprints = [bp];
    setBlueprints([bp]);
    sim.addObject('invention', WORLD.backDoorX + 20, 'pet', { data: { blueprintId: bp.id } });
    expect(sim.resourceCap()).toBe(60);
    (sim as unknown as { addResource(r: string, n: number): void }).addResource('stick', 100);
    expect(sim.pet.inventory.resources.stick).toBe(60);
  });

  it('a closet is a wardrobe: Blurb changes outfits there', async () => {
    const sim = makeSim();
    sim.world.objects = [];
    sim.knowledge = ['Closet'];
    const raw = ruleDesign({ topic: 'closet', learnedTitle: 'Closet' }, sim.rng)[0] as Record<string, unknown>;
    expect(raw.behavior).toBe('wardrobe');
    const bp = { ...(validateDesign(raw, { knowledge: ['Closet'], existingNames: [], pendingCount: 0 }, 'bp-c', 0) as Blueprint), status: 'approved' as const };
    sim.blueprints = [bp];
    setBlueprints([bp]);
    const o = sim.addObject('invention', WORLD.backDoorX + 40, 'pet', { data: { blueprintId: bp.id } })!;
    expect(getBlueprint(bp.id)?.name).toBe('Closet');
    const before = sim.pet.appearance.skinId;
    sim.requestUse(o.id);
    const seen = new Set<string>();
    sim.on((e) => e.type === 'activity' && seen.add(e.activity));
    await runUntil(sim, () => sim.pet.appearance.skinId !== before, 120);
    expect(seen.has('dressing')).toBe(true);
    expect(sim.pet.appearance.skinId).not.toBe(before);
  });

  it('declined designs are never built, and the idea is not retried', async () => {
    const sim = makeSim();
    sim.world.objects = sim.world.objects.filter((o) => ['computer', 'workbench', 'comm_box'].includes(o.kind));
    sim.knowledge = ['Chest (furniture)'];
    sim.ideas = [{ topic: 'storage box', status: 'researched', source: 'self', addedAt: 0, learnedTitle: 'Chest (furniture)' }];
    sim.pet.inventory.resources = { stick: 20, pebble: 20 };
    expect(await runUntil(sim, () => sim.notes.some((n) => n.invention))).toBe(true);
    const note = sim.notes.find((n) => n.invention)!;
    sim.decideInvention(note.id, false);
    expect(sim.blueprints[0].status).toBe('rejected');
    await runUntil(sim, () => false, 300);
    expect(sim.world.objects.some((o) => o.kind === 'invention')).toBe(false);
    expect(sim.blueprints).toHaveLength(1);
  });

  it('uses the LLM design when it is valid, and the rule designer when it is not', async () => {
    for (const [llm, expected] of [
      [[{ op: 'invent', ...good, name: 'Treasure Trunk', base: 'box', details: ['lid', 'stripes'] }], 'Treasure Trunk'],
      [[{ op: 'invent', ...good, name: 'Rocket', behavior: 'flying' }], 'Storage Box'], // not a behavior → rule fallback
    ] as const) {
      const sim = makeSim();
      sim.world.objects = sim.world.objects.filter((o) => ['computer', 'comm_box'].includes(o.kind));
      sim.knowledge = ['Chest (furniture)'];
      sim.ideas = [{ topic: 'storage box', status: 'researched', source: 'owner', addedAt: 0, learnedTitle: 'Chest (furniture)' }];
      let sawDesign = false;
      sim.programProvider = async (pctx) => ((sawDesign = pctx.design?.learnedTitle === 'Chest (furniture)'), llm as unknown as unknown[]);
      expect(await runUntil(sim, () => sim.blueprints.length > 0)).toBe(true);
      expect(sawDesign).toBe(true);
      expect(sim.blueprints[0].name).toBe(expected);
      expect(sim.blueprints[0].behavior).toBe('storage');
    }
  });

  it('owner chat tags add ideas; fan tags never do; the toggle turns it all off', () => {
    const sim = makeSim();
    sim.applyTags([{ type: 'action', action: 'invent', arg: 'reading-nook' }], 'fan');
    expect(sim.ideas).toHaveLength(0);
    sim.applyTags([{ type: 'action', action: 'invent', arg: 'reading-nook' }], 'owner');
    expect(sim.ideas.map((i) => [i.topic, i.source])).toEqual([['reading nook', 'owner']]);
    sim.capabilities.invent = false;
    expect(sim.addIdea('armchair', 'owner')).toBe(false);
    expect(sim.researchIdea()).toBeUndefined();
  });

  it('remembers ideas, designs and what it has read across restarts', () => {
    const sim = makeSim();
    sim.knowledge = ['Chest (furniture)'];
    sim.addIdea('closet', 'owner');
    sim.blueprints = [{ ...(validateDesign(good, ctx(), 'bp-r', 0) as Blueprint), status: 'approved' }];
    const again = new PetSim(structuredClone(sim.snapshot()));
    expect(again.knowledge).toEqual(['Chest (furniture)']);
    expect(again.ideas[0].topic).toBe('closet');
    expect(again.blueprints[0].id).toBe('bp-r');
    expect(getBlueprint('bp-r')?.name).toBe('Storage Box');
  });

  it('never loops: failed research becomes a note, an impossible design is let go', async () => {
    const sim = makeSim();
    sim.world.objects = sim.world.objects.filter((o) => ['tablet', 'comm_box'].includes(o.kind));
    sim.pet.needs = { energy: 95, fullness: 95, curiosity: 50, boredom: 20, social: 0 };
    sim.articleProvider = async () => null; // offline
    sim.addIdea('storage box', 'owner');
    expect(await runUntil(sim, () => sim.notes.some((n) => /couldn't look it up/.test(n.text)), 3000)).toBe(true);
    expect(sim.ideas[0].status).toBe('curious');
    expect(sim.ideas[0].tries).toBeGreaterThanOrEqual(3);

    // a design whose name is taken: tried once, then let go
    const s2 = makeSim();
    s2.world.objects = s2.world.objects.filter((o) => ['computer'].includes(o.kind));
    s2.knowledge = ['Chest (furniture)'];
    s2.blueprints = [{ ...(validateDesign(good, ctx(), 'bp-taken', 0) as Blueprint), status: 'approved' }];
    s2.ideas = [{ topic: 'storage box', status: 'researched', source: 'self', addedAt: 0, learnedTitle: 'Chest (furniture)' }];
    let sessions = 0;
    s2.on((e) => e.type === 'activity' && e.activity === 'coding' && sessions++);
    await runUntil(s2, () => false, 600);
    expect(s2.ideas[0].status).toBe('designed');
    expect(s2.blueprints).toHaveLength(1);
    expect(sessions).toBeLessThanOrEqual(3); // no design loop at the computer
  });
});
