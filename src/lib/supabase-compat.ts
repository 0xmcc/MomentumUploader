type SupabaseErrorLike = {
    code?: string | null;
    message?: string | null;
};

function readErrorMessage(error: SupabaseErrorLike | null | undefined): string {
    return (error?.message ?? "").toLowerCase();
}

export function isMissingColumnError(
    error: SupabaseErrorLike | null | undefined,
    table: string,
    column: string
): boolean {
    const message = readErrorMessage(error);
    if (!message) return false;

    return (
        error?.code === "42703" ||
        error?.code === "PGRST204" ||
        message.includes(`column ${table}.${column} does not exist`) ||
        message.includes(`could not find the '${column}' column of '${table}'`) ||
        message.includes(`could not find the '${column}' column of "${table}"`)
    );
}

export function isMissingTableError(
    error: SupabaseErrorLike | null | undefined,
    table: string
): boolean {
    const message = readErrorMessage(error);
    if (!message) return error?.code === "42P01" || error?.code === "PGRST205";

    const tableName = table.toLowerCase();
    const unqualifiedTable = tableName.split(".").pop() ?? tableName;
    const qualifiedTable = tableName.includes(".")
        ? tableName
        : `public.${tableName}`;
    const mentionsTable =
        message.includes(`"${qualifiedTable}"`) ||
        message.includes(`'${qualifiedTable}'`) ||
        message.includes(` ${qualifiedTable}`) ||
        message.includes(`"${unqualifiedTable}"`) ||
        message.includes(`'${unqualifiedTable}'`) ||
        message.includes(` ${unqualifiedTable}`) ||
        message.includes(`table ${unqualifiedTable}`);

    return (
        ((error?.code === "42P01" || error?.code === "PGRST205") &&
            mentionsTable) ||
        (message.includes("does not exist") && mentionsTable) ||
        (message.includes("could not find the table") && mentionsTable)
    );
}
