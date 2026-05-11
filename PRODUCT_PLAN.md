# Short Drama Mini App Plan

## Frontend

- Home: promoted drama, new releases, category rails.
- Dramas: search, category filter, language/region aware listing.
- Player: vertical video area, episode rail, locked/free state, unlock action, favorite count, play count, plot, comments.
- Fandom: guide/profile content tied to dramas.
- Me: TikTok profile authorization, subscription status, watch history, saved dramas, unlocked episodes.
- TikTok Minis adapter: `TTMinis.init`, silent login, explicit profile authorization, navigation bar, rewarded ad unlock, subscription and capability checks.

## CMS

- Drama management: title, cover, banner, description, status, category, tags, language, region.
- Episode management: batch create, upload placeholder, duration, resolution, subtitle languages, free/paid state.
- Monetization: free trial episode count, rewarded-ad unlock switch, subscription switch. Payment is disabled for this phase.
- Users: balance, favorites, watch history, unlocked episodes.
- Finance: recharge, consumption, order mapping, refund state in later backend.
- Comments: visible, pending, hidden moderation states.
- Analytics: plays, favorites, comments, completion rate, recharge and consumption totals.

## Data Model

- `dramas`: metadata, review status, language, region, monetization settings, aggregate stats.
- `episodes`: drama ID, number, duration, resolution, price, free flag, media/subtitle references.
- `users`: TikTok `open_id` mapping, authorized profile, language, region, subscription status, favorites, watch progress.
- `transactions`: rewarded-ad unlock and future subscription/order ledger.
- `comments`: episode-level comments with moderation status.
- `fandom`: editorial content connected to dramas.

## TikTok Review Notes

- Keep the user-facing mini app localized for the launch region.
- Avoid Chinese characters in production frontend assets/text for non-Chinese regions.
- Ensure at least 20 dramas before formal acceptance if applying the industry rule literally.
- For each completed drama, keep episode count, duration and playable media complete.
- Unlock fulfillment must happen only after the rewarded ad completion callback.
- iOS and Android behavior should stay materially consistent.
