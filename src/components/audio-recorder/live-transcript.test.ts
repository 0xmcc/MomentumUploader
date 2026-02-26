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
