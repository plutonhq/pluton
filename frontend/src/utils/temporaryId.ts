let fallbackSequence = 0;

/** Client-only UI identity. Never use this as a persisted ID or security token. */
export function createTemporaryId(): string {
   const crypto = globalThis.crypto;
   if (typeof crypto?.randomUUID === 'function') return `ui-${crypto.randomUUID()}`;
   if (typeof crypto?.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return `ui-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
   }
   // Old/non-browser runtimes still need distinct keys within this UI session.
   return `ui-${Date.now().toString(36)}-${++fallbackSequence}`;
}
