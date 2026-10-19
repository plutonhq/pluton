export class ApiResponseError extends Error {
   status: number;
   outcome: 'rejected' | 'unknown' | 'pending';
   code?: string;

   constructor(message: string, status: number, outcome: 'rejected' | 'unknown' | 'pending', code?: string) {
      super(message);
      this.name = 'ApiResponseError';
      this.status = status;
      this.outcome = outcome;
      this.code = code;
   }
}

const uncertain = 'The operation may already have taken effect. Refresh and check its status before trying again.';

/** Parse the API envelope without exposing proxy/login HTML or treating an accepted job as completed. */
export async function parseApiResponse<T>(
   response: Response,
   { allowNoContent = false, allowAccepted = true }: { allowNoContent?: boolean; allowAccepted?: boolean } = {},
): Promise<T> {
   const status = response.status;
   if (response.redirected || response.type === 'opaqueredirect')
      throw new ApiResponseError(`The API returned a redirect instead of its response. ${uncertain}`, status, 'unknown');
   if (status === 204 && allowNoContent) return { success: true, message: '' } as T;
   const contentType = response.headers.get('content-type') || '';
   let data: Record<string, unknown> | null = null;
   if (/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
      try {
         const value: unknown = await response.json();
         if (value && typeof value === 'object' && !Array.isArray(value)) data = value as Record<string, unknown>;
      } catch {
         // A truncated response does not establish whether a mutation was applied.
      }
   }
   if (!data) {
      if (status === 202 && !allowAccepted)
         throw new ApiResponseError('The request was accepted, but completion is not confirmed. Refresh and check its status before trying again.', status, 'pending');
      const reason = /html/i.test(contentType) ? 'HTML instead of JSON' : 'an empty, invalid or unexpected API response';
      throw new ApiResponseError(`Received ${reason} (HTTP ${status}). ${uncertain}`, status, 'unknown');
   }
   if (typeof data.success !== 'boolean')
      throw new ApiResponseError(`The API response did not confirm an outcome (HTTP ${status}). ${uncertain}`, status, 'unknown');
   if (!response.ok || data.success !== true) {
      const reason = typeof data.error === 'string' ? data.error : `API request failed (HTTP ${status}).`;
      throw new ApiResponseError(status >= 500 ? `${reason} ${uncertain}` : reason, status, status >= 500 ? 'unknown' : 'rejected', typeof data.code === 'string' ? data.code : undefined);
   }
   if (status === 202 && !allowAccepted)
      throw new ApiResponseError('The request was accepted, but completion is not confirmed. Refresh and check its status before trying again.', status, 'pending');
   return data as T;
}

/** Destructive calls are never retried or followed to another endpoint automatically. */
export async function mutationResponse<T>(
   input: RequestInfo | URL,
   init: RequestInit,
   options: { allowNoContent?: boolean; allowAccepted?: boolean } = {},
): Promise<T> {
   let response: Response;
   try {
      response = await fetch(input, { ...init, redirect: 'error' });
   } catch {
      throw new ApiResponseError(`No reliable API response was received. ${uncertain}`, 0, 'unknown');
   }
   return parseApiResponse<T>(response, options);
}
