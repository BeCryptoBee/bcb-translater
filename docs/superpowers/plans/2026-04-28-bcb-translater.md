# bcb-translater Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension (`bcb-translater`) that translates and summarizes web text — with structure preservation — using Gemini and Groq, plus a Cloudflare Worker proxy with daily quota for users without their own API key.

**Architecture:** pnpm workspace with two packages: `extension/` (WXT + React 19 + Tailwind v4 + TypeScript strict) and `worker/` (Cloudflare Worker + KV + Wrangler). Content script never calls LLMs directly — all calls go through the background service worker, which decides between own-key direct calls or the Cloudflare Worker proxy. Provider fallback (Gemini → Groq) lives in a shared helper duplicated across both runtimes.

**Tech Stack:** WXT, React 19, TypeScript strict, Tailwind CSS v4, franc-min, Cloudflare Workers + KV, Wrangler, pnpm, Vitest (unit tests), Miniflare (Worker tests).

**Reference:** [`docs/superpowers/specs/2026-04-28-twtr-translater-design.md`](../specs/2026-04-28-twtr-translater-design.md)

---

## Conventions used in this plan

- **TDD-first** for all pure logic (prompts, cache, lang-detect, fallback orchestrator, quota, message contracts, provider HTTP clients with mocked `fetch`).
- **Manual verification** for DOM-bound code (content scripts, X.com integration, in-page popup, toolbar UI). Each manual-verification task includes an explicit "what to look for" checklist.
- **Commit per task**, not per step. Steps are bite-sized actions inside one task; the `Commit` step at the end of each task creates one logical commit.
- **All paths relative** to the repo root: `c:/Users/Administrator/Desktop/Custom/Antigravity/9_Twtr_translater/`.
- **Commit message format:** Conventional Commits (`feat:`, `chore:`, `test:`, `fix:`, `refactor:`). Each commit ends with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

## File structure (target)

```
bcb-translater/
├── package.json                      ← pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .editorconfig
├── .prettierrc
├── .eslintrc.cjs
├── extension/
│   ├── package.json
│   ├── tsconfig.json
│   ├── wxt.config.ts
│   ├── vitest.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.cjs
│   ├── public/
│   │   └── icons/                    ← 16/32/48/128 px placeholders
│   ├── entrypoints/
│   │   ├── background.ts             ← service worker
│   │   ├── content.ts                ← content script entry
│   │   ├── popup/
│   │   │   ├── index.html
│   │   │   └── main.tsx
│   │   └── options/
│   │       ├── index.html
│   │       └── main.tsx
│   ├── components/
│   │   ├── ActionPopup.tsx
│   │   ├── FloatingButton.tsx
│   │   ├── TweetButton.tsx
│   │   └── ResultView.tsx
│   ├── lib/
│   │   ├── messages.ts               ← typed content↔background contracts
│   │   ├── prompts.ts                ← shared with worker
│   │   ├── lang-detect.ts            ← franc-min wrapper
│   │   ├── cache.ts                  ← LRU + chrome.storage.local
│   │   ├── storage.ts                ← settings storage
│   │   ├── llm-fallback.ts           ← Gemini → Groq orchestrator
│   │   ├── quota.ts                  ← local daily counter
│   │   ├── install-id.ts             ← installId getter/setter
│   │   ├── providers/
│   │   │   ├── gemini.ts
│   │   │   ├── groq.ts
│   │   │   ├── proxy.ts              ← own client for hitting our Worker
│   │   │   └── types.ts              ← Provider interface
│   │   ├── twitter/
│   │   │   ├── selectors.ts
│   │   │   └── injector.ts
│   │   └── shadow-host.ts            ← Shadow DOM mount helper
│   ├── styles/
│   │   ├── tailwind.css
│   │   └── shadow.css                ← scoped styles for Shadow DOM
│   └── tests/
│       ├── prompts.test.ts
│       ├── cache.test.ts
│       ├── lang-detect.test.ts
│       ├── messages.test.ts
│       ├── llm-fallback.test.ts
│       ├── quota.test.ts
│       ├── providers.gemini.test.ts
│       └── providers.groq.test.ts
└── worker/
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.toml
    ├── vitest.config.ts
    ├── src/
    │   ├── index.ts                  ← fetch handler
    │   ├── quota.ts                  ← KV-based daily rate limiting
    │   ├── prompts.ts                ← copy of extension/lib/prompts.ts
    │   ├── llm-fallback.ts           ← copy with platform fetch
    │   ├── providers/
    │   │   ├── gemini.ts
    │   │   ├── groq.ts
    │   │   └── types.ts
    │   └── errors.ts
    └── tests/
        ├── quota.test.ts
        ├── handler.test.ts
        └── providers.test.ts
```

**Why this layout:** each file has one responsibility and stays small (target <200 lines). Pure logic (lib/) is separated from entry points (entrypoints/) and UI components (components/). The duplication between `extension/lib/prompts.ts` and `worker/src/prompts.ts` is intentional and minimal — both files contain only string templates and a tiny render function. We document the duplication in the spec; a build-time copy script could eliminate it later but is YAGNI for MVP.

---

## Phase 0 — Bootstrap

### Task 0.1: pnpm workspace skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`
- Create: `.prettierrc`
- Create: `.eslintrc.cjs`

- [ ] **Step 1: Create root `package.json` with workspace metadata**

```json
{
  "name": "bcb-translater",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react": "^7.35.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "prettier": "^3.3.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - extension
  - worker
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

- [ ] **Step 4: Create `.editorconfig`, `.prettierrc`, `.eslintrc.cjs`** with sensible defaults (2-space indent, single quotes, semicolons, LF endings, react/typescript-eslint recommended rules).

- [ ] **Step 5: Run `pnpm install` and verify exit code 0**

```bash
pnpm install
echo "Exit: $?"
```

Expected: `Exit: 0`, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .editorconfig .prettierrc .eslintrc.cjs pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm workspace with shared TS/lint config"
```

---

### Task 0.2: Initialize WXT extension scaffold

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/wxt.config.ts`
- Create: `extension/entrypoints/background.ts`
- Create: `extension/entrypoints/content.ts`
- Create: `extension/entrypoints/popup/index.html`
- Create: `extension/entrypoints/popup/main.tsx`
- Create: `extension/entrypoints/options/index.html`
- Create: `extension/entrypoints/options/main.tsx`
- Create: `extension/public/icons/{16,32,48,128}.png` (placeholder solid-color PNGs)
- Create: `extension/styles/tailwind.css`
- Create: `extension/tailwind.config.ts`
- Create: `extension/postcss.config.cjs`

- [ ] **Step 1: Create `extension/package.json` with dependencies**

```json
{
  "name": "@bcb/extension",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "franc-min": "^6.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.270",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@wxt-dev/module-react": "^1.1.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.40",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "happy-dom": "^15.0.0",
    "wxt": "^0.19.0"
  }
}
```

- [ ] **Step 2: Create `extension/tsconfig.json` extending the base**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "types": ["chrome", "vite/client"],
    "paths": { "~/*": ["./*"] }
  },
  "include": ["entrypoints", "components", "lib", "tests"]
}
```

- [ ] **Step 3: Create `extension/wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'bcb-translater',
    description: 'Fast LLM translation and summarization with structure preservation',
    permissions: ['storage', 'contextMenus', 'activeTab'],
    host_permissions: ['<all_urls>'],
    commands: {
      'translate-selection': {
        suggested_key: { default: 'Alt+T' },
        description: 'Translate selected text'
      },
      'summarize-selection': {
        suggested_key: { default: 'Alt+S' },
        description: 'Summarize selected text'
      }
    },
    action: { default_popup: 'popup.html', default_title: 'bcb-translater' }
  }
});
```

- [ ] **Step 4: Create stub entrypoints**

`extension/entrypoints/background.ts`:
```ts
export default defineBackground(() => {
  console.log('[bcb] background ready');
});
```

`extension/entrypoints/content.ts`:
```ts
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    console.log('[bcb] content script loaded');
  }
});
```

Popup and options HTML+main.tsx render a simple `<div>bcb-translater</div>` for now. We'll fill these in later phases.

- [ ] **Step 5: Generate placeholder PNG icons**

Use a one-shot script (e.g. node + sharp) or create solid-color squares manually. Sizes: 16, 32, 48, 128.

- [ ] **Step 6: Configure Tailwind v4**

`extension/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./entrypoints/**/*.{html,tsx}', './components/**/*.tsx'],
  darkMode: 'class'
} satisfies Config;
```

`extension/postcss.config.cjs`:
```js
module.exports = { plugins: { '@tailwindcss/postcss': {} } };
```

`extension/styles/tailwind.css`:
```css
@import "tailwindcss";
```

- [ ] **Step 7: Run dev mode, verify Chrome loads extension**

```bash
cd extension && pnpm dev
```

Expected: WXT prints `Built extension in <ms>` and opens Chrome with the unpacked extension loaded. In `chrome://extensions` the extension `bcb-translater` is enabled. Console of any page shows `[bcb] content script loaded`. Service-worker console shows `[bcb] background ready`.

- [ ] **Step 8: Commit**

```bash
git add extension/
git commit -m "feat(extension): scaffold WXT + React 19 + Tailwind v4 with stub entrypoints"
```

---

### Task 0.3: Initialize Cloudflare Worker scaffold

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "@bcb/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240924.0",
    "miniflare": "^3.20240925.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Create `worker/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022", "WebWorker"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `worker/wrangler.toml`**

```toml
name = "bcb-translater"
main = "src/index.ts"
compatibility_date = "2026-04-28"

[[kv_namespaces]]
binding = "QUOTA_KV"
id = "TBD_AT_DEPLOY_TIME"

# Secrets (set via `wrangler secret put`):
# - GEMINI_API_KEY
# - GROQ_API_KEY
```

- [ ] **Step 4: Create stub `worker/src/index.ts`**

```ts
export interface Env {
  QUOTA_KV: KVNamespace;
  GEMINI_API_KEY: string;
  GROQ_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/process') {
      return new Response('Not found', { status: 404 });
    }
    return new Response(JSON.stringify({ error: 'not_implemented' }), {
      status: 501,
      headers: { 'content-type': 'application/json' }
    });
  }
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Run `wrangler dev` locally and verify endpoint responds**

```bash
cd worker && pnpm dev
# in another shell:
curl -X POST http://localhost:8787/v1/process
```

Expected: HTTP 501 with JSON `{"error":"not_implemented"}`.

- [ ] **Step 6: Commit**

```bash
git add worker/
git commit -m "feat(worker): scaffold Cloudflare Worker with /v1/process stub"
```

---

## Phase 1 — Core domain (pure logic, TDD)

### Task 1.1: Message contracts (`extension/lib/messages.ts`)

**Files:**
- Create: `extension/lib/messages.ts`
- Create: `extension/tests/messages.test.ts`

- [ ] **Step 1: Write failing test for message type guards**

```ts
import { describe, it, expect } from 'vitest';
import { isProcessRequest, isProcessResponse } from '~/lib/messages';

describe('messages', () => {
  it('accepts valid translate request', () => {
    expect(isProcessRequest({
      type: 'process',
      mode: 'translate',
      text: 'hello',
      targetLang: 'uk'
    })).toBe(true);
  });

  it('rejects missing mode', () => {
    expect(isProcessRequest({ type: 'process', text: 'hi', targetLang: 'uk' })).toBe(false);
  });

  it('accepts valid response', () => {
    expect(isProcessResponse({ ok: true, result: 'привіт', provider: 'gemini' })).toBe(true);
  });

  it('accepts error response', () => {
    expect(isProcessResponse({ ok: false, code: 'quota_exhausted', message: '...' })).toBe(true);
  });
});
```

- [ ] **Step 2: Verify the test fails**

```bash
cd extension && pnpm test messages
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `messages.ts`**

```ts
export type Mode = 'translate' | 'summarize';

export interface ProcessRequest {
  type: 'process';
  mode: Mode;
  text: string;
  sourceLang?: string;
  targetLang: string;
}

export type ProcessResponse =
  | { ok: true; result: string; provider: 'gemini' | 'groq'; remainingQuota?: number; cached?: boolean }
  | { ok: false; code: ErrorCode; message: string };

export type ErrorCode =
  | 'quota_exhausted'
  | 'network_error'
  | 'provider_error'
  | 'invalid_input'
  | 'too_long'
  | 'unknown';

export function isProcessRequest(x: unknown): x is ProcessRequest {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.type === 'process'
    && (o.mode === 'translate' || o.mode === 'summarize')
    && typeof o.text === 'string'
    && typeof o.targetLang === 'string';
}

export function isProcessResponse(x: unknown): x is ProcessResponse {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.ok === true) return typeof o.result === 'string' && (o.provider === 'gemini' || o.provider === 'groq');
  if (o.ok === false) return typeof o.code === 'string' && typeof o.message === 'string';
  return false;
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd extension && pnpm test messages
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/messages.ts extension/tests/messages.test.ts
git commit -m "feat(extension): add typed message contracts with runtime guards"
```

---

### Task 1.2: Prompts module

**Files:**
- Create: `extension/lib/prompts.ts`
- Create: `extension/tests/prompts.test.ts`
- Create: `worker/src/prompts.ts` (intentional copy)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildTranslatePrompt, buildSummarizePrompt } from '~/lib/prompts';

describe('prompts', () => {
  it('translate prompt embeds target language', () => {
    const p = buildTranslatePrompt({ text: 'hello', targetLang: 'Ukrainian' });
    expect(p).toContain('Translate the text below to Ukrainian');
  });

  it('translate prompt wraps user text in delimiters', () => {
    const p = buildTranslatePrompt({ text: 'sneaky\nbreak', targetLang: 'Ukrainian' });
    expect(p).toContain('<<<TEXT\nsneaky\nbreak\nTEXT>>>');
  });

  it('summary prompt embeds target language', () => {
    const p = buildSummarizePrompt({ text: 'hello', targetLang: 'Ukrainian' });
    expect(p).toContain('Summarize the text below in Ukrainian');
  });

  it('does not interpolate dollar signs in user text', () => {
    const p = buildTranslatePrompt({ text: '$BTC', targetLang: 'Ukrainian' });
    expect(p).toContain('$BTC');
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
cd extension && pnpm test prompts
```

Expected: FAIL.

- [ ] **Step 3: Implement `extension/lib/prompts.ts`**

```ts
export interface PromptInput {
  text: string;
  targetLang: string;
}

export function buildTranslatePrompt({ text, targetLang }: PromptInput): string {
  return `You are a precise, idiomatic translator. Translate the text below to ${targetLang}.

HARD RULES:
1. Preserve ALL line breaks, paragraph breaks, indentation, bullet points, lists exactly as in source.
2. Do NOT translate: @mentions, #hashtags, URLs, $TICKERS, code in \`backticks\`, emoji.
3. Translate meaning naturally, not word-by-word. Match the register (casual / technical / formal).
4. Output ONLY the translation. No prefixes, explanations, or quotation marks around the result.

Source text (between markers):
<<<TEXT
${text}
TEXT>>>`;
}

export function buildSummarizePrompt({ text, targetLang }: PromptInput): string {
  return `You are a concise summarizer. Summarize the text below in ${targetLang}.

HARD RULES:
1. 2-3 sentences for input under 500 chars; 4-6 sentences for longer input.
2. Preserve key facts: numbers, names, $TICKERS, dates, percentages.
3. Output in ${targetLang}, idiomatic and natural.
4. Output ONLY the summary. No prefixes, explanations, or quotation marks.

Source text (between markers):
<<<TEXT
${text}
TEXT>>>`;
}

export const TEMPERATURES = { translate: 0.3, summarize: 0.5 } as const;
```

- [ ] **Step 4: Verify pass, then mirror to worker**

`worker/src/prompts.ts` is a byte-for-byte copy of `extension/lib/prompts.ts`. Add a header comment to both:
```ts
// MIRRORED FILE: keep extension/lib/prompts.ts and worker/src/prompts.ts in sync.
```

- [ ] **Step 5: Commit**

```bash
git add extension/lib/prompts.ts extension/tests/prompts.test.ts worker/src/prompts.ts
git commit -m "feat: add translate and summarize prompts with structure-preservation rules"
```

---

### Task 1.3: Language detection (`extension/lib/lang-detect.ts`)

**Files:**
- Create: `extension/lib/lang-detect.ts`
- Create: `extension/tests/lang-detect.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectLanguage } from '~/lib/lang-detect';

describe('detectLanguage', () => {
  it('detects english', () => {
    expect(detectLanguage('Hello there, this is a sentence in English.')).toBe('en');
  });

  it('detects ukrainian', () => {
    expect(detectLanguage('Привіт, як справи сьогодні? Це український текст.')).toBe('uk');
  });

  it('returns "und" for very short input', () => {
    expect(detectLanguage('hi')).toBe('und');
  });
});
```

- [ ] **Step 2: Verify failure, then implement**

```ts
import { franc } from 'franc-min';

const ISO6393_TO_ISO6391: Record<string, string> = {
  eng: 'en', ukr: 'uk', rus: 'ru', pol: 'pl', deu: 'de',
  spa: 'es', fra: 'fr', cmn: 'zh', jpn: 'ja', por: 'pt',
  ita: 'it', tur: 'tr', nld: 'nl', ara: 'ar'
};

export function detectLanguage(text: string): string {
  if (text.trim().length < 10) return 'und';
  const code3 = franc(text);
  if (code3 === 'und') return 'und';
  return ISO6393_TO_ISO6391[code3] ?? 'und';
}
```

- [ ] **Step 3: Run test, commit**

```bash
git add extension/lib/lang-detect.ts extension/tests/lang-detect.test.ts
git commit -m "feat(extension): add franc-min wrapper for client-side language detection"
```

---

### Task 1.4: Cache module (`extension/lib/cache.ts`)

**Files:**
- Create: `extension/lib/cache.ts`
- Create: `extension/tests/cache.test.ts`

- [ ] **Step 1: Write failing tests covering hash, set/get, TTL, LRU eviction**

Tests use a fake `chrome.storage.local` adapter passed in via dependency injection. Cover:
- `getCacheKey({mode, text, targetLang})` returns stable hex hash
- `setEntry` then `getEntry` round-trips
- Entry older than 7 days returns `undefined`
- When cache exceeds size cap, oldest entries are evicted

- [ ] **Step 2: Implement**

```ts
export interface CacheEntry { value: string; ts: number; bytes: number; }
export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB cap (under 5 MB chrome.storage.local quota)
const INDEX_KEY = '__cache_index__';

export async function getCacheKey(input: { mode: string; text: string; targetLang: string }): Promise<string> {
  const data = new TextEncoder().encode(`${input.mode}|${input.targetLang}|${input.text}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getEntry(key: string, store: StorageAdapter): Promise<string | undefined> {
  const got = await store.get([key]);
  const entry = got[key] as CacheEntry | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.ts > TTL_MS) {
    await store.remove([key]);
    return undefined;
  }
  return entry.value;
}

export async function setEntry(key: string, value: string, store: StorageAdapter): Promise<void> {
  const bytes = new Blob([value]).size;
  const entry: CacheEntry = { value, ts: Date.now(), bytes };
  const idx = ((await store.get([INDEX_KEY]))[INDEX_KEY] as Record<string, number> | undefined) ?? {};
  idx[key] = entry.ts;
  await evictIfNeeded(idx, store);
  await store.set({ [key]: entry, [INDEX_KEY]: idx });
}

async function evictIfNeeded(idx: Record<string, number>, store: StorageAdapter): Promise<void> {
  const keys = Object.keys(idx);
  if (keys.length === 0) return;
  const entries = await store.get(keys);
  let total = 0;
  for (const k of keys) {
    const e = entries[k] as CacheEntry | undefined;
    if (e) total += e.bytes;
  }
  if (total <= MAX_BYTES) return;
  // Evict oldest first until under cap
  const sorted = keys.sort((a, b) => idx[a]! - idx[b]!);
  for (const k of sorted) {
    if (total <= MAX_BYTES) break;
    const e = entries[k] as CacheEntry | undefined;
    if (e) total -= e.bytes;
    delete idx[k];
    await store.remove([k]);
  }
}
```

- [ ] **Step 3: Verify all cache tests pass, commit**

```bash
git commit -m "feat(extension): add LRU translation cache with 7-day TTL and 4MB cap"
```

---

### Task 1.5: Settings storage wrapper (`extension/lib/storage.ts`)

**Files:**
- Create: `extension/lib/storage.ts`
- Create: `extension/lib/install-id.ts`

- [ ] **Step 1: Implement settings schema with defaults**

```ts
export interface Settings {
  targetLang: string;       // default 'uk'
  provider: 'auto' | 'gemini' | 'groq';
  userApiKey: string;       // empty = use proxy
  showInlineOnTweets: boolean;
  theme: 'light' | 'dark';
}

const DEFAULTS: Settings = {
  targetLang: 'uk',
  provider: 'auto',
  userApiKey: '',
  showInlineOnTweets: true,
  theme: 'light'
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChange(cb: (next: Settings) => void): () => void {
  const handler = async (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;
    const next = await getSettings();
    cb(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
```

- [ ] **Step 2: Implement `install-id.ts`**

```ts
const KEY = 'install_id';
export async function getInstallId(): Promise<string> {
  const got = await chrome.storage.local.get([KEY]);
  if (typeof got[KEY] === 'string') return got[KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [KEY]: id });
  return id;
}
```

- [ ] **Step 3: No unit test — these are direct chrome.storage wrappers verified at integration time. Commit.**

```bash
git commit -m "feat(extension): add settings storage wrapper and installId getter"
```

---

## Phase 2 — LLM clients (TDD with mocked fetch)

### Task 2.1: Provider interface and Gemini client

**Files:**
- Create: `extension/lib/providers/types.ts`
- Create: `extension/lib/providers/gemini.ts`
- Create: `extension/tests/providers.gemini.test.ts`

- [ ] **Step 1: Define `Provider` interface**

```ts
// providers/types.ts
export type ProviderName = 'gemini' | 'groq';

export interface ProviderInput {
  prompt: string;
  temperature: number;
  apiKey: string;
}

export interface ProviderResult {
  text: string;
}

export type ProviderError =
  | { kind: 'rate_limit' }
  | { kind: 'auth' }
  | { kind: 'network' }
  | { kind: 'malformed' }
  | { kind: 'server'; status: number };

export interface Provider {
  name: ProviderName;
  call(input: ProviderInput, fetchImpl?: typeof fetch): Promise<ProviderResult>;
}
```

- [ ] **Step 2: Write failing tests for Gemini**

Tests with mocked `fetch`:
- happy path returns extracted text
- 429 throws `{kind:'rate_limit'}`
- 401 throws `{kind:'auth'}`
- malformed JSON throws `{kind:'malformed'}`
- network failure throws `{kind:'network'}`

- [ ] **Step 3: Implement Gemini client (REST API, gemini-2.0-flash model)**

```ts
import type { Provider, ProviderInput, ProviderResult } from './types';

const URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

export const gemini: Provider = {
  name: 'gemini',
  async call(input: ProviderInput, fetchImpl: typeof fetch = fetch): Promise<ProviderResult> {
    let res: Response;
    try {
      res = await fetchImpl(URL('gemini-2.0-flash', input.apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
          generationConfig: { temperature: input.temperature, responseMimeType: 'text/plain' }
        })
      });
    } catch {
      throw { kind: 'network' };
    }
    if (res.status === 429) throw { kind: 'rate_limit' };
    if (res.status === 401 || res.status === 403) throw { kind: 'auth' };
    if (res.status >= 500) throw { kind: 'server', status: res.status };
    let json: unknown;
    try { json = await res.json(); } catch { throw { kind: 'malformed' }; }
    const text = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw { kind: 'malformed' };
    return { text };
  }
};
```

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat(extension): add Gemini provider with mocked-fetch tests"
```

---

### Task 2.2: Groq client

**Files:**
- Create: `extension/lib/providers/groq.ts`
- Create: `extension/tests/providers.groq.test.ts`

- [ ] **Step 1: Write failing tests (mirror gemini test structure)**

- [ ] **Step 2: Implement Groq (OpenAI-compatible chat completions endpoint)**

```ts
import type { Provider, ProviderInput, ProviderResult } from './types';

export const groq: Provider = {
  name: 'groq',
  async call(input: ProviderInput, fetchImpl: typeof fetch = fetch): Promise<ProviderResult> {
    let res: Response;
    try {
      res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${input.apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: input.prompt }],
          temperature: input.temperature
        })
      });
    } catch { throw { kind: 'network' }; }
    if (res.status === 429) throw { kind: 'rate_limit' };
    if (res.status === 401 || res.status === 403) throw { kind: 'auth' };
    if (res.status >= 500) throw { kind: 'server', status: res.status };
    let json: unknown;
    try { json = await res.json(); } catch { throw { kind: 'malformed' }; }
    const text = (json as any)?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw { kind: 'malformed' };
    return { text };
  }
};
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(extension): add Groq provider with mocked-fetch tests"
```

---

### Task 2.3: Fallback orchestrator (`extension/lib/llm-fallback.ts`)

**Files:**
- Create: `extension/lib/llm-fallback.ts`
- Create: `extension/tests/llm-fallback.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- Primary success → returns primary result, doesn't call fallback
- Primary `rate_limit` → calls fallback, returns fallback result
- Primary `network` → calls fallback
- Both fail → throws `provider_error`
- Provider preference 'gemini' → tries gemini first
- Provider preference 'groq' → tries groq first
- Provider preference 'auto' → defaults to gemini first

- [ ] **Step 2: Implement**

```ts
import { gemini } from './providers/gemini';
import { groq } from './providers/groq';
import type { Provider, ProviderInput, ProviderName } from './providers/types';

export async function callWithFallback(
  preference: 'auto' | ProviderName,
  input: ProviderInput,
  fetchImpl?: typeof fetch
): Promise<{ text: string; provider: ProviderName }> {
  const order: Provider[] =
    preference === 'groq' ? [groq, gemini] : [gemini, groq];
  let lastErr: unknown;
  for (const p of order) {
    try {
      const r = await p.call(input, fetchImpl);
      return { text: r.text, provider: p.name };
    } catch (e: any) {
      lastErr = e;
      // For auth and malformed errors specific to a provider, still try the next one.
      // For everything else (rate_limit, network, server), continue.
      if (e?.kind === 'auth' && p === order[order.length - 1]) break;
    }
  }
  throw lastErr ?? { kind: 'unknown' };
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(extension): add LLM fallback orchestrator (Gemini → Groq)"
```

---

### Task 2.4: Proxy client (`extension/lib/providers/proxy.ts`)

**Files:**
- Create: `extension/lib/providers/proxy.ts`
- Create: `extension/tests/providers.proxy.test.ts`

- [ ] **Step 1: Implement client that POSTs to our Worker**

```ts
import type { Mode } from '../messages';

export interface ProxyInput {
  mode: Mode;
  text: string;
  targetLang: string;
  installId: string;
}

export interface ProxyResult {
  text: string;
  provider: 'gemini' | 'groq';
  remainingQuota: number;
}

const PROXY_URL = 'https://twtr-tr.<TBD>.workers.dev/v1/process'; // replaced at deploy

export async function callProxy(input: ProxyInput, fetchImpl: typeof fetch = fetch): Promise<ProxyResult> {
  let res: Response;
  try {
    res = await fetchImpl(PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-install-id': input.installId },
      body: JSON.stringify({ mode: input.mode, text: input.text, targetLang: input.targetLang })
    });
  } catch { throw { kind: 'network' }; }
  if (res.status === 429) throw { kind: 'rate_limit' }; // quota exhausted
  if (!res.ok) throw { kind: 'server', status: res.status };
  let json: any;
  try { json = await res.json(); } catch { throw { kind: 'malformed' }; }
  if (typeof json?.result !== 'string') throw { kind: 'malformed' };
  return { text: json.result, provider: json.provider, remainingQuota: json.remainingQuota };
}
```

The placeholder `<TBD>` is replaced at deploy time (Phase 7) and persisted via a build-time env var.

- [ ] **Step 2: Test with mocked fetch, commit**

```bash
git commit -m "feat(extension): add proxy client for Cloudflare Worker"
```

---

## Phase 3 — Background service worker

### Task 3.1: Background message dispatcher

**Files:**
- Modify: `extension/entrypoints/background.ts`
- Create: `extension/lib/background-handler.ts`
- Create: `extension/tests/background-handler.test.ts`

- [ ] **Step 1: Write failing test for the handler (testable in isolation; not the WXT entrypoint)**

```ts
// background-handler.test.ts
// Asserts that handleProcess() calls cache, then routes to own-key vs proxy correctly,
// counts quota, and returns ProcessResponse shapes.
```

- [ ] **Step 2: Implement `extension/lib/background-handler.ts`**

```ts
import { isProcessRequest, type ProcessRequest, type ProcessResponse } from './messages';
import { getSettings } from './storage';
import { getInstallId } from './install-id';
import { getEntry, setEntry, getCacheKey, type StorageAdapter } from './cache';
import { buildTranslatePrompt, buildSummarizePrompt, TEMPERATURES } from './prompts';
import { callWithFallback } from './llm-fallback';
import { callProxy } from './providers/proxy';
import { incrementLocalQuota, getLocalQuota } from './quota';

const MAX_LEN = 10_000;

export async function handleProcess(req: ProcessRequest, store: StorageAdapter): Promise<ProcessResponse> {
  if (!req.text.trim()) return { ok: false, code: 'invalid_input', message: 'Empty text' };
  if (req.text.length > MAX_LEN) return { ok: false, code: 'too_long', message: 'Text too long (>10 KB) — please shorten' };

  const settings = await getSettings();
  const targetLang = req.targetLang || settings.targetLang;
  const cacheKey = await getCacheKey({ mode: req.mode, text: req.text, targetLang });
  const cached = await getEntry(cacheKey, store);
  if (cached) {
    return { ok: true, result: cached, provider: 'gemini', cached: true };
  }

  const prompt = req.mode === 'translate'
    ? buildTranslatePrompt({ text: req.text, targetLang })
    : buildSummarizePrompt({ text: req.text, targetLang });
  const temperature = TEMPERATURES[req.mode];

  try {
    let result: string;
    let provider: 'gemini' | 'groq';
    let remainingQuota: number | undefined;

    if (settings.userApiKey) {
      const r = await callWithFallback(settings.provider, { prompt, temperature, apiKey: settings.userApiKey });
      result = r.text;
      provider = r.provider;
    } else {
      const installId = await getInstallId();
      const r = await callProxy({ mode: req.mode, text: req.text, targetLang, installId });
      result = r.text;
      provider = r.provider;
      remainingQuota = r.remainingQuota;
      await incrementLocalQuota();
    }

    // Structure-preservation safeguard for translation only (one retry max)
    if (req.mode === 'translate') {
      const srcN = (req.text.match(/\n/g) ?? []).length;
      const dstN = (result.match(/\n/g) ?? []).length;
      if (srcN >= 2 && dstN < srcN / 2) {
        const reinforced = prompt + '\n\nREMINDER: The source has line breaks. The output MUST contain the same number of line breaks in the same positions.';
        try {
          if (settings.userApiKey) {
            const r2 = await callWithFallback(settings.provider, { prompt: reinforced, temperature, apiKey: settings.userApiKey });
            result = r2.text; provider = r2.provider;
          } else {
            const installId2 = await getInstallId();
            const r2 = await callProxy({ mode: 'translate', text: req.text, targetLang, installId: installId2 });
            result = r2.text; provider = r2.provider; remainingQuota = r2.remainingQuota;
          }
        } catch { /* keep original result if retry fails */ }
      }
    }

    await setEntry(cacheKey, result, store);
    return { ok: true, result, provider, remainingQuota };
  } catch (e: any) {
    if (e?.kind === 'rate_limit') {
      return { ok: false, code: 'quota_exhausted', message: 'Free quota exhausted — please add your own API key in settings' };
    }
    if (e?.kind === 'network') {
      return { ok: false, code: 'network_error', message: 'Network error — please retry' };
    }
    return { ok: false, code: 'provider_error', message: 'Translation failed — please try again' };
  }
}
```

- [ ] **Step 3: Wire into `entrypoints/background.ts`**

```ts
import { handleProcess } from '~/lib/background-handler';
import { isProcessRequest } from '~/lib/messages';

const storeAdapter = {
  get: (keys: string[]) => chrome.storage.local.get(keys),
  set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
  remove: (keys: string[]) => chrome.storage.local.remove(keys)
};

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isProcessRequest(msg)) return false;
    handleProcess(msg, storeAdapter).then(sendResponse);
    return true; // keep channel open for async response
  });
});
```

- [ ] **Step 4: Verify tests pass, commit**

```bash
git commit -m "feat(extension): wire background message handler with cache + provider routing"
```

---

### Task 3.2: Local daily quota counter (`extension/lib/quota.ts`)

**Files:**
- Create: `extension/lib/quota.ts`
- Create: `extension/tests/quota.test.ts`

- [ ] **Step 1: Implement counter with daily reset (UTC date as key)**

```ts
const PREFIX = 'quota_';
function todayKey(): string { return PREFIX + new Date().toISOString().slice(0, 10); }

export async function getLocalQuota(): Promise<number> {
  const got = await chrome.storage.local.get([todayKey()]);
  return Number(got[todayKey()] ?? 0);
}

export async function incrementLocalQuota(): Promise<void> {
  const k = todayKey();
  const got = await chrome.storage.local.get([k]);
  await chrome.storage.local.set({ [k]: Number(got[k] ?? 0) + 1 });
}
```

- [ ] **Step 2: Test with frozen date, commit**

```bash
git commit -m "feat(extension): add local daily quota counter (UTC reset)"
```

---

### Task 3.3: Context menu and hotkey commands

**Files:**
- Modify: `extension/entrypoints/background.ts`

- [ ] **Step 1: Register on install, dispatch to active tab via tab message**

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'bcb-translate', title: 'Translate selection', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'bcb-summarize', title: 'Summarize selection', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.selectionText) return;
  const mode = info.menuItemId === 'bcb-translate' ? 'translate' : 'summarize';
  chrome.tabs.sendMessage(tab.id, { type: 'trigger-action', mode, text: info.selectionText });
});

chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const mode = cmd === 'translate-selection' ? 'translate' : 'summarize';
  chrome.tabs.sendMessage(tab.id, { type: 'trigger-action', mode });
});
```

- [ ] **Step 2: Manual test (load unpacked → right-click selection on any page → see two new entries; press Alt+T on selection → see content script log)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(extension): register context menu and Alt+T/Alt+S hotkeys"
```

---

## Phase 4 — Content script: selection and in-page popup

### Task 4.1: Shadow DOM mount helper

**Files:**
- Create: `extension/lib/shadow-host.ts`
- Create: `extension/styles/shadow.css`

- [ ] **Step 1: Implement shadow root with React root mount**

```ts
import { createRoot, type Root } from 'react-dom/client';
import shadowCss from '~/styles/shadow.css?inline';

export interface ShadowMount {
  host: HTMLElement;
  root: Root;
  unmount(): void;
}

export function mountShadow(component: JSX.Element, position: { x: number; y: number }): ShadowMount {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed; left:${position.x}px; top:${position.y}px; z-index:2147483647;`;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = shadowCss;
  shadow.appendChild(styleEl);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  root.render(component);
  return {
    host, root,
    unmount() { root.unmount(); host.remove(); }
  };
}
```

- [ ] **Step 2: Add minimal `shadow.css` with reset and a few utility classes (avoid full Tailwind in Shadow DOM for MVP — hand-write ~30 lines for the popup)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(extension): add Shadow DOM mount helper for in-page React"
```

---

### Task 4.2: FloatingButton component

**Files:**
- Create: `extension/components/FloatingButton.tsx`

- [ ] **Step 1: Implement small icon button positioned absolutely; props: `onClick`**

```tsx
export function FloatingButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="bcb-floating" onClick={onClick} aria-label="bcb-translater action">
      🌐
    </button>
  );
}
```

CSS in `shadow.css`:
```css
.bcb-floating {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid #ddd;
  background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.15); cursor: pointer;
  font-size: 14px; line-height: 26px; padding: 0;
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(extension): add FloatingButton component"
```

---

### Task 4.3: ActionPopup + ResultView

**Files:**
- Create: `extension/components/ActionPopup.tsx`
- Create: `extension/components/ResultView.tsx`

- [ ] **Step 1: Implement two-state popup**

```tsx
import { useState } from 'react';
import { ResultView } from './ResultView';
import type { Mode, ProcessResponse } from '~/lib/messages';
import { getSettings } from '~/lib/storage';

export function ActionPopup({ text, onClose, defaultMode }: { text: string; onClose: () => void; defaultMode?: Mode }) {
  const [state, setState] = useState<{ phase: 'choose' } | { phase: 'loading'; mode: Mode } | { phase: 'result'; mode: Mode; resp: ProcessResponse }>(
    defaultMode ? { phase: 'loading', mode: defaultMode } : { phase: 'choose' }
  );

  const run = async (mode: Mode) => {
    setState({ phase: 'loading', mode });
    const settings = await getSettings();
    const resp: ProcessResponse = await chrome.runtime.sendMessage({ type: 'process', mode, text, targetLang: settings.targetLang });
    setState({ phase: 'result', mode, resp });
  };

  if (defaultMode && state.phase === 'loading') void run(defaultMode);

  return (
    <div className="bcb-popup">
      <button className="bcb-close" onClick={onClose}>×</button>
      {state.phase === 'choose' && (
        <div className="bcb-actions">
          <button onClick={() => run('translate')}>🌐 Translate</button>
          <button onClick={() => run('summarize')}>✂️ Summary</button>
        </div>
      )}
      {state.phase === 'loading' && <div className="bcb-loading">Working…</div>}
      {state.phase === 'result' && <ResultView resp={state.resp} onSwitch={(m) => run(m)} currentMode={state.mode} />}
    </div>
  );
}
```

`ResultView.tsx` renders text with `white-space: pre-wrap`, a Copy button, an error display, and a "Switch to translate/summary" link.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(extension): add ActionPopup and ResultView components"
```

---

### Task 4.4: Selection watcher and wiring

**Files:**
- Modify: `extension/entrypoints/content.ts`
- Create: `extension/lib/selection-watcher.ts`

- [ ] **Step 1: Implement selection watcher that calls a callback with selection bounds**

```ts
export function watchSelection(callback: (selection: { text: string; rect: DOMRect } | null) => void): () => void {
  const handler = () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return callback(null);
    const text = sel.toString();
    if (text.trim().length < 3) return callback(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    callback({ text, rect });
  };
  document.addEventListener('selectionchange', handler);
  return () => document.removeEventListener('selectionchange', handler);
}
```

- [ ] **Step 2: Wire content script: on selection → mount FloatingButton; on click → swap to ActionPopup at same position; on outside click → unmount everything**

```ts
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let mount: ShadowMount | null = null;

    const showButton = (text: string, rect: DOMRect) => {
      if (mount) mount.unmount();
      mount = mountShadow(
        <FloatingButton onClick={() => showPopup(text, rect)} />,
        { x: rect.right + window.scrollX + 4, y: rect.top + window.scrollY }
      );
    };

    const showPopup = (text: string, rect: DOMRect, defaultMode?: Mode) => {
      if (mount) mount.unmount();
      mount = mountShadow(
        <ActionPopup text={text} defaultMode={defaultMode} onClose={() => mount?.unmount()} />,
        { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 8 }
      );
    };

    watchSelection((sel) => {
      if (!sel) return; // do not auto-clear: user may be moving cursor
      showButton(sel.text, sel.rect);
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'trigger-action') {
        const sel = document.getSelection();
        const text = msg.text ?? sel?.toString();
        if (!text) return;
        const rect = sel?.rangeCount
          ? sel.getRangeAt(0).getBoundingClientRect()
          : new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 2, 200, 30);
        showPopup(text, rect, msg.mode);
      }
    });
  }
});
```

- [ ] **Step 3: Manual verification — load unpacked, select text on `https://en.wikipedia.org/wiki/Ukraine`, see floating button appear; click it; see action popup with two buttons**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(extension): wire selection watcher and in-page popup flow"
```

---

## Phase 5 — Toolbar popup (settings UI)

### Task 5.1: Popup layout and theme switcher

**Files:**
- Modify: `extension/entrypoints/popup/main.tsx`
- Modify: `extension/entrypoints/popup/index.html`

- [ ] **Step 1: Build the popup with sections (target lang, API key + provider, inline toggle, quota display, theme toggle)**

```tsx
import { useEffect, useState } from 'react';
import '~/styles/tailwind.css';
import { getSettings, setSettings, type Settings } from '~/lib/storage';
import { getLocalQuota } from '~/lib/quota';

const TARGET_LANGS = [
  { code: 'uk', name: 'Ukrainian' }, { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polish' }, { code: 'de', name: 'German' },
  { code: 'ru', name: 'Russian' }, { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' }, { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' }
];

export function App() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [quota, setQuota] = useState(0);

  useEffect(() => { getSettings().then(setLocal); getLocalQuota().then(setQuota); }, []);
  const update = (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocal(next);
    setSettings(patch);
  };

  if (!settings) return null;
  const dark = settings.theme === 'dark';

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="w-[360px] p-4 bg-white dark:bg-zinc-900 dark:text-zinc-100 space-y-3">
        <h1 className="text-lg font-semibold">bcb-translater</h1>

        <label className="block">
          <span className="text-sm">Target language</span>
          <select className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.targetLang}
            onChange={e => update({ targetLang: e.target.value })}>
            {TARGET_LANGS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-sm">Your API key (optional)</span>
          <input type="password" className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.userApiKey}
            onChange={e => update({ userApiKey: e.target.value })} />
          <select className="w-full mt-1 border rounded p-1 dark:bg-zinc-800"
            value={settings.provider}
            onChange={e => update({ provider: e.target.value as Settings['provider'] })}>
            <option value="auto">Auto (Gemini → Groq)</option>
            <option value="gemini">Gemini</option>
            <option value="groq">Groq</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.showInlineOnTweets}
            onChange={e => update({ showInlineOnTweets: e.target.checked })} />
          <span className="text-sm">Show inline button on tweets</span>
        </label>

        {!settings.userApiKey && (
          <div className="text-sm text-zinc-500">
            Free quota today: {quota} / 50 used
          </div>
        )}

        <div className="flex gap-2">
          <button className="flex-1 border rounded py-1 dark:bg-zinc-800"
            onClick={() => update({ theme: dark ? 'light' : 'dark' })}>
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual test — open popup from toolbar, change settings, reopen → settings persist**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(extension): build toolbar popup with settings, quota and theme toggle"
```

---

## Phase 6 — X (Twitter) integration

### Task 6.1: Twitter selectors and detector

**Files:**
- Create: `extension/lib/twitter/selectors.ts`
- Create: `extension/lib/twitter/injector.ts`

- [ ] **Step 1: Define selectors with fallbacks**

```ts
export const TWEET_SELECTORS = {
  // Primary: stable testid used by X
  text: '[data-testid="tweetText"]',
  // Fallback: structural — within an article role, the lang-bearing block
  textFallback: 'article [lang]'
};
```

- [ ] **Step 2: Implement injector**

```ts
import { detectLanguage } from '~/lib/lang-detect';
import { getSettings } from '~/lib/storage';
import { TWEET_SELECTORS } from './selectors';

const FLAG = 'data-bcb-injected';

export function startTweetInjector(onClick: (text: string, anchor: HTMLElement) => void): () => void {
  const observer = new MutationObserver(() => scan(onClick));
  observer.observe(document.body, { childList: true, subtree: true });
  scan(onClick); // initial pass
  return () => observer.disconnect();
}

async function scan(onClick: (text: string, anchor: HTMLElement) => void) {
  const settings = await getSettings();
  if (!settings.showInlineOnTweets) return;

  const tweets = document.querySelectorAll<HTMLElement>(TWEET_SELECTORS.text);
  for (const t of tweets) {
    if (t.hasAttribute(FLAG)) continue;
    t.setAttribute(FLAG, '1');
    const text = t.innerText.trim();
    if (text.length < 5) continue;
    const lang = detectLanguage(text);
    if (lang === settings.targetLang) continue;

    const btn = document.createElement('button');
    btn.textContent = '🌐 Translate / Summary';
    btn.className = 'bcb-tweet-btn';
    btn.style.cssText = 'margin-top:6px; padding:4px 8px; border:1px solid #ccc; border-radius:6px; background:transparent; cursor:pointer; font-size:13px;';
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      onClick(text, btn);
    });
    t.insertAdjacentElement('afterend', btn);
  }
}
```

- [ ] **Step 3: Wire into content script for x.com / twitter.com only.**

In `entrypoints/content.ts`, after the `watchSelection(...)` call inside `main()`, add:

```ts
import { startTweetInjector } from '~/lib/twitter/injector';

if (/(?:^|\.)(?:x\.com|twitter\.com)$/.test(location.hostname)) {
  startTweetInjector((text, anchor) => {
    const rect = anchor.getBoundingClientRect();
    showPopup(text, rect);
  });
}
```

This keeps the entry-point file as one place where we wire selection + Twitter integration, with a single regex guard for hostnames.

- [ ] **Step 4: Manual verification on `x.com` — log in, scroll feed, verify our button appears under non-Ukrainian tweets and not under Ukrainian ones; click it → action popup opens**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(extension): add X.com inline button with language-aware injection"
```

---

## Phase 7 — Cloudflare Worker

### Task 7.1: Worker quota module

**Files:**
- Create: `worker/src/quota.ts`
- Create: `worker/tests/quota.test.ts`

- [ ] **Step 1: TDD with miniflare**

```ts
const DAILY_LIMIT = 50;

export async function checkAndIncrement(kv: KVNamespace, installId: string): Promise<{ allowed: boolean; remaining: number }> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `quota:${installId}:${date}`;
  const current = Number((await kv.get(key)) ?? 0);
  if (current >= DAILY_LIMIT) return { allowed: false, remaining: 0 };
  await kv.put(key, String(current + 1), { expirationTtl: 60 * 60 * 26 });
  return { allowed: true, remaining: DAILY_LIMIT - (current + 1) };
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(worker): add KV-based daily quota module"
```

---

### Task 7.2: Worker providers and fallback

**Files:**
- Create: `worker/src/providers/types.ts`
- Create: `worker/src/providers/gemini.ts`
- Create: `worker/src/providers/groq.ts`
- Create: `worker/src/llm-fallback.ts`

- [ ] **Step 1: Mirror the extension provider files into worker (same code; fetch is global in Workers runtime). Provider files (`gemini.ts`, `groq.ts`, `types.ts`) are byte-identical to the extension copies. The fallback orchestrator (`worker/src/llm-fallback.ts`) is *not* byte-identical: the Worker passes both API keys explicitly because secrets live in `env`. Implement it with this signature:**

```ts
import { gemini } from './providers/gemini';
import { groq } from './providers/groq';
import type { Provider, ProviderName } from './providers/types';

export async function callWithFallback(
  preference: 'auto' | ProviderName,
  promptInput: { prompt: string; temperature: number },
  keys: { gemini: string; groq: string }
): Promise<{ text: string; provider: ProviderName }> {
  const order: Array<[Provider, string]> =
    preference === 'groq'
      ? [[groq, keys.groq], [gemini, keys.gemini]]
      : [[gemini, keys.gemini], [groq, keys.groq]];
  let lastErr: unknown;
  for (const [p, key] of order) {
    try {
      const r = await p.call({ ...promptInput, apiKey: key });
      return { text: r.text, provider: p.name };
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? { kind: 'unknown' };
}
```

- [ ] **Step 2: Add tests using miniflare's fetch mock**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(worker): mirror Gemini and Groq providers with fallback"
```

---

### Task 7.3: Worker fetch handler

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/src/errors.ts`
- Create: `worker/tests/handler.test.ts`

- [ ] **Step 1: Write failing handler tests**

Cover:
- Missing `X-Install-Id` → 400
- Quota exhausted → 429 with `{error: "quota_exhausted"}`
- Successful translate path → 200 with `{result, provider, remainingQuota}`
- Provider fails twice → 502 with `{error: "provider_error"}`

- [ ] **Step 2: Implement**

```ts
import { checkAndIncrement } from './quota';
import { callWithFallback } from './llm-fallback';
import { buildTranslatePrompt, buildSummarizePrompt, TEMPERATURES } from './prompts';

export interface Env { QUOTA_KV: KVNamespace; GEMINI_API_KEY: string; GROQ_API_KEY: string; }

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-install-id'
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/process') {
      return json(404, { error: 'not_found' });
    }
    const installId = request.headers.get('x-install-id');
    if (!installId) return json(400, { error: 'missing_install_id' });

    let body: any;
    try { body = await request.json(); } catch { return json(400, { error: 'invalid_json' }); }
    if (!body || (body.mode !== 'translate' && body.mode !== 'summarize') || typeof body.text !== 'string' || typeof body.targetLang !== 'string') {
      return json(400, { error: 'invalid_input' });
    }
    if (body.text.length > 10_000) return json(400, { error: 'too_long' });

    const q = await checkAndIncrement(env.QUOTA_KV, installId);
    if (!q.allowed) return json(429, { error: 'quota_exhausted' });

    const prompt = body.mode === 'translate'
      ? buildTranslatePrompt({ text: body.text, targetLang: body.targetLang })
      : buildSummarizePrompt({ text: body.text, targetLang: body.targetLang });

    try {
      const r = await callWithFallback(
        'auto',
        { prompt, temperature: TEMPERATURES[body.mode as 'translate'|'summarize'] },
        { gemini: env.GEMINI_API_KEY, groq: env.GROQ_API_KEY }
      );
      return json(200, { result: r.text, provider: r.provider, remainingQuota: q.remaining });
    } catch (e: any) {
      return json(502, { error: 'provider_error' });
    }
  }
} satisfies ExportedHandler<Env>;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors } });
}
```

Note: the worker fallback signature differs from the extension's (defined explicitly in Task 7.2 Step 1) because the worker carries both keys from `env`.

- [ ] **Step 3: Run integration tests, commit**

```bash
git commit -m "feat(worker): implement /v1/process with quota, providers, and fallback"
```

---

### Task 7.4: Deploy worker

- [ ] **Step 1: Create KV namespace**

```bash
cd worker && pnpm exec wrangler kv namespace create QUOTA_KV
```

(Note: Wrangler v3+ uses `wrangler kv namespace create` with a space; older docs show `kv:namespace`, which is deprecated.)

Copy the printed ID into `wrangler.toml` `kv_namespaces[0].id`.

- [ ] **Step 2: Set secrets**

```bash
pnpm exec wrangler secret put GEMINI_API_KEY
pnpm exec wrangler secret put GROQ_API_KEY
```

User pastes each key when prompted.

- [ ] **Step 3: Deploy**

```bash
pnpm deploy
```

Expected output: `Published bcb-translater (X.YZ sec)` and a public URL like `https://bcb-translater.<subdomain>.workers.dev`.

- [ ] **Step 4: Update `extension/lib/providers/proxy.ts`** with the deployed URL.

- [ ] **Step 5: Smoke test**

```bash
curl -X POST https://bcb-translater.<subdomain>.workers.dev/v1/process \
  -H 'content-type: application/json' \
  -H 'x-install-id: test-curl-id' \
  -d '{"mode":"translate","text":"Hello world","targetLang":"Ukrainian"}'
```

Expected: 200 with `{result: "Привіт, світ", provider: "gemini", remainingQuota: 49}` (or similar).

- [ ] **Step 6: Commit**

```bash
git add worker/wrangler.toml extension/lib/providers/proxy.ts
git commit -m "chore: deploy worker and wire production proxy URL"
```

---

## Phase 8 — End-to-end acceptance

### Task 8.1: Walk through all 8 acceptance criteria

Reference: spec section 11.

- [ ] **Step 1: Build extension** `cd extension && pnpm build`
- [ ] **Step 2: Load `extension/.output/chrome-mv3` as unpacked extension**
- [ ] **Step 3: AC#2 — without API key set, select EN text on a webpage, click floating button, click Translate, verify Ukrainian translation appears within ~3s with line breaks preserved**
- [ ] **Step 4: AC#3 — same flow via `Alt+T` and via right-click → Translate selection**
- [ ] **Step 5: AC#4 — open `x.com`, find a foreign-language tweet, verify our inline button appears; click it and confirm popup loads with tweet text**
- [ ] **Step 6: AC#5 — select a multi-paragraph English post, click Summary, verify a 2-6 sentence Ukrainian summary**
- [ ] **Step 7: AC#6 — open toolbar popup, verify quota counter, change target language, toggle theme**
- [ ] **Step 8: AC#7 — manually exhaust quota by issuing 51 requests (or set KV value to 50 directly), verify "Free quota exhausted — please add your own API key in settings" error; add own Gemini key in popup; verify subsequent request succeeds**
- [ ] **Step 9: AC#8 — translate the same text twice, verify second response is instant (cache hit; can confirm in dev tools that no network request fired)**

- [ ] **Step 10: Document any deviations from spec; if all 8 ACs pass, commit final marker**

```bash
git commit --allow-empty -m "chore: MVP acceptance criteria 1-8 verified"
```

---

### Task 8.2: Build production zip, push to GitHub

- [ ] **Step 1: `cd extension && pnpm zip` → produces `.output/chrome-mv3.zip`**
- [ ] **Step 2: `git push origin main`**
- [ ] **Step 3: Tag MVP release: `git tag v0.1.0 && git push --tags`**

---

## Out of plan (deferred to backlog, do NOT build)

- Translation history UI
- Manual source-language override
- Hotkey customization UI
- Additional LLM modes ("explain crypto slang", "rewrite simpler")
- Firefox / Safari ports
- User accounts / cross-device sync
- Worker-signed JWT for installId
- Authenticated quota endpoints
- Streaming responses (SSE) — current design is request/response

---

## Risk reminders during execution

- **X.com DOM changes:** if `[data-testid="tweetText"]` stops matching, switch to fallback selector and re-test before assuming the integration is broken.
- **`chrome.storage.sync` size limit (~100 KB):** target language, provider, key, toggle, theme together are <1 KB — no concern, but if we ever cache anything in `sync`, watch the limit.
- **`temperature` choice:** if translations feel "too creative", lower to `0.2`; if too literal, raise to `0.4`. The number 0.3 is a starting point; tune during AC#2 verification.
- **Newline-count safeguard retry:** implemented inline in Task 3.1 Step 2. If the retry path itself errors, the original (potentially flat) translation is kept and returned — by design, we never block a result on the safeguard.
- **Proxy URL:** Task 7.4 hardcodes the production URL into the extension. For local development of the proxy path, support an env override (`WXT_PROXY_URL` consumed by `wxt.config.ts` and read at build time).
