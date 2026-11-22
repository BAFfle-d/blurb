/**
 * Wikipedia for Blurb's tablet: pick an article on a topic and read its
 * summary, so Blurb can learn real facts (and remember them).
 *
 * Search (rest.php) can be rate-limited on busy networks, so there are
 * fallbacks: the topic's own article, then a list of fascinating articles.
 * The article summary endpoint is the one that matters, and it's CDN-cached.
 * Requests carry only the topic. Nothing about the owner is sent.
 */
import { findProfanity, type BookRef } from '@blurb/shared';

/** Reliably interesting, kid-friendly articles for when search is unavailable. */
export const FASCINATING = [
  'Octopus', 'Black hole', 'Platypus', 'Tardigrade', 'Bioluminescence', 'Aurora', 'Saturn', 'Volcano',
  'Honey bee', 'Coral reef', 'Rainbow', 'Lightning', 'Axolotl', 'Mariana Trench', 'Northern cardinal',
  'Sea otter', 'Comet', 'Snowflake', 'Giant panda', 'Hummingbird', 'Moon', 'Glacier', 'Firefly', 'Narwhal',
];

export interface WikiOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  rng?: () => number;
}

const UA = 'Blurb-desktop-pet/0.1';
const ok = (s: string) => findProfanity(s).length === 0;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class WikiSource {
  private f: typeof fetch;
  private timeoutMs: number;
  private rng: () => number;
  private recent: string[] = [];

  constructor(o: WikiOptions = {}) {
    this.f = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.rng = o.rng ?? Math.random;
  }

  private async get(url: string): Promise<unknown> {
    const res = await this.f(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
    return res.json();
  }

  private pick<T>(arr: T[]): T | undefined {
    return arr.length ? arr[Math.floor(this.rng() * arr.length)] : undefined;
  }

  /** One article summary as a BookRef, or null (disambiguation, filtered, or failed). */
  async summary(title: string): Promise<BookRef | null> {
    try {
      const d = (await this.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)) as {
        title?: string;
        type?: string;
        extract?: string;
      };
      if (!d.title || !d.extract || d.type === 'disambiguation' || /may refer to/i.test(d.extract)) return null;
      if (!ok(`${d.title} ${d.extract}`)) return null;
      return { key: `wiki:${d.title}`, title: d.title, author: 'Wikipedia', blurb: d.extract.replace(/\s+/g, ' ').trim().slice(0, 500) };
    } catch {
      return null;
    }
  }

  /** An article about the topic. Never throws; null if Wikipedia is unreachable. */
  async article(topic: string): Promise<BookRef | null> {
    const t = topic.trim().slice(0, 60) || 'animals';
    // 1. search, in relevance order (the main article first), skipping anything read recently
    try {
      const d = (await this.get(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(t)}&limit=10`)) as {
        pages?: Array<{ key?: string; title?: string; description?: string }>;
      };
      const pages = (d.pages ?? []).filter((p) => p.key && !this.recent.includes(p.key) && !/disambiguation/i.test(p.description ?? ''));
      for (const p of pages.slice(0, 3)) {
        const a = await this.summary(p.key!);
        if (a) return this.remember(a);
      }
    } catch {
      /* rate-limited or offline: fall through */
    }
    // 2. the topic's own article
    const direct = await this.summary(cap(t));
    if (direct && !this.recent.includes(direct.title)) return this.remember(direct);
    // 3. something fascinating
    const pool = FASCINATING.filter((x) => !this.recent.includes(x));
    const fallback = await this.summary(this.pick(pool.length ? pool : FASCINATING)!);
    return fallback ? this.remember(fallback) : null;
  }

  private remember(a: BookRef): BookRef {
    this.recent.push(a.title, a.title.replace(/ /g, '_'));
    if (this.recent.length > 40) this.recent.splice(0, this.recent.length - 40);
    return a;
  }
}
