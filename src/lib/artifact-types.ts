export const ARTIFACT_TYPES = [
    "rolling_summary",
    "outline",
    "title_candidates",
    "title",
    "key_topics",
    "action_items",
] as const;

export type ArtifactType = typeof ARTIFACT_TYPES[number];

export type ArtifactEntry = {
    payload: unknown;
    basedOnChunkStart: number | null;
    basedOnChunkEnd: number | null;
    version: number;
    updatedAt: string;
};

export type ArtifactMap = Record<ArtifactType, ArtifactEntry | null>;

type ArtifactRow = {
    artifact_type: ArtifactType;
    payload: unknown;
    based_on_chunk_start: number | null;
    based_on_chunk_end: number | null;
    version: number | null;
    updated_at: string | null;
};

export function createEmptyArtifactMap(): ArtifactMap {
    return Object.fromEntries(
        ARTIFACT_TYPES.map((artifactType) => [artifactType, null])
    ) as ArtifactMap;
}

export function buildArtifactMap(rows: ArtifactRow[]): ArtifactMap {
    const map = createEmptyArtifactMap();

    for (const row of rows) {
        map[row.artifact_type] = {
            payload: row.payload,
            basedOnChunkStart: row.based_on_chunk_start,
            basedOnChunkEnd: row.based_on_chunk_end,
            version: row.version ?? 1,
            updatedAt: row.updated_at ?? new Date(0).toISOString(),
        };
    }

    return map;
}
