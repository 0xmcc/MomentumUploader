const TRANSCRIPT_REVEAL_TARGET_CHARS = 48;

function splitTranscriptIntoAnimationChunks(
    text: string,
    targetChars = TRANSCRIPT_REVEAL_TARGET_CHARS
): string[] {
    const normalized = text.trim();
    if (!normalized) return [];

    const units = normalized.match(/\S+\s*/g) ?? [];
    const chunks: string[] = [];
    let currentUnits: string[] = [];

    const isPreferredBreakUnit = (unit: string) =>
        unit.includes("\n") || /[.!?]["')\]]*\s*$/.test(unit);

    const measureVisibleChars = (value: string) =>
        value.replaceAll("\n", "").length;

    const pushUnits = (count: number) => {
        if (count <= 0) return;
        chunks.push(currentUnits.slice(0, count).join(""));
        currentUnits = currentUnits.slice(count);
    };

    for (const unit of units) {
        currentUnits.push(unit);

        if (unit.includes("\n")) {
            pushUnits(currentUnits.length);
            continue;
        }

        if (measureVisibleChars(currentUnits.join("")) <= targetChars) {
            continue;
        }

        let preferredBreakIndex = -1;
        for (let index = currentUnits.length - 2; index >= 0; index -= 1) {
            if (isPreferredBreakUnit(currentUnits[index] ?? "")) {
                preferredBreakIndex = index;
                break;
            }
        }

        if (preferredBreakIndex >= 0 && preferredBreakIndex < currentUnits.length - 1) {
            pushUnits(preferredBreakIndex + 1);
            continue;
        }

        const overflowUnit = currentUnits.pop();
        if (!overflowUnit) continue;
        pushUnits(currentUnits.length);
        currentUnits = [overflowUnit];
    }

    pushUnits(currentUnits.length);
    return chunks;
}

export function buildAnimatedTranscriptState(previousText: string, nextText: string) {
    const normalizedNextText = nextText.trim();
    if (!normalizedNextText) {
        return {
            animatedWords: [],
            newWordStartIndex: 0,
        };
    }

    const normalizedPreviousText = previousText.trim();
    const nextChunks = splitTranscriptIntoAnimationChunks(normalizedNextText);
    const previousChunks = normalizedPreviousText
        ? splitTranscriptIntoAnimationChunks(normalizedPreviousText)
        : [];
    const isAppendOnly =
        normalizedPreviousText.length > 0 &&
        normalizedNextText.startsWith(normalizedPreviousText);

    return {
        animatedWords: nextChunks,
        newWordStartIndex: isAppendOnly ? previousChunks.length : 0,
    };
}
