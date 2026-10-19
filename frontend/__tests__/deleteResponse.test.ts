import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiResponseError, mutationResponse, parseApiResponse } from '../src/utils/httpResponse.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('JSON success and storage retention warnings remain intact; explicit 204 supports empty success', async () => {
   const value = { success: true, unremovedPaths: [{ storageName: 'Example', storagePath: '/example/retained' }], unremovedReason: 'Retained' };
   assert.deepEqual(await parseApiResponse(json(value)), value);
   assert.deepEqual(await parseApiResponse(new Response(null, { status: 204 }), { allowNoContent: true }), { success: true, message: '' });
   await assert.rejects(parseApiResponse(new Response(null, { status: 204 })), /unexpected API response/);
});

test('HTTP failures never become success even when their envelope says success', async () => {
   for (const status of [401, 403, 404, 405, 409, 500, 520]) {
      await assert.rejects(parseApiResponse(json({ success: true }, status)), (error: ApiResponseError) => error.status === status);
      await assert.rejects(parseApiResponse(json({ success: false, error: 'Selected resource is unavailable.' }, status)), /Selected resource is unavailable/);
   }
   await assert.rejects(parseApiResponse(json({ success: false, error: 'Refused' })), /Refused/);
});

test('retained database dependency preserves HTTP409 and its machine code for targeted management guidance', async () => {
   await assert.rejects(parseApiResponse(json({ success: false, code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY', error: 'Verified database cleanup is required.' }, 409)), (error: ApiResponseError) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'RETAINED_DATABASE_RESTORE_DEPENDENCY');
      assert.equal(error.outcome, 'rejected');
      assert.equal(error.message, 'Verified database cleanup is required.');
      return true;
   });
});

test('HTML 405/proxy/SPA and redirects explain uncertain outcome without exposing HTML, credentials or URL', async () => {
   for (const status of [200, 405, 502, 520]) {
      await assert.rejects(parseApiResponse(new Response('<html>private-proxy-content</html>', { status, headers: { 'Content-Type': 'text/html' } })), (error: ApiResponseError) => {
         assert.equal(error.status, status);
         assert.equal(error.outcome, 'unknown');
         assert.match(error.message, /HTML instead of JSON/);
         assert.match(error.message, /may already have taken effect/);
         assert.match(error.message, /before trying again/);
         assert.doesNotMatch(error.message, /private-proxy-content/);
         return true;
      });
   }
   const redirected = json({ success: true });
   Object.defineProperty(redirected, 'redirected', { value: true });
   await assert.rejects(parseApiResponse(redirected), /redirect/);
});

test('malformed JSON, missing envelope, empty 200 and text responses do not claim completion', async () => {
   for (const response of [
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      json(null), json([]), json({ result: 'missing-success' }), json({ success: 'true' }),
      new Response(''), new Response('not json', { headers: { 'Content-Type': 'text/plain' } }),
   ]) await assert.rejects(parseApiResponse(response), ApiResponseError);
   await assert.rejects(parseApiResponse(json({ result: 'missing-success' })), (error: ApiResponseError) => error.outcome === 'unknown');
});

test('202 lifecycle result is preserved, while synchronous delete reports accepted with completion unconfirmed', async () => {
   const value = { success: true, result: { id: 'restore-01', status: 'cleanup_required' } };
   assert.deepEqual(await parseApiResponse(json(value, 202)), value);
   for (const response of [json(value, 202), new Response(null, { status: 202 })]) {
      await assert.rejects(parseApiResponse(response, { allowAccepted: false }), (error: ApiResponseError) => {
         assert.equal(error.outcome, 'pending');
         assert.match(error.message, /accepted.*completion is not confirmed/);
         return true;
      });
   }
});

test('transport/redirect failure never retries a destructive request or declares it failed', async () => {
   const previous = globalThis.fetch;
   let count = 0;
   globalThis.fetch = async (_input, init) => {
      count++;
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'include');
      throw new TypeError('private-network-details');
   };
   try {
      await assert.rejects(mutationResponse('/api/plans/plan-01', { method: 'DELETE', credentials: 'include' }), (error: ApiResponseError) => {
         assert.equal(error.outcome, 'unknown');
         assert.match(error.message, /before trying again/);
         assert.doesNotMatch(error.message, /private-network-details/);
         return true;
      });
      assert.equal(count, 1);
   } finally { globalThis.fetch = previous; }
});
