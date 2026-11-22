import { describe, expect, it } from 'vitest';
import { WORLD, toPublicState } from '@blurb/shared';
import { DesktopSim, PetSim, type DesktopEnv } from '../src/index.js';

/** Deterministic RNG so behavior tests are stable. */
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function run(sim: PetSim, seconds: number, step = 0.1) {
  const t0 = Date.now();
  for (let t = 0; t < seconds; t += step) sim.tick(step, t0 + t * 1000);
}

function makeSim() {
  const sim = new PetSim();
  sim.rng = seeded();
  sim.hourOverride = 14;
  sim.dropBox.items = []; // behavior tests start without the one-time update gift
  return sim;
}

describe('PetSim needs & decisions', () => {
  it('a hungry Blurb walks to the bowl and eats', () => {
    const sim = makeSim();
    sim.pet.needs = { energy: 90, fullness: 5, curiosity: 10, boredom: 10, social: 10 };
    const before = sim.world.objects.find((o) => o.kind === 'food_bowl')!.data!.servings!;
    const seen = new Set<string>();
    sim.on((e) => e.type === 'activity' && seen.add(e.activity));
    run(sim, 30);
    expect(seen.has('eating')).toBe(true);
    expect(sim.world.objects.find((o) => o.kind === 'food_bowl')!.data!.servings).toBeLessThan(before);
    expect(sim.pet.needs.fullness).toBeGreaterThan(20);
  });

  it('a tired Blurb naps and recovers energy', () => {
    const sim = makeSim();
    sim.pet.needs = { energy: 5, fullness: 90, curiosity: 10, boredom: 10, social: 10 };
    run(sim, 20);
    expect(sim.pet.activity).toBe('sleeping');
    run(sim, 90);
    expect(sim.pet.needs.energy).toBeGreaterThan(60);
  });

  it('treats fill the bowl and earn a public thank-you', () => {
    const sim = makeSim();
    const speeches: string[] = [];
    sim.on((e) => e.type === 'speech' && e.speech.visibility === 'public' && speeches.push(e.speech.text));
    const bowl = sim.world.objects.find((o) => o.kind === 'food_bowl')!;
    const before = bowl.data!.servings!;
    sim.giveTreat('cookie', 'Sunny', 'fan');
    expect(bowl.data!.servings).toBe(before + 1);
    expect(speeches.join(' ')).toMatch(/Sunny/);
  });

  it('drag and drop: Blurb falls back to the floor', () => {
    const sim = makeSim();
    sim.dragStart();
    sim.dragMove(200, 120);
    sim.dragMove(200, 60);
    expect(sim.pet.activity).toBe('dragged');
    sim.dragEnd();
    expect(sim.pet.activity).toBe('falling');
    run(sim, 3);
    expect(sim.pet.position.y).toBe(WORLD.floorY);
    expect(sim.pet.activity).not.toBe('falling');
  });
});

describe('BlurbScript execution & approvals', () => {
  it('applies a validated program and refuses the rest', () => {
    const sim = makeSim();
    const r = sim.runProgram([
      { op: 'transform', target: 'tree-1', into: 'bush' },
      { op: 'recolor', target: 'bed-1', color: '#00ff00' },
      { op: 'fly', height: 100 },
    ]);
    expect(r.ops).toHaveLength(2);
    expect(r.rejected).toHaveLength(1);
    expect(sim.world.objects.find((o) => o.id === 'tree-1')!.kind).toBe('bush');
    expect(sim.world.objects.find((o) => o.id === 'bed-1')!.color).toBe('#00ff00');
  });

  it('designed shapes need owner approval before Blurb can wear them', () => {
    const sim = makeSim();
    sim.runProgram([{ op: 'design_shape', name: 'Mochi', spec: { width: 26, height: 20, peak: 'flat', feet: 3, ears: 'nubs', lean: 0, gloss: true } }]);
    expect(sim.outbox).toHaveLength(1);
    expect(sim.dropBox.shapes).toHaveLength(1);
    // Blurb walks to the comm box to deliver it
    run(sim, 30);
    expect(sim.outbox).toHaveLength(0);
    const note = sim.notes.find((n) => n.request)!;
    expect(note.request!.status).toBe('pending');
    expect(sim.world.objects.find((o) => o.kind === 'comm_box')!.data!.unread).toBe(1);
    // trying to wear it before approval is refused
    expect(sim.runProgram([{ op: 'set_shape', shape: note.request!.design.id }]).ops).toHaveLength(0);
    sim.decideShape(note.id, true);
    expect(sim.dropBox.shapes.map((s) => s.name)).toContain('Mochi');
    expect(sim.pet.appearance.shapeId).toBe(note.request!.design.id);
  });

  it('a computer session runs a rule program when no LLM is configured', () => {
    const sim = makeSim();
    sim.pet.needs = { energy: 90, fullness: 90, curiosity: 100, boredom: 100, social: 0 };
    sim.world.objects = sim.world.objects.filter((o) => !['bookshelf', 'ball', 'yarn', 'plushie', 'tree', 'bush', 'resource', 'workbench'].includes(o.kind));
    let programs = 0;
    sim.on((e) => e.type === 'program' && programs++);
    run(sim, 40);
    expect(programs).toBeGreaterThan(0);
  });

  it('fan-context replies cannot trigger privileged actions', () => {
    const sim = makeSim();
    sim.applyTags([{ type: 'action', action: 'code' }, { type: 'action', action: 'goto', arg: 'computer-1' }], 'fan');
    expect(sim.pet.activity).not.toBe('walking');
    sim.applyTags([{ type: 'action', action: 'dance' }], 'fan');
    expect(sim.pet.gesture).toBe('dance');
    sim.applyTags([{ type: 'action', action: 'code' }], 'owner');
    expect(sim.pet.activity).toBe('walking');
    expect(sim.pet.goal?.objectId).toBe('computer-1');
  });
});

describe('DesktopSim', () => {
  const env = (windows: DesktopEnv['windows'] = []): DesktopEnv => ({
    displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    windows,
    cursor: { x: 500, y: 500 },
  });

  it('enters on the taskbar and stays on surfaces (never flies)', () => {
    const sim = makeSim();
    sim.setMode('overlay');
    const d = new DesktopSim(sim);
    const e = env();
    d.enter(e);
    for (let i = 0; i < 600; i++) {
      d.step(0.05, e);
      const p = sim.pet.desktop!.position;
      if (d.mode !== 'fall' && d.mode !== 'dragged') expect(p.y).toBe(1040);
    }
  });

  it('climbs onto a window, rides it, and falls when it closes', () => {
    const sim = makeSim();
    sim.setMode('overlay');
    sim.pet.needs = { energy: 100, fullness: 100, curiosity: 100, boredom: 0, social: 0 };
    sim.capabilities.chase_cursor = false;
    const d = new DesktopSim(sim);
    const win = { id: 'w1', bounds: { x: 600, y: 500, width: 700, height: 400 } };
    let e = env([win]);
    d.enter(e);
    let sat = false;
    for (let i = 0; i < 2000 && !sat; i++) {
      d.step(0.05, e);
      sat = d.mode === 'sit';
    }
    expect(sat).toBe(true);
    expect(sim.pet.desktop!.position.y).toBe(500);
    // window moves → Blurb rides along
    e = env([{ id: 'w1', bounds: { ...win.bounds, y: 450, x: 650 } }]);
    d.step(0.05, e);
    expect(sim.pet.desktop!.position.y).toBe(450);
    // window closes → falls to the taskbar
    e = env([]);
    for (let i = 0; i < 100; i++) d.step(0.05, e);
    expect(sim.pet.desktop!.position.y).toBe(1040);
  });

  it('naps in a corner when exploring is switched off', () => {
    const sim = makeSim();
    sim.setMode('overlay');
    sim.capabilities.desktop_explore = false;
    const d = new DesktopSim(sim);
    const e = env();
    d.enter(e);
    for (let i = 0; i < 400; i++) d.step(0.05, e);
    expect(sim.pet.activity).toBe('desktop_nap');
  });
});

describe('tablet, books, pillow and the new toys', () => {
  const only = (sim: PetSim, kinds: string[]) => {
    sim.world.objects = sim.world.objects.filter((o) => kinds.includes(o.kind));
  };

  it('carries the tablet to a cozy spot, watches a movie, and puts it down', () => {
    const sim = makeSim();
    only(sim, ['tablet', 'rug', 'bed']);
    sim.pet.needs = { energy: 95, fullness: 95, curiosity: 10, boredom: 90, social: 10 };
    const seen = new Set<string>();
    sim.on((e) => e.type === 'activity' && seen.add(e.activity));
    let carriedWhileWalking = false;
    for (let i = 0; i < 300; i++) {
      sim.tick(0.1);
      const t = sim.world.objects.find((o) => o.kind === 'tablet')!;
      if (sim.pet.activity === 'walking' && t.data?.carried) {
        carriedWhileWalking = true;
        expect(Math.abs(t.x + 5 - sim.pet.position.x)).toBeLessThanOrEqual(1);
      }
      if (seen.has('watching') && sim.pet.activity !== 'watching') break;
    }
    expect(carriedWhileWalking).toBe(true);
    expect(seen.has('watching')).toBe(true);
    const tablet = sim.world.objects.find((o) => o.kind === 'tablet')!;
    expect(tablet.data?.carried).toBeFalsy();
    expect(sim.pet.inventory.carrying).toBeUndefined();
    expect(sim.pet.needs.boredom).toBeLessThan(90);
  });

  it('reads real books from the shelf, one after another', () => {
    const sim = makeSim();
    only(sim, ['bookshelf']);
    const shelf = sim.world.objects[0];
    sim.setShelfBooks(shelf.id, [
      { key: '/works/OL1W', title: 'Danny and the Dinosaur', author: 'Syd Hoff' },
      { key: '/works/OL2W', title: 'Frog and Toad', author: 'Arnold Lobel' },
    ]);
    const events: Array<{ phase: string; title: string }> = [];
    sim.on((e) => e.type === 'book' && events.push({ phase: e.phase, title: e.book.title }));
    sim.pet.needs = { energy: 95, fullness: 95, curiosity: 100, boredom: 50, social: 10 };
    let sawBook = false;
    for (let i = 0; i < 800 && events.filter((e) => e.phase === 'finish').length < 2; i++) {
      sim.tick(0.1);
      if (sim.pet.book) sawBook = true;
      sim.pet.needs.curiosity = 100;
    }
    expect(sawBook).toBe(true);
    expect(events.map((e) => `${e.phase}:${e.title}`)).toEqual([
      'start:Danny and the Dinosaur', 'finish:Danny and the Dinosaur', 'start:Frog and Toad', 'finish:Frog and Toad',
    ]);
    expect(shelf.data!.books!.every((b) => b.read)).toBe(true);
  });

  it('asks for books when the shelf was never stocked', () => {
    const sim = makeSim();
    only(sim, ['bookshelf']);
    let empty: { neverStocked: boolean } | undefined;
    sim.on((e) => e.type === 'shelf_empty' && (empty = e));
    sim.requestUse(sim.world.objects[0].id);
    for (let i = 0; i < 200 && !empty; i++) sim.tick(0.1);
    expect(empty?.neverStocked).toBe(true);
  });

  it('never transforms the plushie friend, and tucks it in on its pillow', () => {
    const sim = makeSim();
    const r = sim.runProgram([{ op: 'transform', target: 'plushie-1', into: 'ball' }]);
    expect(r.ops).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/friend/);
    sim.hourOverride = 21; // bedtime: always tuck in
    only(sim, ['plushie', 'pillow']);
    const plushie = sim.world.objects.find((o) => o.kind === 'plushie')!;
    const pillow = sim.world.objects.find((o) => o.kind === 'pillow')!;
    plushie.x = pillow.x + 60;
    sim.pet.needs = { energy: 95, fullness: 95, curiosity: 0, boredom: 100, social: 100 };
    for (let i = 0; i < 400 && Math.abs(pillow.x + 8 - (plushie.x + 6)) > 8; i++) sim.tick(0.1);
    expect(Math.abs(pillow.x + 8 - (plushie.x + 6))).toBeLessThanOrEqual(8);
  });

  it('builds a tablet only with bioplastic, wire and glass', () => {
    const sim = makeSim();
    expect(sim.runProgram([{ op: 'build', kind: 'tablet', x: 100 }]).rejected[0].reason).toMatch(/not enough resources/);
    sim.pet.inventory.resources = { bioplastic: 2, wire: 2, glass: 1 };
    expect(sim.runProgram([{ op: 'build', kind: 'tablet', x: 100 }]).ops).toHaveLength(1);
    expect(sim.world.objects.filter((o) => o.kind === 'tablet')).toHaveLength(2);
    expect(sim.pet.inventory.resources).toMatchObject({ bioplastic: 0, wire: 0, glass: 0 });
  });

  it('existing pets get the new things once, through the drop box', () => {
    const old = new PetSim();
    const snap = old.snapshot();
    // simulate a save from before this update: no tablet, pillow, toys, or gift record
    snap.world.objects = snap.world.objects.filter((o) => !['tablet', 'pillow', 'blocks', 'top', 'duck'].includes(o.kind));
    snap.dropBox.items = [];
    delete snap.gifts;
    const sim = new PetSim(snap);
    const kinds = sim.dropBox.items.map((i) => i.objectKind ?? i.resource).sort();
    expect(kinds).toEqual(['bioplastic', 'blocks', 'duck', 'glass', 'pillow', 'tablet', 'top', 'wire']);
    const again = new PetSim(sim.snapshot());
    expect(again.dropBox.items).toHaveLength(sim.dropBox.items.length); // not delivered twice
  });

  it('shows the book on the public page and marks carried items', () => {
    const sim = makeSim();
    sim.pet.book = { title: 'Frog and Toad', author: 'Arnold Lobel' };
    const t = sim.world.objects.find((o) => o.kind === 'tablet')!;
    t.data = { ...t.data, carried: true };
    const pub = toPublicState(sim.pet, sim.world, sim.look(), 'fan_chat', Date.now());
    expect(pub.pet.book).toEqual({ title: 'Frog and Toad', author: 'Arnold Lobel' });
    expect(pub.objects.find((o) => o.k === 'tablet')!.cr).toBe(1);
  });
});

describe('color changes from chat, and restarts mid-book', () => {
  it('changes to a drop-box skin or any color name, within the rules', () => {
    const sim = makeSim();
    expect(sim.changeColor('pink')).toBe(true);
    expect(sim.pet.appearance.skinId).toBe('pink');
    expect(sim.changeColor('Glacier')).toBe(true);
    expect(sim.pet.appearance.skinId).toBe('blue');
    expect(sim.changeColor('mint')).toBe(true);
    expect(sim.pet.appearance.skinId).toMatch(/^custom-/);
    expect(sim.changeColor('not-a-color')).toBe(false);
    sim.capabilities.change_skin = false;
    expect(sim.changeColor('red')).toBe(false);
    sim.capabilities.recolor_self = false;
    expect(sim.changeColor('coral')).toBe(false);
  });

  it('[[action:skin:pink]] works for the owner, never for fans', () => {
    const sim = makeSim();
    sim.applyTags([{ type: 'action', action: 'skin', arg: 'pink' }], 'fan');
    expect(sim.pet.appearance.skinId).toBe('red');
    sim.applyTags([{ type: 'action', action: 'skin', arg: 'pink' }], 'owner');
    expect(sim.pet.appearance.skinId).toBe('pink');
  });

  it('does not stay "reading" a book after a restart', () => {
    const sim = makeSim();
    sim.pet.book = { title: "Alice's Adventures in Wonderland" };
    sim.pet.activity = 'reading';
    const again = new PetSim(sim.snapshot());
    expect(again.pet.book).toBeUndefined();
    expect(again.pet.activity).toBe('idle');
  });

  it('reads an article on the tablet when an article source is set', async () => {
    const sim = makeSim();
    sim.world.objects = sim.world.objects.filter((o) => ['tablet', 'rug'].includes(o.kind));
    sim.articleProvider = async () => ({ key: 'wiki:Octopus', title: 'Octopus', author: 'Wikipedia', blurb: 'An octopus is a soft-bodied, eight-limbed mollusc.' });
    const events: string[] = [];
    sim.on((e) => e.type === 'book' && events.push(`${e.phase}:${e.book.title}:${e.via}`));
    (sim as unknown as { tabletMode: string }).tabletMode = 'read';
    sim.requestUse(sim.world.objects.find((o) => o.kind === 'tablet')!.id);
    let saw = '';
    for (let i = 0; i < 600 && events.length < 2; i++) {
      sim.tick(0.1);
      await Promise.resolve();
      if (sim.pet.book) saw = sim.pet.book.title;
    }
    expect(saw).toBe('Octopus');
    expect(events).toEqual(['start:Octopus:tablet', 'finish:Octopus:tablet']);
  });
});
