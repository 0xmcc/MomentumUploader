/**
 * SalesDoc data contract.
 *
 * This is the future AI/RAG output contract. The /sales-docs UI renders
 * entirely from this shape — replacing the mock objects in mockSalesDoc.ts
 * with real generated data should require zero component changes.
 */

export type BeliefId =
  | "pain"
  | "doubt"
  | "cost"
  | "desire"
  | "money"
  | "support"
  | "trust";

export type SalesDoc = {
  documentMetadata: {
    id: string;
    title: string;
    status: "draft" | "generated" | "reviewed";
    generatedAt: string;
    updatedAt: string;
  };

  prospect: {
    name: string;
    avatarUrl?: string;
    businessType: string;
    offer: string;
    pricePoint: string;
    mainChallenge: string;
    callGoal: string;
    stage: string;
  };

  sourceInputs: {
    prompt: string;
    transcriptSummary?: string;
    uploadedFiles?: Array<{
      id: string;
      name: string;
      type: "transcript" | "call_notes" | "recording";
    }>;
  };

  callBrief: {
    title: string;
    summary: string;
    objective: string;
    keyFacts: Array<{
      label: string;
      value: string;
    }>;
  };

  salesDiagnosis: {
    title: string;
    summary: string;
    likelyGaps: Array<{
      label: string;
      description: string;
    }>;
  };

  beliefLadder: Array<{
    id: BeliefId;
    label: string;
    status: "covered" | "needs_work" | "not_covered";
    goal: string;
    questions: Array<{
      id: string;
      text: string;
      reason?: string;
      priority?: "high" | "medium" | "low";
    }>;
  }>;

  pitchScript: {
    highLevelPromise: {
      title: string;
      script: string;
      coachNotes?: string[];
    };
    bridgePillars: Array<{
      id: string;
      title: string;
      script: string;
      coachNotes?: string[];
    }>;
    delivery: {
      title: string;
      script: string;
      coachNotes?: string[];
    };
  };

  objectionPrep: Array<{
    id: string;
    objection: string;
    likelyMeaning: string;
    isolateQuestion: string;
    recommendedResponse: string;
    fallbackQuestion?: string;
  }>;

  callFlow: Array<{
    id: string;
    step: string;
    goal: string;
    talkTrack?: string;
  }>;

  nextBestQuestions: Array<{
    id: string;
    question: string;
    why: string;
    useCase: "discovery" | "objection" | "pitch" | "transition" | "closing";
  }>;

  liveCoaching: {
    mode: "demo" | "live" | "off";
    statusLabel: string;
    timer: string;
    waveform?: number[];
    insights: Array<{
      id: string;
      type: "positive" | "warning" | "suggestion" | "next_step";
      text: string;
      relatedBelief?: BeliefId;
      priority?: "high" | "medium" | "low";
    }>;
    beliefProgress: Array<{
      beliefId: BeliefId;
      label: string;
      status: "complete" | "active" | "incomplete";
    }>;
    nextSuggestedQuestion: {
      question: string;
      reason: string;
    };
  };
};

/** Chat transcript shown in the Call Prep Assistant panel. */
export type ChatSession = {
  assistantIntro: string;
  generatedChecklist: string[];
  assistantOutro: string;
  userTimestamp: string;
  assistantTimestamp: string;
};

/** One selectable session in the workspace (sidebar → whole page swaps). */
export type SalesSession = {
  id: string;
  sidebarLabel: string;
  lastActive: string;
  doc: SalesDoc;
  chat: ChatSession;
};
