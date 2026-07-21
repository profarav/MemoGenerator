/**
 * What Hugh's team offers.
 *
 * This is injected into memo generation so QUESTIONS TO ASK and KEY TALKING
 * POINTS are angled toward uncovering fit for these services — the way a rep
 * who knows what they're selling would prep. It does NOT make the memo pitchy;
 * the questions stay discovery-oriented, just pointed in the right direction.
 *
 * To change it, edit the default below or set the OFFERING_DESCRIPTION env var
 * (in .env.local locally, and in the Vercel project settings for production).
 * Keep it a plain, specific description — no marketing language.
 */
export const OFFERING_DESCRIPTION =
  process.env.OFFERING_DESCRIPTION?.trim() ||
  `A creative and paid media agency. We help brands with (1) creative production — video, brand, and ad creative — and (2) paid media strategy and execution — channel mix, media buying, and performance optimization. Engagements often span both. We support customer acquisition, and for marketplaces, growth on both the supply and demand sides.`
