/**
 * Real books for Blurb's shelf, from Open Library (openlibrary.org).
 *
 * Open Library is a catalog: it gives titles, authors, subjects, first lines
 * and descriptions — not whole books. That's what Blurb "reads" and reacts
 * to. If the network is unavailable, the shelf falls back to a built-in set
 * of public-domain classics, so reading never breaks.
 *
 * Requests carry only the topic. Nothing about the owner is sent.
 */
import { findProfanity, type BookRef } from '@blurb/shared';

export const COZY_TOPICS = [
  'animals', 'space', 'oceans', 'dinosaurs', 'fairy tales', 'gardening', 'cooking',
  'robots', 'weather', 'music', 'friendship', 'mystery', 'birds', 'trees', 'inventions',
];

/** Public-domain classics, used offline or when real books are switched off. */
export const CLASSICS: BookRef[] = [
  { key: 'classic:alice', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll', blurb: 'A curious girl follows a white rabbit down a hole into a world of riddles, tea parties and a very cross queen.' },
  { key: 'classic:wind-willows', title: 'The Wind in the Willows', author: 'Kenneth Grahame', blurb: 'Mole, Rat, Badger and the reckless Mr. Toad share riverbank picnics and wild motorcar adventures.' },
  { key: 'classic:secret-garden', title: 'The Secret Garden', author: 'Frances Hodgson Burnett', blurb: 'A lonely girl finds a locked, forgotten garden and brings it — and herself — back to life.' },
  { key: 'classic:peter-pan', title: 'Peter Pan', author: 'J. M. Barrie', blurb: 'A boy who refuses to grow up whisks the Darling children away to Neverland.' },
  { key: 'classic:oz', title: 'The Wonderful Wizard of Oz', author: 'L. Frank Baum', blurb: 'A cyclone carries Dorothy to Oz, where she follows the yellow brick road with three unlikely friends.' },
  { key: 'classic:jungle-book', title: 'The Jungle Book', author: 'Rudyard Kipling', blurb: 'Mowgli, raised by wolves, learns the law of the jungle from Baloo the bear and Bagheera the panther.' },
  { key: 'classic:velveteen', title: 'The Velveteen Rabbit', author: 'Margery Williams', blurb: 'A stuffed rabbit learns that being loved is what makes a toy real.' },
  { key: 'classic:black-beauty', title: 'Black Beauty', author: 'Anna Sewell', blurb: 'A horse tells the story of his life, his friends, and the kindness and cruelty of the people he meets.' },
  { key: 'classic:heidi', title: 'Heidi', author: 'Johanna Spyri', blurb: 'An orphan girl brings warmth to her gruff grandfather and the mountain village above the clouds.' },
  { key: 'classic:twenty-thousand', title: 'Twenty Thousand Leagues Under the Seas', author: 'Jules Verne', blurb: 'A professor is taken aboard Captain Nemo\'s submarine for a voyage through the wonders of the deep.' },
  { key: 'classic:just-so', title: 'Just So Stories', author: 'Rudyard Kipling', blurb: 'Playful tales of how the leopard got its spots, how the camel got its hump, and more.' },
  { key: 'classic:peter-rabbit', title: 'The Tale of Peter Rabbit', author: 'Beatrix Potter', blurb: 'A mischievous rabbit sneaks into Mr. McGregor\'s garden and barely escapes.' },
];

export interface BookSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  attempts?: number;
  rng?: () => number;
}

export interface ShelfFill {
  books: BookRef[];
  source: 'openlibrary' | 'classics';
  topic: string;
  error?: string;
}

const UA = 'Blurb-desktop-pet/0.1';
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').replace(/\[[^\]]*\]\([^)]*\)/g, '').trim().slice(0, max);
const ok = (s: string) => findProfanity(s).length === 0;

export class BookSource {
  private f: typeof fetch;
  private timeoutMs: number;
  private attempts: number;
  private rng: () => number;

  constructor(o: BookSourceOptions = {}) {
    this.f = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.attempts = o.attempts ?? 2;
    this.rng = o.rng ?? Math.random;
  }

  private async getJson(url: string): Promise<unknown> {
    let last: unknown;
    for (let i = 0; i < this.attempts; i++) {
      try {
        const res = await this.f(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'follow' });
        if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
        return await res.json();
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('Open Library is unreachable');
  }

  pickTopic(topics?: string): string {
    const list = (topics ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const pool = list.length ? list : COZY_TOPICS;
    return pool[Math.floor(this.rng() * pool.length)];
  }

  private sample<T>(arr: T[], n: number): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }

  classics(n = 8): ShelfFill {
    return { books: this.sample(CLASSICS, n), source: 'classics', topic: 'classics' };
  }

  /** Fill a shelf with real books on a topic. Never throws: falls back to classics. */
  async fillShelf(topic: string, n = 8): Promise<ShelfFill> {
    const t = clean(topic, 60) || 'animals';
    const q = encodeURIComponent(`subject:"${t.replace(/"/g, '')}"`);
    const url = `https://openlibrary.org/search.json?q=${q}&fields=key,title,author_name,first_sentence,subject&limit=60&lang=en`;
    try {
      const json = (await this.getJson(url)) as {
        docs?: Array<{ key?: string; title?: string; author_name?: string[]; first_sentence?: string[] | string; subject?: string[] }>;
      };
      const seen = new Set<string>();
      const books: BookRef[] = [];
      for (const d of json.docs ?? []) {
        if (!d.key || !d.title) continue;
        const title = clean(d.title, 100);
        const author = d.author_name?.[0] ? clean(d.author_name[0], 60) : undefined;
        if (!title || seen.has(title.toLowerCase()) || !ok(`${title} ${author ?? ''}`)) continue;
        seen.add(title.toLowerCase());
        const first = Array.isArray(d.first_sentence) ? d.first_sentence[0] : d.first_sentence;
        books.push({
          key: d.key,
          title,
          author,
          blurb: first && ok(first) ? clean(first, 300) : undefined,
          subjects: (d.subject ?? []).slice(0, 5).map((s) => clean(s, 40)),
        });
      }
      if (!books.length) return { ...this.classics(n), topic: t, error: `No books found for "${t}".` };
      return { books: this.sample(books, n), source: 'openlibrary', topic: t };
    } catch (e) {
      return { ...this.classics(n), topic: t, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Fetch a work's description if we only have a title. Never throws. */
  async describe(book: BookRef): Promise<BookRef> {
    if (book.blurb || !book.key.startsWith('/works/')) return book;
    try {
      const json = (await this.getJson(`https://openlibrary.org${book.key}.json`)) as { description?: string | { value?: string } };
      const d = typeof json.description === 'string' ? json.description : json.description?.value;
      if (d && ok(d)) return { ...book, blurb: clean(d, 400) };
    } catch {
      /* offline: read it without a description */
    }
    return book;
  }
}
