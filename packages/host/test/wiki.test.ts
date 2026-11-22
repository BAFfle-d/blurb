import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '@blurb/shared';
import { PetHost, WikiSource, type WSLike } from '../src/index.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const summary = (title: string, extract: string, type = 'standard') => json({ title, extract, type });

describe('WikiSource', () => {
  it('searches the topic and reads an article summary', async () => {
    const urls: string[] = [];
    const w = new WikiSource({
      rng: () => 0,
      fetchImpl: (async (u: string) => {
        urls.push(decodeURIComponent(u));
        if (u.includes('/search/page')) return json({ pages: [{ key: 'Octopus', title: 'Octopus', description: 'Order of molluscs' }] });
        return summary('Octopus', 'An octopus is a soft-bodied, eight-limbed mollusc. It has three hearts.');
      }) as unknown as typeof fetch,
    });
    const a = await w.article('octopus');
    expect(a).toMatchObject({ key: 'wiki:Octopus', title: 'Octopus', author: 'Wikipedia' });
    expect(urls[0]).toContain('search/page?q=octopus');
  });

  it('falls back to the topic article when search is rate-limited, skipping disambiguations', async () => {
    const w = new WikiSource({
      rng: () => 0,
      fetchImpl: (async (u: string) => {
        if (u.includes('/search/page')) return new Response('You are making too many requests', { status: 429 });
        if (u.endsWith('/Space')) return summary('Space', 'Space may refer to:', 'disambiguation');
        return summary('Octopus', 'An octopus is a soft-bodied, eight-limbed mollusc.');
      }) as unknown as typeof fetch,
    });
    const a = await w.article('space');
    expect(a?.title).toBe('Octopus'); // first of the fascinating list (rng 0)
  });

  it('strict research never falls back to a random article', async () => {
    const w = new WikiSource({
      rng: () => 0,
      fetchImpl: (async (u: string) => {
        if (u.includes('/search/page')) return new Response('slow down', { status: 429 });
        if (u.endsWith('/Storage_box')) return new Response('not found', { status: 404 });
        return summary('Octopus', 'An octopus is a soft-bodied, eight-limbed mollusc.');
      }) as unknown as typeof fetch,
    });
    expect(await w.article('storage box', { strict: true })).toBeNull();
    expect((await w.article('storage box'))?.title).toBe('Octopus'); // casual reading may wander
  });

  it('returns null when Wikipedia is unreachable, and filters profanity', async () => {
    const off = new WikiSource({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(await off.article('birds')).toBeNull();
    const rude = new WikiSource({ fetchImpl: (async () => summary('Shit', 'Some article.')) as unknown as typeof fetch });
    expect(await rude.summary('X')).toBeNull();
  });
});

describe('PetHost with an AI brain', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('actually turns pink when the AI says it will (the tag does it)', async () => {
    const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
    settings.llm = { ...settings.llm, provider: 'ollama', model: 'gemma4:12b', baseUrl: 'http://localhost:11434/v1' };
    const enc = new TextEncoder();
    vi.stubGlobal('fetch', async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '[[emotion:excited]] [[action:skin:pink]] Ta-da, pink!' } }] })}\n\ndata: [DONE]\n\n`));
            c.close();
          },
        }),
        { status: 200 },
      ),
    );
    const host = await PetHost.load(settings, {
      dataDir: mkdtempSync(path.join(os.tmpdir(), 'blurb-pink-')),
      getSecret: async () => undefined,
      createSocket: () => ({}) as WSLike,
      fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch,
    });
    host.sim.dropBox.items = [];
    host.ownerSay('can you change to pink?');
    for (let i = 0; i < 50 && host.sim.pet.appearance.skinId !== 'pink'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(host.sim.pet.appearance.skinId).toBe('pink');
    expect(host.ownerLog.at(-1)?.text).toBe('Ta-da, pink!');
    await host.stop();
  });

  it('chat can start an invention: the AI tag, or plain words on the rule brain', async () => {
    const enc = new TextEncoder();
    vi.stubGlobal('fetch', async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '[[emotion:excited]] [[action:invent:storage box]] Ooh, I will read about it first!' } }] })}\n\ndata: [DONE]\n\n`));
            c.close();
          },
        }),
        { status: 200 },
      ),
    );
    const make = async (llm: boolean) => {
      const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
      if (llm) settings.llm = { ...settings.llm, provider: 'ollama', model: 'gemma4:12b', baseUrl: 'http://localhost:11434/v1' };
      else settings.llm = { ...settings.llm, provider: 'rules' };
      const host = await PetHost.load(settings, {
        dataDir: mkdtempSync(path.join(os.tmpdir(), 'blurb-invent-')),
        getSecret: async () => undefined,
        createSocket: () => ({}) as WSLike,
        fetchImpl: (async (u: string) => {
          if (u.includes('/search/page')) return json({ pages: [{ key: 'Chest_(furniture)', title: 'Chest (furniture)', description: 'Box with a lid' }] });
          if (u.includes('/page/summary/Chest')) return summary('Chest (furniture)', 'A chest is a box with a lid, used for storage.');
          throw new Error('offline');
        }) as unknown as typeof fetch,
      });
      host.sim.dropBox.items = [];
      return host;
    };
    const ai = await make(true);
    ai.ownerSay('could you make something to keep your sticks in?');
    for (let i = 0; i < 50 && !ai.sim.ideas.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(ai.sim.ideas.map((i) => [i.topic, i.source])).toEqual([['storage box', 'owner']]);
    // research looks up exactly that topic
    expect((await ai.sim.articleProvider!('storage box'))?.title).toBe('Chest (furniture)');
    await ai.stop();

    const rules = await make(false);
    rules.ownerSay('Can you build me a reading nook please?');
    for (let i = 0; i < 50 && !rules.sim.ideas.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(rules.sim.ideas[0]?.topic).toBe('reading nook');
    expect(rules.ownerLog.at(-1)?.text).toMatch(/read about it/);
    rules.ownerSay('build a ball'); // already a thing: that's the workbench, not an invention
    await new Promise((r) => setTimeout(r, 50));
    expect(rules.sim.ideas).toHaveLength(1);
    await rules.stop();
  });
});
