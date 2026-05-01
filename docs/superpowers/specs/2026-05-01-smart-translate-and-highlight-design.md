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
- Segmented translation pipeline (gated by `translationHighlight === true`): new `buildTranslateSegmentedPrompt` that asks the model to return a JSON array `[{ "src": "...", "tgt": "..." }, ...]` with 1-to-1 sentence mapping; provider calls forced into JSON mode (Gemini `responseSchema`, Groq `response_format: json_schema`).
- `ProcessResponse.segments?: Array<{ src: string; tgt: string }>`. When present, `ResultView` renders translated sentences as hoverable spans; when absent (default flat translation), it renders as today.
- Cache-key bump: include a `seg=1` flag so segmented and flat results never alias.
- Source-side highlight in the page:
  - **Inline tweets**: one-time wrap of the tweet text node into per-sentence spans (TextNode walker + `Range.surroundContents`); hover toggles a CSS class on the matching span.
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

**Provider JSON mode:**

- Gemini: pass `responseSchema` with the segments array + `responseMimeType: 'application/json'`.
- Groq: pass `response_format: { type: 'json_schema', json_schema: {...} }`.
- Proxy worker: forwards the same JSON-mode flag to whichever upstream provider it picked.

**Parsing & fallback:**

1. Parse response as JSON. If parse fails or schema validation fails → **single retry** with the flat-translate prompt (no JSON mode) and return `segments: undefined`. Surface a one-time warning to the user via popup state ("Highlight unavailable for this translation").
2. If `segments` array is empty or any `src` cannot be found in the source text by exact substring match → fallback as above. We intentionally do NOT do fuzzy matching — silent misalignment would be worse than no highlight.
3. Build a derived flat `result` string by joining all `tgt` values with the same between-sentence whitespace as the source. This becomes `ProcessResponse.result`, so callers that don't care about segments still work.

**Cache key:** existing `getCacheKey({ mode, text, targetLang })` becomes `getCacheKey({ mode, text, targetLang, segmented: boolean })`. The `segmented` boolean is stringified into the key. Both flavors can coexist for the same input.

### 3.3 Source highlight in the page (Feature 2 — UI)

`ResultView` rendering:

- When `resp.segments` is present: render each `tgt` as a `<span class="bcb-tgt-seg" data-segment-index={i}>{tgt}</span>` separated by the same between-sentence whitespace used to build the flat string. The wrapping `<pre style="white-space: pre-wrap">` is preserved so multi-line structure still renders.
- `mouseenter`/`mouseleave` on a span dispatches a CustomEvent on the shadow root: `bcb-segment-hover` with `{ index, src, action: 'enter' | 'leave' }`. The content-script listens for it on the mount's shadow host.

Content-script side, two highlighters:

**Highlighter A — inline tweet:**

- When the popup is shown via the inline-tweet path, content-script remembers the `tweetTextEl` it was opened from.
- On the FIRST hover event for that popup, it walks `tweetTextEl`'s text nodes, splits them by the segment `src` boundaries, and wraps each segment in `<span class="bcb-src-seg" data-segment-index={i}>`. This mutates the tweet DOM, but only inside the existing text container (no structural change React would care about).
- On hover-enter: add class `bcb-src-seg--active` to the matching span. On hover-leave: remove it.
- On popup close: leave the spans in place (they're invisible without the `--active` class). They'll be replaced naturally when X re-renders the timeline.

**Highlighter B — arbitrary selection:**

- When the popup is shown via the floating-bar path, content-script captures `window.getSelection().getRangeAt(0).cloneRange()` BEFORE mounting the popup (because mounting steals focus and may collapse the selection). Stored in a closure variable for the popup's lifetime.
- On hover-enter: scan the saved Range's text content for the segment `src` (linear `indexOf` from the start of the Range), build a new Range bounded by the text-node offsets of that match, and register it via `CSS.highlights.set('bcb-translation-hl', new Highlight(range))`.
- On hover-leave or popup close: `CSS.highlights.delete('bcb-translation-hl')`.
- Required CSS (injected once into `document.adoptedStyleSheets`): `::highlight(bcb-translation-hl) { background-color: color-mix(in srgb, <accent> 35%, transparent); }`.
- Browser support: Chrome 105+ (released 2022). The extension's manifest already targets MV3 / Chrome ≥ 102 — we bump the effective floor to 105. Acceptable, no Firefox MV3 support yet anyway.

**Why CSS Custom Highlight API and not span-wrapping for arbitrary selections:** arbitrary pages run their own JS frameworks (React, Vue, etc.). Mutating their DOM with `<span>` wrappers can cause hydration mismatches, focus loss in inputs, or the framework simply re-rendering the wrappers away. Highlight API renders purely on top of the existing DOM via the browser's painting layer — invisible to the page's JS.

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
| Provider returns non-JSON when JSON was requested | One retry with flat prompt. `segments` omitted. Result still shown. Optional toast: "Highlights unavailable for this translation." |
| `segments` array contains an `src` that's not in the source text | Treat entire response as invalid → fallback as above. Better no highlight than misaligned highlight. |
| User toggles `translationHighlight` ON after a translation is already cached as flat | New request with same text re-runs through segmented pipeline (different cache key) — expected. |
| Selection cleared between popup open and hover (Highlighter B) | Saved Range may now point to detached nodes. `try { CSS.highlights.set(...) } catch {}` — silently no-op. The popup still shows the translation. |
| User scrolls during hover (Highlighter A or B) | Highlight stays attached to the original DOM/Range; browser handles the repositioning. No special code. |
| Tweet DOM re-renders while spans are wrapped (Highlighter A) | Spans are lost; next hover finds no element with that `data-segment-index`; no error, just no visible highlight. Acceptable. |

## 6. Testing

### Unit tests

- `lang-detect.test.ts` (existing): add cases for "uk → en target" decision logic in a thin selector function (extract `pickSmartTarget(detected, settings) → string` for testability).
- `prompts.test.ts`: snapshot of `buildTranslateSegmentedPrompt` output for a sample input; verify the schema text in the system prompt is stable.
- `background-handler.test.ts`: with `smartDirection=true` and mocked detector returning `uk` → assert `targetLang` passed downstream is `en`. With detector returning `de` → `uk`. With `und` → `settings.targetLang`.
- `background-handler.test.ts`: with `translationHighlight=true` and mocked provider returning valid JSON → assert `response.segments` is set and `response.result` equals concatenated `tgt`s. With provider returning broken JSON → assert one retry happens with flat prompt and `segments` is omitted.
- New `segments-validate.test.ts`: pure function `validateSegments(segments, sourceText) → { ok, derivedFlat? } | { ok: false }` exercised across happy path, missing src, empty array, src that's a non-contiguous substring.

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
| `extension/lib/messages.ts` | Add `smartDirection?: boolean` to `ProcessRequest`; add `segments?: Array<{src,tgt}>` to `ProcessResponse`. Mirror in worker types if shared. |
| `extension/lib/storage.ts` | Add `translationHighlight: boolean` to `Settings` and `DEFAULTS`. |
| `extension/lib/prompts.ts` | Add `buildTranslateSegmentedPrompt` + JSON schema constant. Mirror in `worker/src/prompts.ts`. |
| `extension/lib/cache.ts` | Extend `getCacheKey` to include `segmented` flag. |
| `extension/lib/background-handler.ts` | Add detection branch for `smartDirection`; add segmented-mode branch; JSON-parse + validate + fallback. |
| `extension/lib/providers/gemini.ts`, `groq.ts`, `proxy.ts` | Accept optional `jsonSchema` parameter and pass it through to the upstream provider config. |
| `worker/src/index.ts`, `worker/src/providers/*` | Mirror JSON-mode pass-through. |
| `extension/components/ResultView.tsx` | Conditional rendering: `<pre>` if no segments, else span list with hover dispatch. |
| `extension/components/FloatingButton.tsx` | Pass `smartDirection: true` flag through `onTranslate` callback to the eventual `ProcessRequest`. (Or, more cleanly, the flag is set in the `showPopup` → `ActionPopup` flow when the source was the floating bar.) |
| `extension/components/ActionPopup.tsx` | Thread `smartDirection` from open-time prop into the `chrome.runtime.sendMessage` call. |
| `extension/entrypoints/content.tsx` | Capture `Range` for arbitrary selections at popup open; install Highlighter A wrapper for tweet path; listen for `bcb-segment-hover` events from popup shadow root; manage `CSS.highlights` registry; cleanup on close. |
| `extension/entrypoints/popup/App.tsx` | New checkbox row for `translationHighlight`. |
| `extension/styles/shadow.css` | Style for `.bcb-tgt-seg:hover`, `.bcb-src-seg--active`, `::highlight(bcb-translation-hl)`. |

## 8. Backward compatibility & rollout

- All new fields are additive. Old cached entries (without `seg=1`) remain valid for the flat path; toggling highlight ON triggers fresh requests with the new key — no migration needed.
- A user who never opens settings keeps today's behavior on the inline button. Their `T` button on floating bar gains smart-direction silently — this IS a behavior change for selections of Ukrainian text (today goes to UK→UK no-op, after change goes to UK→EN). Acceptable; the change is in the user's interest and easy to override (Shift selecting / explicit settings — deferred).
- Worker quota / cost: segmented mode is opt-in. Flat mode users see no cost change.

## 9. Open questions / known unknowns

- **Empty / single-sentence input with highlight ON**: result will have `segments: [{src: full, tgt: full}]`. Hover still works; just one highlightable region. Fine.
- **Code blocks / pre-formatted text in selections**: segmenter may treat them as one giant sentence. Acceptable — matches the HARD RULE that code in backticks isn't translated word-by-word.
- **RTL languages (Arabic, Hebrew)**: `franc-min` detects them; rule sends them to `targetLang` (uk). Highlight via Custom Highlight API works in RTL (browser handles bidi). Inline-tweet wrapper may have edge cases — not testing in this iteration.
- **Mixed-language selections (e.g. half English, half Ukrainian quote)**: `detect` returns the dominant language. Rule applies based on dominant. Acceptable; advanced bilingual handling is explicitly out of scope.
