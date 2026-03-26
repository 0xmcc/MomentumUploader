export const supabase = {
    storage: {
        from: jest.fn(() => ({
            getPublicUrl: jest.fn(() => ({ data: { publicUrl: "" } })),
            uploadToSignedUrl: jest.fn().mockResolvedValue({
                data: { path: "" },
                error: null,
            }),
        })),
    },
};

export const supabaseAdmin = {
    storage: {
        from: jest.fn(() => ({
            createSignedUploadUrl: jest.fn(),
            upload: jest.fn(),
            list: jest.fn(),
            download: jest.fn(),
            remove: jest.fn(),
        })),
    },
    from: jest.fn(),
    rpc: jest.fn(),
};

export const uploadAudio = jest.fn();
