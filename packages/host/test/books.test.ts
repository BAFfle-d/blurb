import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '@blurb/shared';
import { BookSource, CLASSICS, PetHost, type WSLike } from '../src/index.js';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const SEARCH = {
  docs: [
    { key: '/works/OL106091W', title: 'Danny and the Dinosaur', author_name: ['Syd Hoff'], first_sentence: ['One day Danny went to the museum.'], subject: ['Dinosaurs', 'Juvenile fiction'] },
    { key: '/works/OL2W', title: 'Dinosaurs Before Dark', author_name: ['Mary Pope Osborne'] },
    { key: '/works/OL3W', title: 'Danny and the Dinosaur' }, // duplicate title: dropped
    { key: '/works/OL4W', title: 'Some shitty book', author_name: ['Nope'] }, // shown publicly: filtered
  ],
};

describe('BookSource (Open Library)', () => {
  it('fills a shelf from a subject search, de-duplicated and filtered', async () => {
    let url = '';
    let ua = '';
    const src = new BookSource({
      rng: () => 0.1,
      fetchImpl: (async (u: string, init: RequestInit) => {
        url = u;
        ua = (init.headers as Record<string, string>)['user-agent'];
        return json(SEARCH);
      }) as unknown as typeof fetch,
    });
    const fill = await src.fillShelf('dinosaurs');
    expect(fill.source).toBe('openlibrary');
    expect(decodeURIComponent(url)).toContain('subject:"dinosaurs"');
    expect(ua).toBe('Blurb-desktop-pet/0.1'); // nothing about the owner
    expect(fill.books.map((b) => b.title).sort()).toEqual(['Danny and the Dinosaur', 'Dinosaurs Before Dark']);
    expect(fill.books.find((b) => b.author === 'Syd Hoff')?.blurb).toBe('One day Danny went to the museum.');
  });

  it('falls back to public-domain classics when offline, after retrying', async () => {
    let calls = 0;
    const src = new BookSource({
      fetchImpl: (async () => {
        calls++;
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    const fill = await src.fillShelf('space');
    expect(calls).toBe(2);
    expect(fill.source).toBe('classics');
    expect(fill.error).toMatch(/network down/);
    expect(fill.books.every((b) => CLASSICS.some((c) => c.key === b.key))).toBe(true);
  });

  it('fetches a description for books that only have a title', async () => {
    const src = new BookSource({
      fetchImpl: (async () => json({ description: { type: '/type/text', value: 'Jack and Annie find a magic tree house.' } })) as unknown as typeof fetch,
    });
    const b = await src.describe({ key: '/works/OL2W', title: 'Dinosaurs Before Dark' });
    expect(b.blurb).toBe('Jack and Annie find a magic tree house.');
  });
});

describe('PetHost bookshelf', () => {
  it('stocks an empty shelf on first read, and restocks on request with a topic', async () => {
    const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
    const urls: string[] = [];
    const host = await PetHost.load(settings, {
      dataDir: mkdtempSync(path.join(os.tmpdir(), 'blurb-books-')),
      getSecret: async () => undefined,
      createSocket: () => ({}) as WSLike,
      fetchImpl: (async (u: string) => {
        urls.push(decodeURIComponent(u));
        return json(SEARCH);
      }) as unknown as typeof fetch,
    });
    const shelf = host.sim.shelves()[0];
    expect(shelf.data?.books ?? []).toHaveLength(0);
    host.sim.requestUse(shelf.id);
    for (let i = 0; i < 200 && !(shelf.data?.books?.length); i++) {
      host.sim.tick(0.1);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(shelf.data?.books?.length).toBe(2);
    const r = await host.restockShelf(shelf.id, 'robots');
    expect(r.ok).toBe(true);
    expect(urls.at(-1)).toContain('subject:"robots"');
    expect(shelf.data?.books?.every((b) => !b.read)).toBe(true);
    await host.stop();
  });
});
