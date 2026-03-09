import { mergeLiveTranscript } from "./live-transcript";

describe("mergeLiveTranscript", () => {
  it("replaces earlier no-space hypothesis when resend corrects beginning", () => {
    const previous =
      "steadof,youknow,respectingtheissue.Idon'treallyknow.IwanttosayisthatevenifIkeeptalking,thelongerIgothemorethehigherlikelihoodthatitwilljustduplicatethetranscripts.";
    const incoming =
      "Insteadof,youknow,respectingtheissue.Idon'treallyknow.WhatImeantosayisthatwhenItalkextended.TheduplicationscomebackifItalkforashortamount.oftime.Idon'tthinkthere'smuchduplication.butifIjustkeeptalkingwithoutstopping,thentheduplicationshappen.";

    const merged = mergeLiveTranscript(previous, incoming);
    expect(merged.startsWith("Insteadof,youknow,respectingtheissue.")).toBe(true);
  });

  it("does not duplicate shared clause across no-space long resend windows", () => {
    const parts = [
      "steadof,youknow,respectingtheissue.Idon'treallyknow.IwanttosayisthatevenifIkeeptalking,thelongerIgothemorethehigherlikelihoodthatitwilljustduplicatethetranscripts.",
      "Insteadof,youknow,respectingtheissue.Idon'treallyknow.WhatImeantosayisthatwhenItalkextended.TheduplicationscomebackifItalkforashortamount.oftime.Idon'tthinkthere'smuchduplication.butifIjustkeeptalkingwithoutstopping,thentheduplicationshappen.",
      "Iwantyoutowriteyourfeeling.Iwantyoutowritefailingtest.Teststhattrytoreproducethebug.Iwantyoutowritefailingtests.Testthattrytoreproducethebug.Iwantyoutowritefailingtests.Teststhattrytoreproducethebug.",
    ];

    const merged = parts.reduce((acc, text) => mergeLiveTranscript(acc, text), "");
    const repeatedClause = "youknow,respectingtheissue.idon'treallyknow";
    const occurrences = merged.toLowerCase().split(repeatedClause).length - 1;

    expect(occurrences).toBe(1);
  });

  it("collapses repeated no-space cutoff windows to one phrase", () => {
    const parts = [
      "ug.Hamburger",
      "HamburgerPi",
      "HamburgerHamburgerpizza",
      ".Pineapplehouse",
      ".F",
      "Hamburgerpizza.Pineapplehouse",
      ".Frenchfriedmilkshake.",
      "Pineapplehouse.Frenchfriedmilk.AppleHouse.Frenchfriedmilkshake.",
    ];

    const merged = parts.reduce((acc, text) => mergeLiveTranscript(acc, text), "");
    const normalized = merged.toLowerCase();
    const pineappleOccurrences = normalized.split("pineapplehouse").length - 1;
    const friesOccurrences = normalized.split("frenchfriedmilkshake").length - 1;

    expect(pineappleOccurrences).toBe(1);
    expect(friesOccurrences).toBe(1);
  });
});

// These tests represent the gapped-window overflow scenario (recordings > 30 seconds).
// When chunks.length > LIVE_MAX_CHUNKS, the snapshot sent to RIVA contains chunk[0]
// (first second of audio + WebM headers) + last 29 chunks — creating a gap in the middle.
// RIVA transcribes "opening words + recent tail", which must NOT be appended to prev.
// Root-cause fix: separate WebM header blob so the overflow snapshot has no audio gap.
// These tests also gate the guardrail in mergeLiveTranscript (defense-in-depth).
describe("mergeLiveTranscript — gapped-window resend (>30 chunk overflow)", () => {
  it("does not duplicate opening phrase when gapped snapshot re-sends beginning + recent tail", () => {
    // RIVA receives [second 0] + [seconds 16–44]: returns opening phrase + tail, missing middle
    const prev =
      "Opening phrase, let me walk you through the plan. " +
      "First we need to consider X. Then we look at Y. " +
      "The key insight here is Z. So in summary the approach is solid.";
    const next = "Opening phrase, in summary the approach is solid.";

    const merged = mergeLiveTranscript(prev, next);
    expect(merged).toBe(prev);
  });

  it("does not duplicate when gapped resend repeats opening across multiple ticks", () => {
    // Simulates growing-window ticks where tick 4 is a gapped overflow snapshot
    const ticks = [
      "Hello and welcome to today's session.",
      "Hello and welcome to today's session. Let me start with the background.",
      "Hello and welcome to today's session. Let me start with the background. There are three main points.",
      // Tick 4: overflow — RIVA gets [second 0] + [seconds 2–3], missing second 1
      "Hello and welcome to today's session. There are three main points.",
    ];

    const merged = ticks.reduce((acc, text) => mergeLiveTranscript(acc, text), "");
    const openingCount = merged.split("Hello and welcome").length - 1;
    expect(openingCount).toBe(1);
  });

  it("does not append gapped result when next is shorter and its tail is already in prev", () => {
    const prev =
      "So the thing I wanted to talk about is the new feature we shipped. " +
      "It took about three weeks to build and involved a complete rewrite. " +
      "The end result is much cleaner code and faster performance.";
    // Gapped snapshot: RIVA got opening second + last few seconds only
    const next = "So the thing I wanted to talk about is faster performance.";

    const merged = mergeLiveTranscript(prev, next);
    expect(merged).toBe(prev);
  });

  it("appends only new tail without duplicating opening phrase (new content after gapped resend)", () => {
    // prev has 40+ seconds of accumulated speech; next is a gapped snapshot:
    // RIVA received [second 0] + [brand-new last few seconds] — the tail is genuinely new.
    // The algorithm must NOT duplicate the opening phrase while still capturing the new words.
    const prev =
      "Opening statement. Then I talked about A. Then B. Then C. Then D.";
    const next =
      "Opening statement. Completely new words just spoken now.";

    const merged = mergeLiveTranscript(prev, next);
    // Opening phrase must appear exactly once
    const openingCount = merged.split("Opening statement.").length - 1;
    expect(openingCount).toBe(1);
    // New content must be preserved
    expect(merged.toLowerCase()).toContain("completely new words just spoken now");
  });

  it("does not append a long hidden-window resend that reintroduces a repeated middle clause with minor wording drift", () => {
    const prev =
      "Are you recording now? Testing. Testing. Come on, you gotta be working. " +
      "I need you like God needs the devil on a Sunday soon this do' settle. " +
      "Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking. " +
      "And hopefully this keeps recording.";
    const next =
      "Wow. Whoa, whoa, whoa. Come on, you gotta be working. " +
      "I need you like God needs the devil on a Sunday Soon this settle. " +
      "Okay, I'm wondering if this is gonna still work. Is this gonna still work? " +
      "We're gonna keep trying and talking. And hopefully this keeps recording. " +
      "Wowzers, the app is working.";

    const merged = mergeLiveTranscript(prev, next);
    const repeatedClause = "come on, you gotta be working";
    const repeatedClauseOccurrences = merged.toLowerCase().split(repeatedClause).length - 1;

    expect(repeatedClauseOccurrences).toBe(1);
    expect(merged.toLowerCase()).toContain("wowzers, the app is working");
  });

  it("does not accept a longer hidden-window hypothesis that already contains a duplicated clause internally", () => {
    const prev =
      "Are you recording now? Testing. Testing. Come on, you gotta be working. " +
      "I need you like God needs the devil on a Sunday soon this do' settle. " +
      "Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking.";
    const next =
      "Are you recording now? Testing. Testing. Come on, you gotta be working. " +
      "I need you like God needs the devil on a Sunday soon this do' settle. " +
      "Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking. " +
      "Come on, you gotta be working. I need you like God needs the devil on a Sunday soon this do' settle. " +
      "Okay, I'm wondering if this is gonna still work? We're gonna keep trying and talking. " +
      "And hopefully this keeps recording.";

    const merged = mergeLiveTranscript(prev, next);
    const repeatedClause = "come on, you gotta be working";
    const repeatedClauseOccurrences = merged.toLowerCase().split(repeatedClause).length - 1;

    expect(repeatedClauseOccurrences).toBe(1);
    expect(merged.toLowerCase()).toContain("and hopefully this keeps recording");
  });
});
