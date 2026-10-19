export function buildIdentity(version?: string | null, revision?: string | null): string {
   const value = version && /^[A-Za-z0-9._-]{1,80}$/.test(version) ? version : '';
   const commit = revision && /^[a-f0-9]{7,64}$/i.test(revision) ? revision.slice(0, 12) : '';
   if (/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(value))
      return `${value.startsWith('v') ? value : 'v' + value}${commit ? ' · ' + commit : ''}`;
   const label = value && !['dev', 'unknown'].includes(value) ? value : '';
   return `Development build${label ? ' · ' + label : ''}${commit ? ' · ' + commit : ''}`;
}
