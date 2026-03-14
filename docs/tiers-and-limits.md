# Tiers and limits (product)

This doc summarizes how **free vs paid** tiers are (or will be) used in the product. It ties together the voiceover credit system and recording duration limits.

## Voiceover credits and plans

- **Credit system:** 1 credit = 1 minute of processed audio (rounded up). Voiceover generation consumes credits; balance is tied to each user.
- **Plans (from voice-over credit system plan):** Free (2 credits/month), Starter (30), Creator (120), Pro (400), plus one-time top-up packs.
- **Implementation:** See `.specstory/history/2026-02-23_22-52Z-voice-over-credit-system-plan.md` for the full plan (user_subscriptions, voice_credit_transactions, Stripe, etc.). Product todos: [voice-memos/todos.md](../todos.md) (credit system, show cost per voiceover, require consumption).

## Recording duration (free-tier incentive)

- **Intent:** Do **not** apply a global max recording duration for everyone. Use **max recording duration only for free accounts** as an incentive to upgrade; paying users get a higher limit or no limit.
- **Behaviour:** Same as in [edge-cases/recording-duration-and-auto-stop.md](edge-cases/recording-duration-and-auto-stop.md): when the user hits their tier’s limit, auto-stop, finalize, upload, and show a clear message (e.g. “You’ve reached the limit for free accounts. Upgrade to record longer.”).
- **Implementation:** Requires tier awareness (same as credits: subscription/plan per user). Limit and copy derived from tier (e.g. free: 1h, paid: 6h or unlimited). Can be enforced client-side and/or at upload/finalize on the server.
