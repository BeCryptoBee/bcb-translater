export const TWEET_SELECTORS = {
  // Primary: stable testid used by X
  text: '[data-testid="tweetText"]',
  // Fallback: structural — within an article role, the lang-bearing block
  textFallback: 'article [lang]',
} as const;
