# Twtr Translater — Design Spec

**Date:** 2026-04-28
**Status:** Approved by user, ready for implementation planning
**Owner:** artemmashura94@gmail.com

## 1. Goal

Build a Chrome extension that translates and summarizes text on the web — primarily on X (Twitter) but also any selected text on any page — using LLMs for contextual quality and **with full preservation of source structure** (line breaks, paragraphs, lists). The default direction is auto-detect → Ukrainian.

The product solves three problems with existing tools (DeepL extension, Google Translate, native X "Translate post"):

1. **Literal, low-context translation** — current tools translate word-by-word, miss idioms, lose register (e.g. casual crypto Twitter slang becomes formal nonsense).
2. **Lost structure** — multiline tweets and posts get flattened into a single paragraph.
3. **No summarization** — for long threads or dense posts, the user wants a concise gist on demand, not just a translation.

## 2. Scope

### In MVP

- Chrome extension (Manifest V3) running on all sites
- Special integration on `x.com` / `twitter.com` (inline translate button under foreign-language tweets)
- Two LLM-powered actions: **Translate** and **Summary**
- Three trigger types for selected text: floating button on selection, hotkeys (`Alt+T` / `Alt+S`), right-click context menu
- In-page action popup (Shadow DOM) showing `[Translate]` `[Summary]` buttons → result in same popup
- Toolbar popup (extension icon click) with minimum settings: target language, optional own API key, provider choice, "show inline button on tweets" toggle, free-quota counter, light/dark theme
- Hybrid backend architecture:
  - If user has set their own API key → extension calls provider API directly
  - Otherwise → extension calls own Cloudflare Worker proxy with daily quota per `installId`
- Two LLM providers: **Gemini 2.0 Flash** (primary, best Ukrainian quality, 1M context, free tier) + **Groq Llama 3.3 70B** (fallback, fastest)
- Local cache of translations to avoid re-paying for repeated text

### Out of MVP (deferred to backlog, NOT to be built)

- Translation history UI
- Manual source-language override (auto-detect only)
- Hotkey customization (fixed `Alt+T` / `Alt+S`)
- Additional LLM modes ("explain crypto slang", "rewrite simpler", etc.)
- Firefox / Safari support
- Mobile
- User accounts / cross-device sync
- Authenticated quota (signed JWT) — current design uses raw `installId`, acceptable for MVP

## 3. Architecture

### Frontend (Chrome extension, MV3)

Five isolated parts:

| Part | Role |
|------|------|
| `content-script` | Injects on every page; handles selection detection, X.com tweet integration, in-page action popup rendering |
| `background` (service worker) | Coordinates LLM requests; registers context menu and hotkeys; tracks daily quota counter |
| `popup` (toolbar) | Settings UI shown when user clicks extension icon |
| `options` (page) | Reserved for future advanced settings; in MVP renders the same UI as `popup` |
| `shared/` | Common TypeScript types, message contracts, storage wrappers |

**Critical rule:** content-script never calls LLM APIs directly. All LLM calls go through `background` via `chrome.runtime.sendMessage`. This avoids CORS, centralizes the "own-key vs proxy" decision, and makes provider swaps a localized refactor.

### Backend (Cloudflare Worker)

A single Worker exposing one endpoint:

```
POST https://twtr-tr.<subdomain>.workers.dev/v1/process
Headers: X-Install-Id: <uuid>
Body:    { mode: "translate" | "summarize", text, sourceLang, targetLang }
Returns: { result, provider, remainingQuota }  | { error, code }
```

- Quota tracked in **Cloudflare KV** under key `quota:${installId}:${YYYY-MM-DD}`, TTL 24h, default limit **50 requests/day** per installId.
- Provider order: try Gemini first; on `429` / `5xx` / network error → fall back to Groq. If both fail → return structured error.
- Secrets `GEMINI_API_KEY`, `GROQ_API_KEY` stored as Worker secrets, never exposed to client.

### Folder structure

```
twtr-translator/
├── extension/                 ← Chrome extension (WXT framework)
│   ├── wxt.config.ts
│   ├── package.json
│   ├── entrypoints/
│   │   ├── content.ts         ← content script entry
│   │   ├── background.ts      ← service worker
│   │   ├── popup/             ← toolbar popup
│   │   └── options/           ← options page
│   ├── components/
│   │   ├── ActionPopup.tsx    ← in-page popup (Shadow DOM)
│   │   ├── FloatingButton.tsx
│   │   └── TweetButton.tsx
│   ├── lib/
│   │   ├── llm-client.ts      ← single facade for LLM calls (via background)
│   │   ├── messages.ts        ← typed content↔background message contracts
│   │   ├── storage.ts         ← chrome.storage wrapper
│   │   ├── lang-detect.ts     ← franc-min wrapper
│   │   ├── cache.ts           ← LRU translation cache
│   │   └── prompts.ts         ← shared with worker (build-time copy)
│   └── public/icons/
└── worker/                    ← Cloudflare Worker
    ├── wrangler.toml
    ├── src/
    │   ├── index.ts           ← fetch handler
    │   ├── quota.ts           ← KV-based daily rate limiting
    │   ├── providers/
    │   │   ├── gemini.ts
    │   │   └── groq.ts
    │   └── prompts.ts         ← single source of truth for prompts
    └── package.json
```

## 4. UX

### Trigger model (combined)

- **Floating button on text selection** — when the user selects ≥3 chars on any page, a small icon appears near the selection. Click → action popup.
- **Hotkeys** — `Alt+T` on a non-empty selection = translate immediately, `Alt+S` = summarize immediately. No intermediate popup choice. Hotkeys are bound to selection only — they do **not** act as shortcuts inside the open action popup.
- **Context menu** — right-click on selection → `Translate selection` and `Summarize selection`.
- **X.com inline button** — a small button injected under each foreign-language tweet (where X normally shows "Translate post"), only when the tweet's detected language ≠ target language. Click → action popup with `[Translate] [Summary]`.

### Action popup (in-page)

Rendered in Shadow DOM to avoid host-page CSS conflicts. Two states:

1. **Initial state:** two large buttons `[🌐 Translate]` and `[✂️ Summary]`. Closes on outside click or Esc.
2. **Result state:** result text rendered with `white-space: pre-wrap` to preserve newlines, plus a "Copy" button and a "Switch to Translate/Summary" link to run the other mode on the same input.

Loading state: spinner overlay with "Translating..." / "Summarizing..." text. Error state: human-readable message + "Try again" button.

### Toolbar popup (extension icon, 360×500px)

Sections, top to bottom:

1. **Target language** — dropdown, defaults to `Ukrainian`. Options: UA, EN, PL, DE, RU, ES, FR, ZH, JA, +"Custom" text input.
2. **Your API key (optional)** — password input + provider selector (`Auto` / `Gemini` / `Groq`). When filled, all requests skip the proxy.
3. **Show inline button on tweets** — toggle, default `on`.
4. **Free quota today** — read-only display, e.g. `38 / 50 left`. Hidden if user has set own API key.
5. **Theme** — Light / Dark toggle.

Hidden in MVP: history, hotkey customization, source language override, advanced settings section.

## 5. Data flow (end-to-end example)

User selects text on `news.ycombinator.com` and clicks Translate:

1. `content-script.selection-watcher` detects `selectionchange` with non-empty selection ≥3 chars → renders `FloatingButton` near caret.
2. User clicks button → `ActionPopup` opens in Shadow DOM with `[Translate] [Summary]`.
3. User clicks `[Translate]` → popup posts `{ mode: 'translate', text, targetLang }` to `background` via `chrome.runtime.sendMessage`.
4. `background.handleProcessRequest`:
    1. Reads settings (`userApiKey`, `provider`, `targetLang`) from `chrome.storage.sync`.
    2. Computes cache key `sha256(mode + text + targetLang)` and checks `chrome.storage.local`. On hit → returns cached result immediately.
    3. If `userApiKey` is set → calls provider's REST API directly with that key.
    4. Else → POSTs to Cloudflare Worker `/v1/process` with `X-Install-Id` header.
    5. On `429` or network error → tries the fallback provider once.
    6. On success → writes to cache (LRU eviction at ~4MB to stay under the 5MB `chrome.storage.local` quota), decrements local quota counter, returns `{ result, provider, remainingQuota }`.
5. `ActionPopup` renders `result` with `white-space: pre-wrap`, shows Copy button.

X.com inline button uses the same flow but extracts text from the tweet's DOM element (selected by `[data-testid="tweetText"]` with one fallback selector).

## 6. LLM strategy

### Translation prompt (provider-agnostic)

```
You are a precise, idiomatic translator. Translate the text below to {targetLang}.

HARD RULES:
1. Preserve ALL line breaks, paragraph breaks, indentation, bullet points, lists exactly as in source.
2. Do NOT translate: @mentions, #hashtags, URLs, $TICKERS, code in `backticks`, emoji.
3. Translate meaning naturally, not word-by-word. Match the register (casual / technical / formal).
4. Output ONLY the translation. No prefixes, explanations, or quotation marks around the result.

Source text (between markers):
<<<TEXT
{text}
TEXT>>>
```

### Summary prompt

```
You are a concise summarizer. Summarize the text below in {targetLang}.

HARD RULES:
1. 2-3 sentences for input under 500 chars; 4-6 sentences for longer input.
2. Preserve key facts: numbers, names, $TICKERS, dates, percentages.
3. Output in {targetLang}, idiomatic and natural.
4. Output ONLY the summary. No prefixes, explanations, or quotation marks.

Source text (between markers):
<<<TEXT
{text}
TEXT>>>
```

### Model parameters

- Translation: `temperature: 0.3` (precision priority).
- Summary: `temperature: 0.5` (slight latitude for natural phrasing).
- Gemini-specific: `responseMimeType: "text/plain"` to suppress markdown wrapping.

### Structure-preservation safeguard

Cheap post-check in `background` after every **translation** (not summary — summarization is allowed to compress structure): count `\n` occurrences in source vs result. If `result.newlines < source.newlines / 2` AND source had ≥2 newlines → re-issue the request once with an additional system instruction reminding to preserve line breaks. Maximum one retry.

### Provider fallback (consistent across both paths)

Both the own-key path (in `background`) and the proxy path (in Cloudflare Worker) implement the **same fallback rule**: try the configured/default provider first; on `429` / `5xx` / network error → try the other provider once; on second failure → return a structured error to the UI. The fallback logic lives in a shared helper (`extension/lib/llm-fallback.ts` and a mirror in `worker/src/`) so the policy is defined in one place semantically even though the code exists in two runtimes.

### Prompt-injection delimiters

User text is wrapped in `<<<TEXT … TEXT>>>` markers. The system prompt explicitly instructs the model to treat content between markers as data, not instructions. This is a soft mitigation — adversarial users can still craft injections, but for a personal-use translator the trade-off favors simplicity.

## 7. Tech stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Extension framework | **WXT** | Vite-based, MV3-native, hot-reload, TS out of the box; the most ergonomic option in 2026 |
| Language | **TypeScript (strict)** | Type-safe message contracts between content/background, fewer runtime surprises |
| UI framework | **React 19** | Mature, fits popup/options/in-page Shadow DOM use cases |
| Styling | **Tailwind CSS v4** | Speed of iteration, consistent design tokens for theme switching |
| Lang detection | **franc-min** (~14 KB) | Client-side, zero round-trip cost, sufficient accuracy for "is this Ukrainian or not" |
| Backend runtime | **Cloudflare Workers** | Free tier (100k req/day), edge latency, secret management, KV for quota |
| Backend storage | **Cloudflare KV** | Native to Workers, cheap, TTL support |
| Backend tooling | **wrangler** | Official Cloudflare CLI for dev/deploy |
| Package manager | **pnpm** | Faster, less disk space than npm/yarn |

## 8. Storage

| Where | What | Why |
|-------|------|-----|
| `chrome.storage.sync` | Settings (target lang, provider, own key, inline-toggle, theme) | Synced across user's Chrome instances; tiny payload (~1 KB) |
| `chrome.storage.local` | Translation cache (LRU, ~4 MB cap) | 5 MB local limit; sync namespace too small for cache |
| `chrome.storage.local` | Daily quota counter (when on proxy mode) | Local-only, resets at midnight UTC |
| Cloudflare KV | `quota:${installId}:${date}` counter | Authoritative quota; client counter is best-effort UI hint |

`installId` is a `crypto.randomUUID()` generated on first launch and stored in `chrome.storage.local`.

## 9. Error handling

| Error | Behavior |
|-------|----------|
| Network failure to Worker | Try fallback provider once (if own key) or surface `Network error — retry?` button (if proxy) |
| `429` from provider | Try the other provider once; on second `429` → `Free quota exhausted — please add your own API key in settings` |
| Provider returns malformed/empty response | Show `Translation failed — try again` |
| User selects empty / very long text (>10 KB) | Floating button doesn't appear for <3 chars; for >10 KB the action popup, hotkey path, context menu, and X.com inline flows all show `Text too long (>10 KB) — please shorten` and do not call the LLM |
| User clicks button but extension's background SW is suspended | First request wakes it up; UX absorbs ~100 ms cold-start |

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| X.com changes DOM structure / `data-testid` values | Use `data-testid="tweetText"` with one fallback structural selector; wrap MutationObserver code in try/catch; if tweet integration breaks, extension still works through selection / hotkeys |
| Free LLM quotas shrink or disappear | Provider modules isolated in `worker/providers/`; swap takes one PR |
| `installId` is bypassable by reinstalling the extension | Acceptable for MVP; Phase 2 will issue a Worker-signed JWT on first contact |
| `chrome.storage.local` 5 MB cap | Translation cache uses LRU eviction at 4 MB |
| Prompt injection in translated text | `<<<TEXT … TEXT>>>` delimiters + system instruction; not bulletproof but adequate for personal use |
| Service worker termination during a request | Background uses `chrome.runtime.sendMessage` with promise-based handlers, which Chrome auto-revives |

## 11. Acceptance criteria for MVP

The MVP is considered complete when, on a fresh Chrome install:

1. User installs the extension from a local `dist/` folder via `chrome://extensions` → Load unpacked.
2. Without setting any API key, user can select English text on any page → click floating button → click `Translate` → see Ukrainian translation with line breaks preserved within ~3 seconds.
3. Same flow works via `Alt+T` hotkey and right-click context menu.
4. On `x.com`, foreign-language tweets show our inline button under the tweet text; clicking it opens the action popup with the tweet text pre-loaded.
5. `Summary` button on a multi-paragraph post returns a 2-6 sentence Ukrainian summary preserving key entities/numbers.
6. Toolbar popup shows the daily quota counter, allows changing target language, and toggling theme between light and dark.
7. After 50 free requests in a day, the user sees a clear message instructing them to add their own API key, and after adding one, requests succeed without quota.
8. Translating the same text twice returns the second result instantly (cache hit).
