/** @jest-environment node */
import { processImportRunPage, failImportRun, serializeImportRun, type FathomImportRunRow } from './fathom-import';
import { supabaseAdmin } from './supabase';

jest.mock('./supabase');

const run: FathomImportRunRow = {
  id: 'run-1', user_id: 'user-1', status: 'queued', imported_count: 0,
  meeting_count: 0, processed_pages: 0, next_cursor: null,
  created_at: null, started_at: null, completed_at: null, last_error: null,
};
const originalFetch = global.fetch;
const update = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  update.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  (supabaseAdmin.from as jest.Mock).mockReturnValue({ update });
  global.fetch = jest.fn(async (_url, init) => {
    // Exercise real HTTP header validation, which a canned fetch mock bypasses.
    new Headers(init?.headers);
    return new Response(JSON.stringify({ items: [] }));
  });
});
afterEach(() => { global.fetch = originalFetch; });

it.each([' test-key\r\n', 'test-\nkey', 'test-\r\nkey', 'test-\t key'])('imports with copy/paste whitespace in the key (%j)', async (key) => {
  await expect(processImportRunPage(run, key)).resolves.toMatchObject({ status: 'succeeded' });
  expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ 'X-Api-Key': 'test-key' }),
  }));
});

it('rejects invalid credential characters without sending or exposing the key', async () => {
  await expect(processImportRunPage(run, 'secret\u0000key')).rejects.toThrow('FATHOM_API_KEY contains invalid characters. Update the server configuration.');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('does not persist or return credential-bearing fetch errors', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Headers.append: "secret-key" is an invalid header value.'));
  let failure: unknown;
  try { await processImportRunPage(run, 'secret-key'); } catch (error) { failure = error; }
  const result = await failImportRun(run, failure);
  expect(result.error).toBe('Unable to contact Fathom. Please try again.');
  expect(JSON.stringify(update.mock.calls)).not.toContain('secret-key');
});

it('redacts previously stored invalid-header errors when serializing history', () => {
  expect(serializeImportRun({ ...run, status: 'failed', last_error: 'Headers.append: "old-secret" is an invalid header value.' }).error)
    .toBe('Fathom request contained an invalid header. Check the server configuration and retry the import.');
});
