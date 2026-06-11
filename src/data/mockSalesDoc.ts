import type { SalesDoc, SalesSession } from "./salesDocTypes";

/**
 * Mock SalesDoc data. Stands in for the future AI/RAG generation pipeline —
 * see salesDocTypes.ts for the contract. Two full documents prove the UI is
 * data-driven, not hardcoded to one prospect.
 */

export const alexSalesDoc: SalesDoc = {
  documentMetadata: {
    id: "doc_alex_fitness_001",
    title: "Alex — Fitness Coach Discovery Call",
    status: "generated",
    generatedAt: "2 min ago",
    updatedAt: "2 min ago",
  },

  prospect: {
    name: "Alex",
    businessType: "Fitness Coaching",
    offer: "1:1 Coaching",
    pricePoint: "$3,500",
    mainChallenge: "Inconsistent leads, low close rate (10–15%)",
    callGoal: "Close as ideal client",
    stage: "Discovery",
  },

  sourceInputs: {
    prompt:
      "I have a discovery call tomorrow with Alex. He runs a fitness coaching business, does 1:1 coaching at $3,500. His biggest challenges are inconsistent leads and closing calls. He's currently closing about 10–15% of his calls.",
  },

  callBrief: {
    title: "Executive Call Brief",
    summary:
      "Alex runs a 1:1 fitness coaching business at a $3,500 price point. His revenue is unpredictable because lead flow is inconsistent and his discovery calls convert at only 10–15%. He is likely working hard on delivery but has no repeatable sales system — every call is improvised. The opportunity on this call is to surface the real cost of staying stuck, position a 4-step system as the missing structure, and close him as an ideal client while the pain is concrete.",
    objective:
      "Run a full Belief Ladder discovery, quantify the cost of his current close rate, and present the offer only after Pain, Doubt, and Cost are locked in.",
    keyFacts: [
      { label: "Business", value: "Fitness Coaching" },
      { label: "Offer", value: "1:1 Coaching" },
      { label: "Price", value: "$3,500" },
      { label: "Main Challenge", value: "Inconsistent leads, low close rate" },
      { label: "Call Goal", value: "Close as ideal client" },
    ],
  },

  salesDiagnosis: {
    title: "Sales Diagnosis",
    summary:
      "A 10–15% close rate at $3,500 almost always points to a process problem, not a traffic problem: Alex is likely pitching before the prospect believes the problem is urgent, so price objections are really priority objections. Fixing lead consistency without fixing the call structure would just feed more leads into a leaky funnel. The diagnosis to validate on the call: he has no diagnosis step of his own — he sells the program, not the gap.",
    likelyGaps: [
      {
        label: "No discovery structure",
        description:
          "Calls jump from rapport to pitch with no belief-building in between, so objections surface at the close instead of being pre-handled.",
      },
      {
        label: "Pitching features, not the gap",
        description:
          "Alex sells training quality rather than the cost of the prospect staying stuck, which caps urgency at $3,500.",
      },
      {
        label: "Lead flow masking the real issue",
        description:
          "Inconsistent leads get the blame, but doubling close rate would out-earn doubling traffic at zero extra cost.",
      },
    ],
  },

  beliefLadder: [
    {
      id: "pain",
      label: "Pain",
      status: "covered",
      goal: "Uncover the core problem and make its day-to-day impact concrete.",
      questions: [
        {
          id: "pain_q1",
          text: "Walk me through what happened on your last three discovery calls — where did they fall apart?",
          reason: "Forces specifics instead of the rehearsed 'leads are inconsistent' story.",
          priority: "high",
        },
        {
          id: "pain_q2",
          text: "When a month starts slow, what does that do to how you coach and how you sell?",
          priority: "medium",
        },
        {
          id: "pain_q3",
          text: "How long has the close rate been sitting at 10–15%?",
          priority: "medium",
        },
      ],
    },
    {
      id: "doubt",
      label: "Doubt",
      status: "covered",
      goal: "Explore why he hasn't been able to solve this alone.",
      questions: [
        {
          id: "doubt_q1",
          text: "What have you already tried to fix the close rate — scripts, courses, more follow-up?",
          reason: "Each failed attempt is evidence that effort alone isn't the answer.",
          priority: "high",
        },
        {
          id: "doubt_q2",
          text: "Why do you think those didn't stick?",
          priority: "medium",
        },
      ],
    },
    {
      id: "cost",
      label: "Cost",
      status: "needs_work",
      goal: "Quantify the cost of staying stuck at the current close rate.",
      questions: [
        {
          id: "cost_q1",
          text: "If 8 out of 10 calls keep ending in 'let me think about it', what does that cost you over the next 12 months?",
          reason: "Turns a vague frustration into a five-figure number he says out loud.",
          priority: "high",
        },
        {
          id: "cost_q2",
          text: "What's the knock-on cost — the clients you'd refer, the price raise you keep postponing?",
          priority: "medium",
        },
        {
          id: "cost_q3",
          text: "What happens to the business if this is still true a year from now?",
          priority: "high",
        },
      ],
    },
    {
      id: "desire",
      label: "Desire",
      status: "not_covered",
      goal: "Get him to articulate the specific business he actually wants.",
      questions: [
        {
          id: "desire_q1",
          text: "If the calendar were full and 1 in 3 calls closed, what would a normal month look like for you?",
          priority: "high",
        },
        {
          id: "desire_q2",
          text: "What would you do with the time you currently spend chasing leads?",
          priority: "low",
        },
      ],
    },
    {
      id: "money",
      label: "Money",
      status: "not_covered",
      goal: "Assess resources and willingness to invest before the pitch.",
      questions: [
        {
          id: "money_q1",
          text: "When you've invested in the business before, how did you decide it was worth it?",
          priority: "medium",
        },
        {
          id: "money_q2",
          text: "If this added two extra closes a month, what's that worth to you?",
          priority: "high",
        },
      ],
    },
    {
      id: "support",
      label: "Support",
      status: "not_covered",
      goal: "Surface partner/spouse buy-in before it becomes a close-killer.",
      questions: [
        {
          id: "support_q1",
          text: "Is there anyone else who weighs in on investments like this?",
          priority: "high",
        },
        {
          id: "support_q2",
          text: "What would they need to see to be excited about this?",
          priority: "medium",
        },
      ],
    },
    {
      id: "trust",
      label: "Trust",
      status: "not_covered",
      goal: "Build trust in the method, not just the person.",
      questions: [
        {
          id: "trust_q1",
          text: "What would you need to see in the first 30 days to know this was the right call?",
          priority: "high",
        },
        {
          id: "trust_q2",
          text: "Have you worked with a coach or program before? What made it work or not work?",
          priority: "medium",
        },
      ],
    },
  ],

  pitchScript: {
    highLevelPromise: {
      title: "High-Level Promise",
      script:
        "Alex, based on everything you've told me, here's what I'd propose: a proven 4-step system that takes you from inconsistent leads and a 10–15% close rate to 30%+ closes and predictable $20K+ months — without adding a single hour of extra work to your week.",
      coachNotes: [
        "Deliver in under 15 seconds, then stop talking.",
        "Use his own numbers — '10–15%' must come from his mouth first.",
      ],
    },
    bridgePillars: [
      {
        id: "pillar_position",
        title: "Pillar 1 — Position the offer",
        script:
          "First, we reposition your 1:1 offer so ideal clients self-select before the call. Right now you're convincing; we want them pre-sold.",
        coachNotes: ["Tie back to his Pain answer about calls falling apart early."],
      },
      {
        id: "pillar_leads",
        title: "Pillar 2 — Attract qualified leads consistently",
        script:
          "Second, we install one repeatable lead channel instead of the feast-or-famine mix you described — one channel, measured weekly, until it's boring.",
        coachNotes: ["'Boring' lands well with operators tired of hustle."],
      },
      {
        id: "pillar_discovery",
        title: "Pillar 3 — Run high-converting discovery calls",
        script:
          "Third, you get the exact discovery structure we just went through — the same Belief Ladder — so every call follows the same path instead of being improvised.",
      },
      {
        id: "pillar_close",
        title: "Pillar 4 — Close 30%+ without being pushy",
        script:
          "And fourth, a close that feels like a natural next step, because by then the prospect has already said the cost of staying stuck out loud.",
        coachNotes: ["Pause here. Let him connect it to this very call."],
      },
    ],
    delivery: {
      title: "Delivery",
      script:
        "Over the next 90 days I'll show you exactly how each step works — the frameworks, the scripts, and the systems we use to get you predictable results. You're not buying information; you're installing a sales system with someone in your corner on every call review.",
      coachNotes: [
        "2–3 minutes max. If he asks logistics questions, he's buying — move to commitment.",
      ],
    },
  },

  objectionPrep: [
    {
      id: "obj_think",
      objection: "I need to think about it",
      likelyMeaning:
        "A belief is missing — usually Cost or Trust. He doesn't yet feel that waiting is the expensive option.",
      isolateQuestion:
        "Totally fair. So I make sure I answered everything — what specifically do you want to think through: the money, the time, or whether it'll work for you?",
      recommendedResponse:
        "Anchor back to his own numbers: 'You told me the current close rate is costing you roughly $40K a year. Thinking about it for three months costs $10K. What would need to be true for this to be a yes today?'",
      fallbackQuestion: "If we removed that one concern completely, is there anything else?",
    },
    {
      id: "obj_money",
      objection: "It's a lot of money",
      likelyMeaning:
        "He's comparing the price to $0 (doing nothing) instead of to the cost of staying stuck.",
      isolateQuestion:
        "Is it the amount itself, or whether the return shows up fast enough?",
      recommendedResponse:
        "Reframe the comparison: 'Two extra closes a month at $3,500 pays for this in the first 30 days. The expensive option is the 8 calls a month that keep ending in no.'",
    },
    {
      id: "obj_spouse",
      objection: "I need to ask my spouse",
      likelyMeaning:
        "Either genuine shared finances, or a polite exit. Support belief wasn't built early enough.",
      isolateQuestion:
        "Of course. If they said 'do whatever you think is right' — would this be a yes for you personally?",
      recommendedResponse:
        "Get his personal yes first, then equip him: 'What questions will they ask? Let's answer those together now so you're not selling this alone tonight.'",
      fallbackQuestion: "Would it help to get them on a quick call together tomorrow?",
    },
    {
      id: "obj_work",
      objection: "What if this doesn't work?",
      likelyMeaning:
        "Trust gap — he's been burned by a course or program before and is projecting that experience.",
      isolateQuestion:
        "Good question. What happened the last time you invested in something that didn't work?",
      recommendedResponse:
        "Differentiate the mechanism: 'That program gave you information and left you alone. This is a system plus call reviews every week — the opposite of what failed you. The first 30 days alone fix the discovery structure.'",
    },
  ],

  callFlow: [
    {
      id: "flow_frame",
      step: "Frame",
      goal: "Set the agenda and get permission to ask hard questions.",
      talkTrack:
        "By the end of this call we'll both know if this is a fit. If it's not, I'll tell you. Fair?",
    },
    {
      id: "flow_current",
      step: "Current Situation",
      goal: "Map the business as it actually runs today.",
      talkTrack: "Give me the honest picture — leads, calls, closes, revenue.",
    },
    {
      id: "flow_pain",
      step: "Widen Pain",
      goal: "Move from facts to felt cost. Get specifics from the last three calls.",
    },
    {
      id: "flow_doubt",
      step: "Doubt",
      goal: "Surface failed attempts so effort alone stops being a viable plan.",
    },
    {
      id: "flow_outcome",
      step: "Desired Outcome",
      goal: "Have him describe the predictable $20K month in his own words.",
    },
    {
      id: "flow_transition",
      step: "Transition",
      goal: "Get explicit permission to present.",
      talkTrack:
        "Based on what you've shared, I know exactly what's broken. Want me to walk you through how we'd fix it?",
    },
    {
      id: "flow_pitch",
      step: "Pitch",
      goal: "Promise → 4 pillars → delivery. Under 5 minutes total.",
    },
    {
      id: "flow_commit",
      step: "Commit",
      goal: "Direct close, then silence. Handle objections by isolating, not arguing.",
      talkTrack: "It sounds like this is exactly what you've been missing. Ready to get started?",
    },
  ],

  nextBestQuestions: [
    {
      id: "nbq_cost",
      question:
        "What's the cost of staying in this situation for another 6–12 months?",
      why: "Cost is the weakest belief right now — he hasn't said a number out loud yet.",
      useCase: "discovery",
    },
    {
      id: "nbq_calls",
      question:
        "Of the last 10 discovery calls you ran, how many ended with 'let me think about it'?",
      why: "Converts the abstract close-rate problem into a vivid, recent memory.",
      useCase: "discovery",
    },
    {
      id: "nbq_process",
      question:
        "Do you currently follow any structure on your sales calls, or does each one go its own way?",
      why: "Sets up the contrast with the Belief Ladder structure before the pitch.",
      useCase: "transition",
    },
  ],

  liveCoaching: {
    mode: "demo",
    statusLabel: "Listening...",
    timer: "01:24",
    waveform: [
      0.3, 0.55, 0.8, 0.45, 0.65, 0.9, 0.5, 0.7, 0.35, 0.6, 0.85, 0.4, 0.75,
      0.55, 0.3, 0.65, 0.5, 0.8, 0.45, 0.6, 0.35, 0.7, 0.55, 0.4,
    ],
    insights: [
      {
        id: "ins_pain",
        type: "positive",
        text: "Great job uncovering the problem impact",
        relatedBelief: "pain",
      },
      {
        id: "ins_life",
        type: "positive",
        text: "Ask about how this affects other areas of his life",
        relatedBelief: "pain",
      },
      {
        id: "ins_leads",
        type: "positive",
        text: "Don't forget to chunk down on current leads numbers",
        relatedBelief: "doubt",
      },
      {
        id: "ins_process",
        type: "suggestion",
        text: "Consider asking about his current sales process",
        relatedBelief: "cost",
        priority: "high",
      },
    ],
    beliefProgress: [
      { beliefId: "pain", label: "Pain", status: "complete" },
      { beliefId: "doubt", label: "Doubt", status: "complete" },
      { beliefId: "cost", label: "Cost", status: "active" },
      { beliefId: "desire", label: "Desire", status: "incomplete" },
      { beliefId: "money", label: "Money", status: "incomplete" },
      { beliefId: "support", label: "Support", status: "incomplete" },
      { beliefId: "trust", label: "Trust", status: "incomplete" },
    ],
    nextSuggestedQuestion: {
      question:
        "What's the cost of staying in this situation for another 6–12 months?",
      reason: "Cost belief is active but unquantified — get a number before moving to Desire.",
    },
  },
};

export const saasFounderSalesDoc: SalesDoc = {
  documentMetadata: {
    id: "doc_saas_founder_001",
    title: "Priya — SaaS Founder Scaling Call",
    status: "generated",
    generatedAt: "1 day ago",
    updatedAt: "4 hours ago",
  },

  prospect: {
    name: "Priya",
    businessType: "B2B SaaS — Analytics",
    offer: "Founder-led annual plan",
    pricePoint: "$18,000 / yr",
    mainChallenge: "Founder is the only closer; demos stall in procurement",
    callGoal: "Book paid pilot with exec sponsor",
    stage: "Scaling",
  },

  sourceInputs: {
    prompt:
      "Call with Priya, founder of an analytics SaaS at ~$40K MRR. She closes every deal herself, demos go well but stall in procurement for months. Average deal is $18K/year. Goal is to get her into the GTM advisory program.",
  },

  callBrief: {
    title: "Executive Call Brief",
    summary:
      "Priya has real product pull — $40K MRR closed entirely founder-led — but every deal routes through her calendar and dies in procurement. Demos convert interest, not urgency: there's no exec sponsor, no compelling event, and no mutual close plan, so deals drift 90+ days. The opportunity is to reframe her problem from 'I need more pipeline' to 'I need a repeatable enterprise motion', then book a paid pilot of the advisory program with a concrete 90-day close-plan deliverable.",
    objective:
      "Diagnose the stalled-deal pattern, quantify the pipeline rotting in procurement, and close a paid pilot with a defined 90-day outcome.",
    keyFacts: [
      { label: "Business", value: "B2B SaaS — Analytics" },
      { label: "Revenue", value: "$40K MRR, founder-led" },
      { label: "Deal size", value: "$18,000 / yr average" },
      { label: "Main Challenge", value: "Deals stall in procurement 90+ days" },
      { label: "Call Goal", value: "Book paid pilot with exec sponsor" },
    ],
  },

  salesDiagnosis: {
    title: "Sales Diagnosis",
    summary:
      "Stalled procurement is a symptom: Priya is selling to users, not buyers, so nobody inside the account is paid to push the deal through. Her demos prove the product works but never establish the cost of the status quo, which is what an economic buyer needs to spend $18K. The gap to validate: she has no mutual action plan or champion-enablement step — every deal depends on her personally following up.",
    likelyGaps: [
      {
        label: "No economic buyer in the room",
        description:
          "Demos run with end users; procurement is the first time an exec sees the deal, and they see it cold.",
      },
      {
        label: "Demo-first, diagnosis never",
        description:
          "Calls open with product instead of the cost of bad analytics, so urgency never gets built.",
      },
      {
        label: "Founder is the process",
        description:
          "Follow-up, pricing, legal — all flow through Priya, capping throughput at her calendar.",
      },
    ],
  },

  beliefLadder: [
    {
      id: "pain",
      label: "Pain",
      status: "covered",
      goal: "Make the stalled-pipeline pattern concrete and personal.",
      questions: [
        {
          id: "p_q1",
          text: "Walk me through the last deal that stalled — who went quiet first, and when?",
          priority: "high",
        },
        {
          id: "p_q2",
          text: "How many deals are sitting in procurement right now, and how long have they been there?",
          priority: "high",
        },
      ],
    },
    {
      id: "doubt",
      label: "Doubt",
      status: "needs_work",
      goal: "Show that working harder on follow-up can't fix a structural gap.",
      questions: [
        {
          id: "d_q1",
          text: "What have you tried to unstick these deals — discounts, deadlines, exec emails?",
          priority: "high",
        },
        {
          id: "d_q2",
          text: "Why do you think the follow-up sequences haven't changed the pattern?",
          priority: "medium",
        },
      ],
    },
    {
      id: "cost",
      label: "Cost",
      status: "not_covered",
      goal: "Price the rotting pipeline and the founder-time it consumes.",
      questions: [
        {
          id: "c_q1",
          text: "If those stalled deals are worth $120K and a third never close, what did this quarter actually cost?",
          priority: "high",
        },
        {
          id: "c_q2",
          text: "How many hours a week do you personally spend chasing deals that may already be dead?",
          priority: "medium",
        },
      ],
    },
    {
      id: "desire",
      label: "Desire",
      status: "not_covered",
      goal: "Get her to describe the repeatable motion, not just more revenue.",
      questions: [
        {
          id: "de_q1",
          text: "Twelve months from now, what does a deal closing without you in the room look like?",
          priority: "high",
        },
      ],
    },
    {
      id: "money",
      label: "Money",
      status: "not_covered",
      goal: "Connect the program fee to one saved deal.",
      questions: [
        {
          id: "m_q1",
          text: "If this rescued just two of the deals currently stuck, what's that worth against the program fee?",
          priority: "high",
        },
      ],
    },
    {
      id: "support",
      label: "Support",
      status: "not_covered",
      goal: "Check for co-founder or board alignment on GTM spend.",
      questions: [
        {
          id: "s_q1",
          text: "Does your co-founder or board weigh in on a spend like this, or is it your call?",
          priority: "medium",
        },
      ],
    },
    {
      id: "trust",
      label: "Trust",
      status: "not_covered",
      goal: "Build belief in the motion, not the advisor.",
      questions: [
        {
          id: "t_q1",
          text: "What would the 90-day pilot need to produce for you to call it a clear win?",
          priority: "high",
        },
      ],
    },
  ],

  pitchScript: {
    highLevelPromise: {
      title: "High-Level Promise",
      script:
        "Priya, here's the short version: in 90 days we install an enterprise sales motion — exec sponsor identified on every deal, mutual close plans, champion enablement — so deals close in 45 days instead of rotting in procurement for six months, without you being the bottleneck.",
      coachNotes: ["Use her stalled-deal count from Pain — make the promise about those deals."],
    },
    bridgePillars: [
      {
        id: "sp_buyer",
        title: "Pillar 1 — Sell to the buyer, not the user",
        script:
          "First, we restructure discovery so an economic buyer is in the room by call two — procurement should never be the first exec touchpoint.",
      },
      {
        id: "sp_diagnosis",
        title: "Pillar 2 — Diagnosis before demo",
        script:
          "Second, we flip your call structure: cost of the status quo first, product second. The demo becomes proof, not the pitch.",
        coachNotes: ["Mirror this call's structure as the example."],
      },
      {
        id: "sp_closeplan",
        title: "Pillar 3 — Mutual close plans",
        script:
          "Third, every qualified deal gets a shared close plan with dates, owners, and a compelling event — so deals advance without your follow-up.",
      },
    ],
    delivery: {
      title: "Delivery",
      script:
        "We work weekly: I review your actual deal tape, we build the playbook on live opportunities, and by day 90 the motion runs from a document, not from your memory. The pilot deliverable is two stalled deals moved to signature.",
      coachNotes: ["Concrete pilot deliverable is the close — repeat it twice."],
    },
  },

  objectionPrep: [
    {
      id: "so_diy",
      objection: "I can probably figure this out myself",
      likelyMeaning: "Doubt gap — founders default to self-reliance; she hasn't priced the time.",
      isolateQuestion:
        "You probably could. What's the cost of figuring it out over four quarters instead of one?",
      recommendedResponse:
        "Agree, then reframe: 'This isn't knowledge you lack, it's reps. I've run this motion 40 times — you'd be paying to skip the expensive iterations, not to learn theory.'",
    },
    {
      id: "so_timing",
      objection: "Maybe after we hire a sales person",
      likelyMeaning: "She thinks headcount fixes process. A hire without a motion churns.",
      isolateQuestion:
        "If you hired tomorrow, what playbook would you hand them on day one?",
      recommendedResponse:
        "Sequence it: 'Hiring into a broken motion burns six months and $80K. Build the motion now, then your first hire ramps in weeks because the playbook exists.'",
    },
    {
      id: "so_price",
      objection: "That's a big line item for us right now",
      likelyMeaning: "Comparing fee to cash on hand, not to the stalled pipeline.",
      isolateQuestion: "Compared to what — the fee itself, or what else that cash could do?",
      recommendedResponse:
        "Anchor to the pipeline: 'You have $120K stalled right now. The pilot pays for itself if it moves two deals — and that's the explicit deliverable.'",
    },
  ],

  callFlow: [
    {
      id: "sf_frame",
      step: "Frame",
      goal: "Position as diagnosis, not a pitch meeting.",
      talkTrack: "My goal today is to find out why deals stall, not to sell you anything yet. Fair?",
    },
    { id: "sf_current", step: "Current Situation", goal: "Map the funnel: demos booked, stalled, closed, cycle time." },
    { id: "sf_pain", step: "Widen Pain", goal: "Get the stalled-deal stories with names and dates." },
    { id: "sf_doubt", step: "Doubt", goal: "Inventory failed fixes: discounts, deadlines, sequences." },
    { id: "sf_outcome", step: "Desired Outcome", goal: "Have her describe deals closing without her in the room." },
    {
      id: "sf_transition",
      step: "Transition",
      goal: "Permission to present the motion.",
      talkTrack: "I can see exactly where the motion breaks. Want me to show you how we'd fix it in 90 days?",
    },
    { id: "sf_pitch", step: "Pitch", goal: "Promise → 3 pillars → pilot deliverable." },
    { id: "sf_commit", step: "Commit", goal: "Close the paid pilot with the two-deals-to-signature deliverable." },
  ],

  nextBestQuestions: [
    {
      id: "snbq_stalled",
      question: "How many deals are sitting in procurement right now, and what are they worth together?",
      why: "Builds the pipeline number every later reframe anchors to.",
      useCase: "discovery",
    },
    {
      id: "snbq_exec",
      question: "On your last closed deal, when did an executive first get involved?",
      why: "Exposes the missing economic buyer without asserting it.",
      useCase: "discovery",
    },
    {
      id: "snbq_handoff",
      question: "If you stepped away for a month, what happens to every open deal?",
      why: "Makes the founder-bottleneck cost visceral before the pitch.",
      useCase: "transition",
    },
  ],

  liveCoaching: {
    mode: "demo",
    statusLabel: "Listening...",
    timer: "03:47",
    waveform: [
      0.4, 0.7, 0.5, 0.85, 0.6, 0.35, 0.75, 0.5, 0.9, 0.45, 0.6, 0.8, 0.35,
      0.55, 0.7, 0.4, 0.65, 0.5, 0.3, 0.75, 0.6, 0.45, 0.8, 0.5,
    ],
    insights: [
      {
        id: "sins_pattern",
        type: "positive",
        text: "Strong open — she named three stalled deals unprompted",
        relatedBelief: "pain",
      },
      {
        id: "sins_exec",
        type: "warning",
        text: "No economic buyer mentioned yet — dig before moving on",
        relatedBelief: "pain",
        priority: "high",
      },
      {
        id: "sins_number",
        type: "suggestion",
        text: "Get the total value of stalled pipeline as one number",
        relatedBelief: "cost",
        priority: "high",
      },
    ],
    beliefProgress: [
      { beliefId: "pain", label: "Pain", status: "complete" },
      { beliefId: "doubt", label: "Doubt", status: "active" },
      { beliefId: "cost", label: "Cost", status: "incomplete" },
      { beliefId: "desire", label: "Desire", status: "incomplete" },
      { beliefId: "money", label: "Money", status: "incomplete" },
      { beliefId: "support", label: "Support", status: "incomplete" },
      { beliefId: "trust", label: "Trust", status: "incomplete" },
    ],
    nextSuggestedQuestion: {
      question: "How many deals are sitting in procurement right now, and what are they worth together?",
      reason: "Doubt is active but Cost is empty — anchor the pipeline number now.",
    },
  },
};

export const mockSessions: SalesSession[] = [
  {
    id: "session_alex",
    sidebarLabel: "Alex Revenue Coaching",
    lastActive: "2m ago",
    doc: alexSalesDoc,
    chat: {
      assistantIntro:
        "Got it! I'll prepare a tailored sales playbook for your call with Alex using the Belief Ladder framework. Here's what I'll generate for you:",
      generatedChecklist: [
        "Discovery Questions (Belief Ladder)",
        "Custom Pitch Script (Pitch Codex)",
        "Objection Handling Guide",
        "Call Flow & Talk Tracks",
        "Real-time Coaching Ready",
      ],
      assistantOutro:
        "I've generated your call prep materials. Check the artifacts on the right →",
      userTimestamp: "10:32 AM",
      assistantTimestamp: "10:33 AM",
    },
  },
  {
    id: "session_saas",
    sidebarLabel: "SaaS Founder — Scaling",
    lastActive: "1d ago",
    doc: saasFounderSalesDoc,
    chat: {
      assistantIntro:
        "On it. I'll build a scaling-stage playbook for your call with Priya — enterprise motion diagnosis plus the Belief Ladder. Here's what I'll generate:",
      generatedChecklist: [
        "Discovery Questions (Belief Ladder)",
        "Custom Pitch Script (Pitch Codex)",
        "Objection Handling Guide",
        "Call Flow & Talk Tracks",
        "Real-time Coaching Ready",
      ],
      assistantOutro:
        "Your call prep doc is ready. Check the artifacts on the right →",
      userTimestamp: "9:14 AM",
      assistantTimestamp: "9:15 AM",
    },
  },
];

/** Sidebar entries without full docs — display only. */
export const staticRecentSessions = [
  { label: "Fitness Coach — 1:1", lastActive: "2d ago" },
  { label: "Real Estate Agent", lastActive: "3d ago" },
  { label: "Dating Coach Discovery", lastActive: "4d ago" },
];

export const defaultSession = mockSessions[0];
