import { parseTagged, type ProviderId } from '@blurb/shared';
import { collect, explainError, LLMError, TEST_TIMEOUT_MS, type GenerateOptions, type LLMMessage, type LLMProvider, type TestResult } from './provider.js';
import { readSSE } from './sse.js';

export interface OpenAICompatOptions {
  id: ProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  vision?: boolean;
  /**
   * Ask the server to skip "thinking" (reasoning_effort: "none"). Local servers
   * like Ollama otherwise stream a thinking model's reasoning in a separate
   * field and leave `content` empty until it is done — or forever, if the
   * reasoning uses up the reply budget. A pet doesn't need chain-of-thought.
   */
  disableThinking?: boolean;
  /** Override the "Test connection" time limit (tests use a tiny one). */
  testTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Removes <think>…</think> spans from a token stream, for servers that inline
 * reasoning in `content`. Tags split across chunks are handled.
 */
export class ThinkStripper {
  private buf = '';
  private inThink = false;
  sawThinking = false;

  push(chunk: string): string {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (!this.inThink) {
        const i = this.buf.indexOf('<think>');
        if (i >= 0) {
          out += this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 7);
          this.inThink = true;
          this.sawThinking = true;
          continue;
        }
        // hold back a possible partial "<think>" at the end
        let keep = 0;
        for (let k = Math.min(6, this.buf.length); k > 0; k--) {
          if ('<think>'.startsWith(this.buf.slice(-k))) {
            keep = k;
            break;
          }
        }
        out += this.buf.slice(0, this.buf.length - keep);
        this.buf = this.buf.slice(this.buf.length - keep);
        return out;
      }
      const j = this.buf.indexOf('</think>');
      if (j >= 0) {
        this.buf = this.buf.slice(j + 8).replace(/^\s+/, '');
        this.inThink = false;
        continue;
      }
      this.buf = this.buf.slice(-7); // could be a partial "</think>"
      return out;
    }
  }

  end(): string {
    const rest = this.inThink ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

export const THINKING_ONLY_MESSAGE =
  'The model spent its whole reply thinking and never answered. Raise "Max reply length" in Settings → Brain, or pick a model without a thinking mode.';

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

function toWire(m: LLMMessage, vision: boolean): { role: string; content: string | Part[] } {
  if (m.image && vision && m.role === 'user') {
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        { type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } },
      ],
    };
  }
  return { role: m.role, content: m.content };
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  private base: string;
  private f: typeof fetch;

  constructor(private o: OpenAICompatOptions) {
    this.id = o.id;
    this.model = o.model;
    this.base = o.baseUrl.replace(/\/+$/, '');
    this.f = o.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...this.o.headers };
    if (this.o.apiKey) h.authorization = `Bearer ${this.o.apiKey}`;
    return h;
  }

  async *stream(opts: GenerateOptions): AsyncIterable<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages.map((m) => toWire(m, !!this.o.vision)),
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 256,
      stream: true,
    };
    if (this.o.disableThinking) body.reasoning_effort = 'none';
    const post = () =>
      this.f(`${this.base}/chat/completions`, { method: 'POST', headers: this.headers(), signal: opts.signal, body: JSON.stringify(body) });
    let res = await post();
    if (!res.ok && res.status === 400 && 'reasoning_effort' in body) {
      // Server doesn't understand the hint (non-thinking model or older server): retry without it.
      delete body.reasoning_effort;
      res = await post();
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new LLMError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    const strip = new ThinkStripper();
    let answered = false;
    let thought = false;
    for await (const ev of readSSE(res.body, opts.signal)) {
      if (ev.data === '[DONE]') break;
      let json: {
        choices?: Array<{ delta?: { content?: string; reasoning?: string; reasoning_content?: string; thinking?: string }; finish_reason?: string }>;
        error?: { message?: string };
      };
      try {
        json = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (json.error) throw new LLMError(json.error.message ?? 'provider error');
      const d = json.choices?.[0]?.delta;
      if (d?.reasoning || d?.reasoning_content || d?.thinking) thought = true;
      if (d?.content) {
        const visible = strip.push(d.content);
        if (visible) {
          answered = true;
          yield visible;
        }
      }
    }
    if (opts.signal?.aborted) throw opts.signal.reason ?? new LLMError('Request cancelled.');
    const tail = strip.end();
    if (tail) {
      answered = true;
      yield tail;
    }
    if (!answered && (thought || strip.sawThinking)) throw new LLMError(THINKING_ONLY_MESSAGE);
  }

  complete(opts: GenerateOptions) {
    return collect(this.stream(opts));
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const res = await this.f(`${this.base}/models`, { headers: this.headers(), signal });
    if (!res.ok) throw new LLMError(`HTTP ${res.status}`, res.status);
    const json = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
    const ids = json.data?.map((m) => m.id) ?? json.models?.map((m) => m.name) ?? [];
    return ids.map((id) => id.replace(/^models\//, '')).sort();
  }

  async test(): Promise<TestResult> {
    const t0 = Date.now();
    const signal = AbortSignal.timeout(this.o.testTimeoutMs ?? TEST_TIMEOUT_MS);
    try {
      if (!this.model) {
        const models = await this.listModels(signal);
        return { ok: true, message: `Connected. ${models.length} models available — pick one.`, latencyMs: Date.now() - t0 };
      }
      const reply = await this.complete({ messages: [{ role: 'user', content: 'Reply with just the word: ready' }], maxTokens: 8, temperature: 0, signal });
      if (!reply.trim()) return { ok: false, message: `Connected to ${this.model}, but it sent back an empty reply.`, latencyMs: Date.now() - t0 };
      return { ok: true, message: `Connected to ${this.model}: "${(parseTagged(reply).text || reply.trim()).slice(0, 40)}"`, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, message: explainError(e, this.base) };
    }
  }

}
