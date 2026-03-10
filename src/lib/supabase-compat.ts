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
