import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Public client — used client-side; subject to RLS
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client — server-side ONLY; bypasses RLS via service_role key
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser
export const supabaseAdmin = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey, // falls back to anon if not set
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function uploadAudio(file: Blob, fileName: string) {
    const { data, error } = await supabaseAdmin.storage
        .from("voice-memos")
        .upload(`audio/${fileName}`, file);

    if (error) {
        console.error("Supabase Upload Error:", error);
        throw error;
    }

    return data;
}

