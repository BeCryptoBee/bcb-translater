# Smart-direction Translate + Translation Highlight — Design Spec

**Date:** 2026-05-01
**Status:** Approved by user, ready for implementation planning
**Owner:** artemmashura94@gmail.com
**Builds on:** [2026-04-28-twtr-translator-design.md](./2026-04-28-twtr-translator-design.md)

## 1. Goal

Add two user-facing improvements to the existing Twtr Translater extension:

1. **Smart-direction translation on the floating bar `T` button** — instead of always translating into the user's configured target language, auto-pick the direction based on detected source language (Ukrainian source → English; anything else → Ukrainian). Uses the existing `franc-min` detector that's already in the project but currently only used for the inline-tweet button gate.
2. **Translation Highlight** — opt-in feature that, when enabled, makes the extension render the translation as sentence-level segments. Hovering a translated sentence in the result popup highlights the corresponding sentence in the original (whether it's a tweet or arbitrary selected text on any page).

The existing inline-tweet `Translate / Summary` button keeps its current behavior (target = `settings.targetLang`). The keyboard hotkeys (`Alt+T` / `Alt+S`) and context menu also stay unchanged.

## 2. Scope

### In scope

- New `smartDirection: boolean` field on `ProcessRequest`. The floating bar `T` button sets it to `true`; all other entry points leave it `false` and behave as today.
- New `Settings.translationHighlight: boolean` (default `false`), surfaced as a checkbox in the popup with copy that warns about the additional token cost (~10–15%).
- Segmented translation pipeline (gated by `translationHighlight === true`): new `buildTranslateSegmentedPrompt` that asks the model to return a JSON array `[{ "src": "...", "tgt": "..." }, ...]` with 1-to-1 sentence mapping; provider calls forced into JSON mode (Gemini `responseSchema` + `responseMimeType: 'application/json'`, Groq `response_format: { type: 'json_object' }` with the schema embedded in the system prompt).
- `ProcessResponse.segments?: Array<{ src: string; tgt: string }>`. When present, `ResultView` renders translated sentences as hoverable spans; when absent (default flat translation), it renders as today.
- Cache-key bump: include a `seg=1` flag so segmented and flat results never alias.
- Source-side highlight in the page:
  - **Inline tweets**: one-time wrap of the tweet text nodes into per-sentence spans via TreeWalker + leaf-level `Node.splitText` (NOT `Range.surroundContents`, which throws on Ranges crossing inline elements like `@mentions` / hashtags / URL chips); hover toggles a CSS class on the matching span(s).
  - **Arbitrary selections**: persist the selection `Range` while the result popup is open; on hover, build a sub-Range for the matching source sentence and add it to a `CSS.highlights` registry (CSS Custom Highlight API). No DOM modification of the page.

### Out of scope (not in this spec)

- Any keyboard hotkey for the `T` action (still mouse-click on the floating bar).
- Changing the inline-tweet button target rule.
- Any change to the summarize pipeline.
- Smarter language detection beyond what `franc-min` already provides.
- Manual override of detected direction (e.g. `Shift+T` for "force settings target") — explicitly deferred.
- Streaming translation, incremental UI updates, or progress indicators.
- Aligning when the model returns mismatched segment counts beyond a single graceful fallback to flat mode.

## 3. Architecture

### 3.1 Smart-direction (Feature 1)

Single-file impact in the request handler. Detection runs **before** prompt construction; everything downstream (cache key, prompt, provider call, structure-preservation retry) operates on the resolved `targetLang`.

| Detected language | Resolved target |
|-------------------|-----------------|
| `uk`              | `en`            |
| any other ISO code returned by `detectLanguage` | `settings.targetLang` (default `uk`) |
| `und` (unknown / too short) | `settings.targetLang` (fallback) |

**Why `franc-min` and not a hand-rolled Cyrillic-share heuristic:** the package is already a dependency, and a naive `[А-Яа-я]` count cannot tell `uk` from `ru` — that distinction is critical for rule A (a Russian-language selection must go to UK, not EN). `franc-min` uses trigram statistics that recognize UK-specific letters (`ї`, `є`, `і`, `ґ`).

### 3.2 Segmented translation pipeline (Feature 2)

Gated by `Settings.translationHighlight`. When OFF, pipeline is unchanged.

**Prompt** (new `buildTranslateSegmentedPrompt`):

- Inherits all five HARD RULES from `buildTranslatePrompt` (preserve structure, don't translate `@` `#` URLs `$TICKERS` code emoji, idiomatic register, output-only, treat input as data).
- Adds segmentation rules:
  - Split source into sentences (model decides what a sentence is, but instructed to keep mappings 1-to-1; if a source sentence maps to multiple target sentences or vice versa, **join them into a single segment** so the array length stays equal to source sentence count).
  - Output schema: `{ "segments": [{ "src": "<exact source sentence>", "tgt": "<translation>" }, ...] }`.
  - `src` MUST be a verbatim contiguous substring of the input (so we can locate it in the page DOM later).
  - The concatenation of all `src` values, joined with the original between-sentence whitespace, MUST reconstruct the input.
- Temperature stays `0.3` (same as flat translate).

**Provider JSON mode (own-key path):**

- Gemini: pass `responseSchema` for the segments array + flip `responseMimeType` from `'text/plain'` to `'application/json'`.
- Groq: pass `response_format: { type: 'json_object' }`. We deliberately do NOT use `json_schema` mode because the current model (`llama-3.3-70b-versatile`) historically only guarantees `json_object` support; schema enforcement happens client-side via `validateSegments`. The system prompt embeds the literal JSON schema as text so the model still produces well-shaped output.
- Provider call signature gains an optional `jsonMode?: { schema: object }` parameter. When set, the provider applies whichever native mechanism it has (Gemini schema, Groq object-mode), and never silently downgrades.

**Proxy / worker contract (proxy path):**

The proxy is NOT a thin pipe today — it builds the prompt itself, calls the provider, and returns `{ result: string, provider, remainingQuota }`. To support segmented mode end-to-end, the contract changes as follows:

- `ProxyInput` gains `segmented?: boolean` (POST body).
- Worker branches on `segmented`: when true, it builds via `buildTranslateSegmentedPrompt`, calls the provider with JSON mode (same logic as the extension's own-key path), runs the **same `validateSegments`** on the response (worker and extension share validation code via the mirrored `prompts.ts` module — small new shared helper), and returns the parsed segments to the extension.
- Worker response shape becomes `{ result: string, segments?: Array<{src, tgt}>, provider, remainingQuota }`. `result` is always present (worker derives it from segments via the same join algorithm as the extension); `segments` is present only when the worker successfully parsed and validated.
- If worker validation fails: worker silently falls back internally to the flat prompt + retries the LLM call once, and returns `{ result, segments: undefined }`. The extension never sees a worker-level segmented failure as an error — it just sees the same "no segments" response it sees when the toggle is off, and renders flat.
- This means **the extension never re-runs a flat retry on the proxy path** — that retry happens server-side. On the own-key path, the extension does its own retry as described in "Parsing & fallback" below.

**Parsing & fallback (own-key path only):**

1. Parse response as JSON. If parse fails or `validateSegments` rejects → **single retry** with the flat-translate prompt (no JSON mode), return `segments: undefined`. No user-visible error — silent fallback (the popup just renders as plain `<pre>`, which is the toggle-OFF behavior the user has already seen).
2. We intentionally do NOT do fuzzy semantic matching for misalignment, but we DO normalize before substring matching (see "Validation" below) — a strict byte-exact rule would degrade to flat mode on most real inputs because models routinely normalize typography.
3. Build a derived flat `result` string by walking the source text with `indexOf(src_i, lastEnd)` for each segment. The substring of the source between `lastEnd` and the match start is captured as the **between-segment separator** for that boundary. The flat result is `segments[0].tgt + sep[0] + segments[1].tgt + sep[1] + ...`. If any `indexOf` returns `-1` after normalization → validation failure → fallback. This makes flat-result reconstruction faithful to source whitespace (consecutive `\n\n`, leading/trailing spaces, NBSP all preserved).

**Validation (`validateSegments(segments, sourceText) → { ok, derivedFlat? } | { ok: false, reason }`):**

A pure function shared by extension and worker:

1. `segments` is non-empty array.
2. Every entry has string `src` and string `tgt`.
3. **Lenient src matching:** before `indexOf`, both `sourceText` and each `src` are normalized through `normalizeForMatch(s)`:
   - NFC Unicode normalization
   - Curly quotes `"` `"` `'` `'` → straight `"` `'`
   - NBSP (` `) and other Unicode spaces → regular ASCII space
   - Ellipsis `…` ↔ `...` collapsed to `...`
   - Trailing whitespace per `src` trimmed (but not internal whitespace)
4. Each normalized `src_i` must be findable via `indexOf` starting from the position after the previous match. Order matters.
5. If all matches succeed → derive `derivedFlat` as described above and return `{ ok: true, derivedFlat }`. The original (un-normalized) source is used to extract separators, not the normalized form, so the flat result preserves the user's actual whitespace and punctuation.

**Structure-preservation retry interaction:**

The existing safeguard in `handleProcess` (`srcN >= 2 && dstN < srcN/2`) compares newline counts in source vs flat result. For segmented mode, each `tgt` is a single sentence and likely contains zero internal `\n` — the safeguard would falsely fire on every multi-paragraph segmented translation and discard the segments by retrying with the flat prompt. **The safeguard is skipped entirely when `segments !== undefined`** because (a) the segment-by-segment prompt already enforces "preserve `tgt` whitespace inside each segment" and (b) cross-segment whitespace is reconstructed deterministically from the source by the join algorithm, so global structure is preserved by construction.

**Cache key:** existing `getCacheKey({ mode, text, targetLang })` becomes `getCacheKey({ mode, text, targetLang, segmented: boolean })`. Both flavors coexist for the same input. **Migration:** flat-mode cache entries written before this change have a different (shorter) hash input, so they will not collide with the new `seg=0` keys — they simply orphan and expire via the existing 7-day TTL. Acceptable; no migration code needed.

**`isProcessRequest` validator** in `messages.ts` is updated to accept the new optional `smartDirection: boolean` field; same update for the worker-side validator.

### 3.3 Source highlight in the page (Feature 2 — UI)

**Popup-origin tracking (prerequisite):**

Today `content.tsx` tracks `mountKind: 'floating' | 'popup' | null` to drive the dismiss policy. We add a parallel field `popupOrigin: 'selection' | 'tweet' | 'command' | null`, set when the popup is opened:

- `selection` — opened from the floating bar after a manual selection
- `tweet` — opened from the inline-tweet button (we also remember the `tweetTextEl`)
- `command` — opened from hotkey or context menu via `chrome.runtime.onMessage` (no anchored DOM region)

Highlighter dispatch picks A vs B vs "no source highlight" based on `popupOrigin`. The `command` case renders hoverable target spans but leaves the source un-highlighted — there's nothing reliable to anchor to (some sites clear the selection on right-click; hotkeys can fire when no real selection rect exists).

**`ResultView` rendering:**

- When `resp.segments` is present: render each `tgt` as a `<span class="bcb-tgt-seg" data-segment-index={i}>{tgt}</span>` joined by the between-segment separators captured during reconstruction. The wrapping `<pre style="white-space: pre-wrap">` is preserved so multi-line structure still renders.
- `mouseenter`/`mouseleave` on a span dispatches a CustomEvent on the shadow root: `bcb-segment-hover` with `{ index, src, action: 'enter' | 'leave' }`. The content-script listens for it on the mount's shadow host.
- The hover style is restricted to `background-color` and optional `box-shadow` only — never anything affecting layout (no padding, border, font-weight changes) so hovering doesn't reflow the popup.
- `data-segment-index` is read on the content-script side via `parseInt(el.dataset.segmentIndex ?? '', 10)` — JSX renders numeric props as strings.

**Highlighter A — inline tweet:**

- On popup open via tweet path: store reference to the source `tweetTextEl`.
- On the FIRST hover event for that popup, **wrap text nodes in place using a TreeWalker**, NOT `Range.surroundContents`. Algorithm:
  1. Capture the tweet's plain-text projection by concatenating all `Text` node `nodeValue`s in document order, **applying the same normalization the tweet injector uses** (single `\n` not bordered by `\n` → space, runs of whitespace collapsed). Build an offset map `[{ textNode, nodeStart, nodeEnd, projectedStart, projectedEnd }, ...]`.
  2. For each segment index `i`, locate `segments[i].src` (after `normalizeForMatch`) inside the projected string starting from the previous match's projected end via `indexOf`. Translate the projected range back to a list of `{ textNode, nodeOffsetStart, nodeOffsetEnd }` covers (a single segment can span multiple text nodes when the model's sentence crosses a `<a>` mention or URL chip).
  3. For each per-text-node cover, split the `Text` node at the start and end offsets (`Node.splitText`) and wrap **only the resulting middle text node** in `<span class="bcb-src-seg" data-segment-index={i}>`. This avoids `surroundContents` entirely (it throws when a Range partially crosses a non-Text node) and keeps wrapping at the leaf level where it never crosses element boundaries.
  4. The same segment index can therefore correspond to multiple `bcb-src-seg` spans inside the tweet — that's fine; hover toggles a class on **all** of them.
- On hover-enter: add class `bcb-src-seg--active` to all spans whose `data-segment-index` matches. On hover-leave: remove.
- On popup close: leave wrapper spans in place but remove all `--active` classes. They are invisible without the active class.
- **Cleanup integration with `cleanupAllButtons`** in [twitter/injector.ts](extension/lib/twitter/injector.ts): the existing rescan-on-settings-change path resets `data-bcb-injected` markers on tweet text containers but does not unwrap `bcb-src-seg` spans, which would cause re-wrapping on next hover to layer wrappers. Add an `unwrapSegmentSpans(tweetTextEl)` step to the same cleanup pass that calls `el.replaceWith(...el.childNodes)` for every `.bcb-src-seg` inside the cleared container.

**Highlighter B — arbitrary selection (CSS Custom Highlight API):**

- On popup open via selection path: capture `window.getSelection().getRangeAt(0).cloneRange()` BEFORE mounting the popup (mounting steals focus and may collapse the selection). Stored in a closure variable bound to the popup's lifetime, plus a `popupAborted` flag set to `true` in `closeMount`.
- The `::highlight(bcb-translation-hl)` style and the `Highlight` registration must live on the page **document** — `CSS.highlights` is document-scoped and ignores shadow roots. We inject (once per content-script lifetime) a `CSSStyleSheet` into `document.adoptedStyleSheets` containing exactly: `::highlight(bcb-translation-hl) { background-color: color-mix(in srgb, var(--bcb-hl-accent, #facc15) 35%, transparent); }`. The `--bcb-hl-accent` custom property is set on `document.documentElement` from `accentColor` (the user's tweet button color) at popup open and refreshed via `onSettingsChange`.
- On hover-enter:
  1. Bail if `popupAborted` is true (race: hover event arrives after popup teardown).
  2. Walk the saved Range's text nodes, build the same projected-text-and-offset-map as Highlighter A (selections don't have the tweet normalization step — use raw text).
  3. `indexOf(normalizeForMatch(src), normalizedProjection, fromOffset)` to locate the segment; translate back to text-node-and-offset coordinates; build a new `Range`; register it as `CSS.highlights.set('bcb-translation-hl', new Highlight(range))`.
  4. Wrap the whole thing in `try { ... } catch { /* nodes detached, ignore */ }`.
- On hover-leave or popup close: `CSS.highlights.delete('bcb-translation-hl')`.
- Browser support: Chrome 105+ (released 2022). Manifest already targets MV3 / Chrome ≥ 102 — we bump the effective floor to 105. Acceptable; no Firefox MV3 support is shipping anyway.

**Why CSS Custom Highlight API for arbitrary selections (and not span-wrapping):** arbitrary pages run their own JS frameworks (React, Vue, etc.). Mutating their DOM with `<span>` wrappers can cause hydration mismatches, focus loss in inputs, or the framework simply re-rendering the wrappers away. Highlight API renders purely on top of the existing DOM via the browser's painting layer — invisible to the page's JS. We accept the loss of one wrapping technique on tweets only because the tweet text container is a DOM region we already injected into and React's tweet timeline doesn't re-render individual tweet text on idle.

**Late-event guard:** every highlighter callback checks `popupAborted` first. `closeMount` sets it to `true` and synchronously calls `CSS.highlights.delete('bcb-translation-hl')` plus removes any `--active` classes from wrapped tweet spans before the popup unmounts.

### 3.4 Settings UI

In `popup/App.tsx`, add a checkbox row below the existing settings:

```
[ ] Translation Highlight
    Hover translated sentences to highlight the original.
    Uses ~10–15% more API tokens.
```

Default unchecked. Stored in `chrome.storage.sync` like all other settings, picked up by `getSettings()` and `onSettingsChange`.

## 4. Data flow

### Flat translate (today; unchanged):

```
[user clicks T] → content-script → background.handleProcess({ mode: translate, text, smartDirection })
  → if smartDirection: targetLang = detect(text) → rule
  → buildTranslatePrompt → provider call → result string
  → cache write → response { ok, result }
  → ResultView renders <pre>{result}</pre>
```

### Segmented translate (new, when toggle ON):

```
[user clicks T] → content-script → background.handleProcess({ mode: translate, text, smartDirection })
  → if smartDirection: targetLang = detect(text) → rule
  → if settings.translationHighlight: buildTranslateSegmentedPrompt + JSON mode
  → provider call → JSON parse → validate (every src is substring; counts match)
    → if invalid: one retry with flat prompt; segments = undefined
  → derive flat `result` from segments; cache write (key has seg=1)
  → response { ok, result, segments }
  → ResultView renders <span data-segment-index>...</span> per tgt
  → on hover: shadow-host CustomEvent → content-script highlighter (A or B based on popup origin)
```

## 5. Error handling

| Failure | Handling |
|---------|----------|
| `detectLanguage` returns `und` for short selection | Fall back to `settings.targetLang`. No user-visible error. |
| Provider returns non-JSON when JSON was requested (own-key path) | One retry with flat prompt. `segments` omitted. Result still shown as plain `<pre>`. Silent fallback. |
| Provider returns non-JSON when JSON was requested (proxy path) | Worker handles the retry server-side; extension sees `{ result, segments: undefined }` and renders flat. |
| `validateSegments` rejects (missing src after normalization, empty array, wrong type) | Same as JSON parse failure. |
| User toggles `translationHighlight` ON after a translation is already cached as flat | New request with same text re-runs through segmented pipeline (different cache key) — expected. |
| Popup unmounted while LLM call is in flight | `chrome.runtime.sendMessage` resolves into a torn-down React tree. Behavior identical to today's flat-mode pipeline; React no-ops the state update. No new code needed. |
| Hover event fires after popup teardown | `popupAborted` flag set in `closeMount` short-circuits the highlighter callback. No DOM/highlight side effects. |
| Selection cleared between popup open and hover (Highlighter B) | Saved Range may now point to detached nodes. `try { ... } catch {}` around Highlight construction → silently no-op. Translation still shown. |
| User scrolls during hover | Highlight stays attached to the original DOM/Range; browser handles repositioning. No special code. |
| Tweet DOM re-renders while spans are wrapped (Highlighter A) | Spans are lost; next hover finds no element with the matching `data-segment-index`; no error, no visible highlight. Acceptable. |
| Hotkey/context-menu invocation with `translationHighlight` ON | `popupOrigin = 'command'` → target spans hoverable but no source highlight (no anchor). Acceptable degradation. |
| Structure-preservation retry would discard segments | Safeguard skipped when `segments !== undefined` (see "Structure-preservation retry interaction" in §3.2). |
| Tweet text passed to backend is normalized (`\n→ ` collapsed) but DOM has raw line breaks | Highlighter A's offset map applies the same normalization when projecting DOM text to the search string, so substring lookup happens in matching coordinates. |

## 6. Testing

### Unit tests

- `lang-detect.test.ts` (existing): add cases for "uk → en target" decision logic in a thin selector function (extract `pickSmartTarget(detected, settings) → string` for testability).
- `prompts.test.ts`: snapshot of `buildTranslateSegmentedPrompt` output for a sample input; verify the schema text in the system prompt is stable.
- `background-handler.test.ts`: with `smartDirection=true` and mocked detector returning `uk` → assert `targetLang` passed downstream is `en`. With detector returning `de` → `uk`. With `und` → `settings.targetLang`.
- `background-handler.test.ts`: with `translationHighlight=true` and mocked provider returning valid JSON → assert `response.segments` is set and `response.result` equals concatenated `tgt`s. With provider returning broken JSON → assert one retry happens with flat prompt and `segments` is omitted.
- New `segments-validate.test.ts`: pure function `validateSegments` exercised across happy path, missing src, empty array, src that's a non-contiguous substring, **typographic-normalization tolerance** (curly quotes, NBSP, ellipsis variants, NFC vs NFD), trailing-punctuation drift on `src`, and adjacent segments with empty separator.
- `tweet-segment-wrap.test.ts`: TreeWalker-based wrap function — given a fixture HTML fragment with mixed text + `<a>` mention + URL chip, and a list of segment src strings whose boundaries cross those inline elements, assert the resulting DOM has the right `bcb-src-seg` spans at the leaf-text level and the projected text reconstruction round-trips. Also assert `unwrapSegmentSpans` restores the original DOM exactly (modulo Text-node merging).

### Integration / manual

- Smart-direction: select Ukrainian, English, Russian, German, French, and a 5-character "hi" snippet — verify each goes to the right target.
- Highlight ON / arbitrary selection: open a Wikipedia article, select a 4-paragraph block, hover each translated sentence, verify the matching original is highlighted under the page text without breaking page layout.
- Highlight ON / inline tweet: open X.com, find a 3+ sentence non-English tweet, click inline Translate, hover each sentence in the result.
- Highlight ON / interaction with the structure-preservation retry path in `handleProcess`: verify segmented mode also benefits from (or is correctly excluded from) the line-break-count safeguard. Decision: the safeguard runs on the flat `result` only; segmented mode's prompt already preserves structure within each `tgt`, and the safeguard's reinforced reminder is appended to the system prompt independent of whether it's segmented or not.
- Toggle OFF after using highlights: verify next translation reverts to plain `<pre>` rendering and no spans/highlights linger.
- Cache: translate same text first with toggle OFF, then ON — verify both results coexist and return from cache on repeat.

## 7. Files affected (predicted, not exhaustive)

| File | Change |
|------|--------|
| `extension/lib/messages.ts` | Add `smartDirection?: boolean` to `ProcessRequest`; add `segments?: Array<{src,tgt}>` to `ProcessResponse`. Update `isProcessRequest` validator. Mirror in worker types. |
| `extension/lib/storage.ts` | Add `translationHighlight: boolean` to `Settings` and `DEFAULTS`. |
| `extension/lib/prompts.ts` | Add `buildTranslateSegmentedPrompt` + JSON schema constant. Mirror in `worker/src/prompts.ts`. |
| `extension/lib/cache.ts` | Extend `getCacheKey` to include `segmented` flag. |
| `extension/lib/background-handler.ts` | Add detection branch for `smartDirection`; add segmented-mode branch; JSON-parse + validate + fallback. |
| `extension/lib/providers/gemini.ts` | Accept optional `jsonMode: { schema }`; flip `responseMimeType` to `application/json` and pass `responseSchema` when set. |
| `extension/lib/providers/groq.ts` | Accept optional `jsonMode: { schema }`; pass `response_format: { type: 'json_object' }` (NOT `json_schema`); embed schema text in system prompt. |
| `extension/lib/providers/proxy.ts` | `ProxyInput` gains `segmented?: boolean`. `ProxyResult` gains `segments?: Array<{src,tgt}>`. Validator accepts the new field. |
| `worker/src/index.ts`, `worker/src/providers/*`, `worker/src/prompts.ts` | Accept `segmented` in request body; build segmented prompt; call provider in JSON mode; run shared `validateSegments`; on failure retry server-side with flat prompt; respond with `{ result, segments?, provider, remainingQuota }`. |
| `extension/lib/segments-validate.ts` (new), `worker/src/segments-validate.ts` (mirrored) | Pure `validateSegments` + `normalizeForMatch` shared between extension and worker. |
| `extension/components/ResultView.tsx` | Conditional rendering: `<pre>` if no segments, else span list with hover dispatch. |
| `extension/components/FloatingButton.tsx` | Pass `smartDirection: true` flag through `onTranslate` callback to the eventual `ProcessRequest`. (Or, more cleanly, the flag is set in the `showPopup` → `ActionPopup` flow when the source was the floating bar.) |
| `extension/components/ActionPopup.tsx` | Thread `smartDirection` from open-time prop into the `chrome.runtime.sendMessage` call. |
| `extension/entrypoints/content.tsx` | Add `popupOrigin` field alongside `mountKind`. Capture `Range` for selection origin at popup open; install Highlighter A wrapper (TreeWalker, NOT `surroundContents`) for tweet origin; listen for `bcb-segment-hover` events from popup shadow root; manage `CSS.highlights` registry on the page document; install `--bcb-hl-accent` CSS var on `document.documentElement`; cleanup + `popupAborted` flag on close. |
| `extension/lib/twitter/injector.ts` | Pass `popupOrigin: 'tweet'` and `tweetTextEl` reference into the popup-open callback. Add `unwrapSegmentSpans` step to `cleanupAllButtons`. |
| `extension/entrypoints/popup/App.tsx` | New checkbox row for `translationHighlight`. |
| `extension/styles/shadow.css` | Style for `.bcb-tgt-seg:hover`, `.bcb-src-seg--active`, `::highlight(bcb-translation-hl)`. |

## 8. Backward compatibility & rollout

- All new fields are additive. Old cached entries (without `seg=1`) remain valid for the flat path; toggling highlight ON triggers fresh requests with the new key — no migration needed.
- A user who never opens settings keeps today's behavior on the inline button. Their `T` button on floating bar gains smart-direction silently — this IS a behavior change for selections of Ukrainian text (today goes to UK→UK no-op, after change goes to UK→EN). Acceptable; the change is in the user's interest and easy to override (Shift selecting / explicit settings — deferred).
- Worker quota / cost: segmented mode is opt-in. Flat mode users see no cost change.

## 9. Open questions / known unknowns

- **Empty / single-sentence input with highlight ON**: result will have `segments: [{src: full, tgt: full}]`. Hover still works; just one highlightable region. Fine.
- **Code blocks / pre-formatted text in selections**: segmenter may treat them as one giant sentence. Acceptable — matches the HARD RULE that code in backticks isn't translated word-by-word.
- **RTL languages (Arabic, Hebrew)**: `franc-min` detects them; rule sends them to `targetLang` (uk). Highlight via Custom Highlight API works in RTL (browser handles bidi). Inline-tweet TreeWalker wrapper may have edge cases — not testing in this iteration.
- **Mixed-language selections (e.g. half English, half Ukrainian quote)**: `detect` returns the dominant language. Rule applies based on dominant. Acceptable; advanced bilingual handling is explicitly out of scope.
- **Groq model JSON-mode evolution**: if a future Groq model gains reliable `json_schema` mode and we want the stricter contract, the provider call signature already supports plumbing it through — only the `groq.ts` body changes. Out of scope for this iteration.
- **Worker-side segmented retries and quota counting**: the proxy currently increments `installId`-keyed quota per request. A worker-side retry from JSON-mode failure to flat would consume two upstream calls but should count as one user-facing request. Decision: count once on the user-facing request boundary, not per upstream call. Worker change is small but explicit.
- **Tweet wrapper persistence across timeline re-render**: X may re-render a tweet's text container on any client-side state change (e.g. like, retweet, view-tracker pings). Wrapped spans then disappear; next hover finds nothing. Acceptable; we do not try to re-wrap on mutation observers.
