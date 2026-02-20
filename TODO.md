# 🚀 Sonic Memos: Next Steps & To-Do List

Great progress! The frontend interface including the `AudioRecorder`, global theme, and the mock endpoints has been completely built out. 

To convert this prototype into a full production app, complete the following items:

## 1. 🗄️ Supabase Configuration
- [ ] **Create a Supabase Project**: Go to [supabase.com](https://supabase.com/) and create a new project.
- [ ] **Set Environment Variables**: Create a `.env.local` file in `/voice-memos` and add your keys:
    ```env
    NEXT_PUBLIC_SUPABASE_URL=your_project_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
    SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
    ```
- [ ] **Create Database Table**: Set up a `memos` table to store data:
    ```sql
    CREATE TABLE memos (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      title TEXT NOT NULL,
      transcript TEXT,
      audio_url TEXT NOT NULL,
      duration TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    ```
- [ ] **Create Storage Bucket**: Create a public bucket in Supabase Storage named `voice-memos`. Connect it with RLS policies so users can upload files (`webm`).

## 2. 🧠 NVIDIA Parakeet Integration
- [ ] **Get NVIDIA API Key**: Create an account on [build.nvidia.com](https://build.nvidia.com) to access NVIDIA NIM endpoints.
- [ ] **Save API Key**: Put the API key in `.env.local`:
    ```env
    NVIDIA_API_KEY=your_nvapi_key
    ```
- [ ] **Update API Route `src/app/api/transcribe/route.ts`**:
    - Remove the mock timeout logic.
    - Read the `FormData` audio blob, optionally convert it to base64 or upload it immediately to Supabase Storage to obtain a public URL.
    - Forward the audio stream to the `https://api.nvidia.com/v1/audio/transcriptions` endpoint using the Parakeet model (`nvidia/parakeet-rnnt-1.1b` or whichever NIM version you select).
    - Capture the transcribed text `transcriptionData.text`.

## 3. 🔌 Frontend Data Fetching (State Management)
- [ ] **Fetch Real Data on Load**: Inside `src/app/page.tsx`, use a `useEffect` hook to fetch actual data from Supabase instead of using `INITIAL_MEMOS`.
    ```javascript
    const { data } = await supabase.from('memos').select('*').order('created_at', { ascending: false });
    ```
- [ ] **Update UI after Upload**: When `handleUploadComplete` executes, either pull the latest `memos` from the API or insert the new record into the React state optimally.

## 4. 🔒 Authentication (Optional but Recommended)
- [ ] **Add Supabase Auth (or NextAuth)**: Implement sign-in capabilities if you want users to have private memo collections.
- [ ] **Row Level Security (RLS)**: Protect your `memos` table so only authenticated users (`auth.uid() = user_id`) can select and insert records.
