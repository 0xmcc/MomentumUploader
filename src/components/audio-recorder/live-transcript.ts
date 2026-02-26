const LIVE_CHAR_OVERLAP_WINDOW = 800;
const LIVE_CHAR_OVERLAP_MIN = 36;
const LIVE_CHAR_OVERLAP_MIN_SHORT = 24;
const LIVE_SHORT_HYPOTHESIS_CHAR_THRESHOLD = 220;
const LIVE_SHORT_FRAGMENT_CHAR_THRESHOLD = 40;
const LIVE_RESEND_ANCHOR_MIN = 32;
const LIVE_RESEND_LEADING_OFFSET_MAX = 3;
const LIVE_RESEND_LENGTH_RATIO_MIN = 0.7;

export function mergeLiveTranscript(previous: string, incoming: string): string {
    const normalize = (text: string) => text.trim().replace(/\s+/g, " ");
    const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const appendUnknownBoundary = (left: string, right: string) => {
        if (!left) return right;
        if (!right) return left;
        if (!/\s/.test(left) && !/\s/.test(right)) {
            return `${left}${right}`;
        }
        return `${left} ${right}`;
    };
    const appendUsingSourceBoundary = (
        base: string,
        source: string,
        boundaryIndex: number,
        tail: string,
    ) => {
        if (!tail) return base;
        const sourceLeft = source[boundaryIndex - 1] ?? "";
        const sourceRight = source[boundaryIndex] ?? "";
        const boundaryHasWhitespace = /\s/.test(sourceLeft) || /\s/.test(sourceRight);
        if (boundaryHasWhitespace) {
            return appendUnknownBoundary(base, tail);
        }
        return `${base}${tail}`;
    };
    const canonicalizeWord = (word: string) =>
        word
            .toLowerCase()
            .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
    const tokenize = (text: string) =>
        normalize(text)
            .split(" ")
            .map(canonicalizeWord)
            .filter(Boolean);
    const countCommonPrefix = (a: string[], b: string[]) => {
        const max = Math.min(a.length, b.length);
        let count = 0;
        while (count < max && a[count] === b[count]) {
            count += 1;
        }
        return count;
    };
    const countLeadingAlignedMatch = (a: string, b: string) => {
        let bestCount = 0;
        let bestOffsetA = 0;
        let bestOffsetB = 0;

        for (let offsetA = 0; offsetA <= LIVE_RESEND_LEADING_OFFSET_MAX; offsetA += 1) {
            for (let offsetB = 0; offsetB <= LIVE_RESEND_LEADING_OFFSET_MAX; offsetB += 1) {
                let count = 0;
                while (
                    offsetA + count < a.length &&
                    offsetB + count < b.length &&
                    a[offsetA + count] === b[offsetB + count]
                ) {
                    count += 1;
                }

                if (count > bestCount) {
                    bestCount = count;
                    bestOffsetA = offsetA;
                    bestOffsetB = offsetB;
                }
            }
        }

        return { count: bestCount, offsetA: bestOffsetA, offsetB: bestOffsetB };
    };

    const prev = normalize(previous);
    const next = normalize(incoming);

    if (!next) return prev;
    if (!prev) return next;
    if (next.startsWith(prev)) return next;
    if (prev.includes(next)) return prev;

    const prevCompact = compact(prev);
    const nextCompact = compact(next);

    if (!prevCompact || !nextCompact) {
        return `${prev} ${next}`;
    }

    if (nextCompact.includes(prevCompact)) return next;
    if (prevCompact.includes(nextCompact)) return prev;

    const leadingAligned = countLeadingAlignedMatch(prevCompact, nextCompact);
    const hasLeadingResendAnchor =
        leadingAligned.count >= LIVE_RESEND_ANCHOR_MIN &&
        leadingAligned.offsetA <= LIVE_RESEND_LEADING_OFFSET_MAX &&
        leadingAligned.offsetB <= LIVE_RESEND_LEADING_OFFSET_MAX;

    if (hasLeadingResendAnchor) {
        const nextIsComparableLength =
            nextCompact.length >= Math.floor(prevCompact.length * LIVE_RESEND_LENGTH_RATIO_MIN);
        if (nextIsComparableLength) return next;

        const prevIsClearlyLonger =
            prevCompact.length >= Math.floor(nextCompact.length * 1.1);
        if (prevIsClearlyLonger) return prev;
    }

    const prevTokens = tokenize(prev);
    const nextTokens = tokenize(next);
    const commonPrefixCount = countCommonPrefix(prevTokens, nextTokens);

    const isLongSharedPrefix =
        commonPrefixCount >= 6 &&
        prevTokens.length > 0 &&
        commonPrefixCount / prevTokens.length >= 0.5;

    if (
        prevTokens.length > 0 &&
        nextTokens.length >= prevTokens.length &&
        (
            commonPrefixCount / prevTokens.length >= 0.8 ||
            isLongSharedPrefix
        )
    ) {
        return next;
    }

    if (
        nextTokens.length > 0 &&
        prevTokens.length > nextTokens.length &&
        (
            commonPrefixCount / nextTokens.length >= 0.9 ||
            (commonPrefixCount >= 6 && commonPrefixCount / nextTokens.length >= 0.7)
        )
    ) {
        return prev;
    }

    // GUARDRAIL — defense-in-depth for the gapped-window resend pattern.
    // Root cause: when recording exceeds LIVE_MAX_CHUNKS the snapshot sent to RIVA is
    // [chunk 0 (headers + first ~1 s of audio)] + [last 29 chunks], creating a gap in the
    // middle. RIVA transcribes "opening words ... recent tail", producing an `incoming` that
    // re-opens with the same phrase `prev` started with but is shorter overall.
    // The fix (in useAudioRecording / useLiveTranscription) separates the WebM header blob
    // from audio chunks so the overflow snapshot has no gap. This guardrail is kept as
    // defense-in-depth for edge cases and future regressions of the same class.
    //
    // Detection: prev has significantly more tokens AND next shares an opening prefix with prev.
    // Action:
    //   • If the tail of next (after the shared prefix) is already in prev → return prev (nothing new).
    //   • If the tail is genuinely new → append only the new tail, drop the duplicated opening.
    const isSignificantlyLonger = prevTokens.length >= nextTokens.length + 4;
    const hasSharedOpening =
        commonPrefixCount >= 2 && commonPrefixCount / nextTokens.length >= 0.2;
    if (isSignificantlyLonger && hasSharedOpening) {
        const newTailTokens = nextTokens.slice(commonPrefixCount);
        const newTail = newTailTokens.join(" ");
        if (!newTail) return prev;
        if (prev.toLowerCase().includes(newTail.toLowerCase())) return prev;
        return appendUnknownBoundary(prev, newTail);
    }

    const prevLower = prev.toLowerCase();
    const nextLower = next.toLowerCase();
    const prevTailLower = prevLower.slice(-LIVE_CHAR_OVERLAP_WINDOW);
    const maxCharOverlap = Math.min(prevTailLower.length, nextLower.length);
    const baseMinCharOverlap =
        nextLower.length <= LIVE_SHORT_HYPOTHESIS_CHAR_THRESHOLD
            ? LIVE_CHAR_OVERLAP_MIN_SHORT
            : LIVE_CHAR_OVERLAP_MIN;
    const shortFragmentMin = nextLower.length <= LIVE_SHORT_FRAGMENT_CHAR_THRESHOLD ? 2 : baseMinCharOverlap;
    const minCharOverlap = Math.min(baseMinCharOverlap, shortFragmentMin, maxCharOverlap);

    for (let overlap = maxCharOverlap; overlap >= minCharOverlap; overlap -= 1) {
        const nextPrefix = nextLower.slice(0, overlap);
        if (!nextPrefix) continue;
        if (!prevTailLower.endsWith(nextPrefix)) continue;

        const appendedTail = next.slice(overlap).trim();
        return appendUsingSourceBoundary(prev, next, overlap, appendedTail);
    }

    const relaxedMinOverlap = nextLower.length <= LIVE_SHORT_FRAGMENT_CHAR_THRESHOLD ? 2 : 12;
    const minOverlapForAnyMatch = Math.min(maxCharOverlap, relaxedMinOverlap);

    for (let overlap = maxCharOverlap; overlap >= minOverlapForAnyMatch; overlap -= 1) {
        const tailSuffix = prevTailLower.slice(-overlap);
        const overlapIndexInNext = nextLower.indexOf(tailSuffix);
        if (overlapIndexInNext === -1) continue;

        const appendedTail = next.slice(overlapIndexInNext + overlap).trim();
        return appendUsingSourceBoundary(prev, next, overlapIndexInNext + overlap, appendedTail);
    }

    const prevWords = prev.split(" ");
    const nextWords = next.split(" ");
    const maxOverlap = Math.min(prevWords.length, nextWords.length);

    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const prevSuffix = prevWords.slice(-overlap).map(canonicalizeWord);
        const nextPrefix = nextWords.slice(0, overlap).map(canonicalizeWord);
        if (
            prevSuffix.length === nextPrefix.length &&
            prevSuffix.length > 0 &&
            prevSuffix.every((word, index) => word !== "" && word === nextPrefix[index])
        ) {
            const appendedTail = nextWords.slice(overlap).join(" ");
            return appendUnknownBoundary(prev, appendedTail);
        }
    }

    return appendUnknownBoundary(prev, next);
}
