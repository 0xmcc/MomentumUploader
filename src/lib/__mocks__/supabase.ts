export const supabase = {
    storage: {
        from: jest.fn(() => ({
            getPublicUrl: jest.fn(() => ({ data: { publicUrl: "" } })),
        })),
    },
};

export const supabaseAdmin = {
    from: jest.fn(),
    rpc: jest.fn(),
};

export const uploadAudio = jest.fn();
