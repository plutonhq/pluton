import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { recoveryTargetChoices, recoveryTargetMode, internalStatus } from '../src/utils/recoveryTargetModes.ts';
test('legacy choices remain unchanged; MySQL Internal is offered only in automatic mode', () => {
   assert.deepEqual(recoveryTargetChoices('mariadb'), ['internal', 'custom']);
   assert.deepEqual(recoveryTargetChoices('postgresql'), ['internal', 'custom']);
   assert.deepEqual(recoveryTargetChoices('mysql'), ['custom']);
   assert.deepEqual(recoveryTargetChoices('mysql', true), ['internal', 'custom']);
});
test('saved and migrated Custom plans keep their mode; credentials are not part of selection', () => {
   const policy = { enabled: false, databaseImport: 'required' as const };
   for (const engine of ['mariadb', 'postgresql', 'mysql'] as const) assert.equal(recoveryTargetMode(policy, engine), 'custom');
   assert.equal(recoveryTargetMode({ ...policy, targetModes: { mariadb: 'internal' } }, 'mariadb'), 'internal');
   assert.equal(recoveryTargetMode({ ...policy, targetModes: { mariadb: 'internal' } }, 'mysql'), 'custom');
   assert.equal(recoveryTargetMode({ ...policy, targetModes: { mysql: 'internal' } }, 'mysql'), 'internal');
});
test('readiness and results do not disguise mandatory infrastructure cleanup as Passed', () => {
   const view = { engine: 'mariadb' as const, mode: 'operator-managed' as const, status: 'not_provisioned' as const };
   assert.equal(internalStatus(view), 'Not Provisioned');
   assert.equal(internalStatus({ ...view, status: 'ready' }), 'Ready');
   assert.equal(internalStatus({ ...view, status: 'running' }), 'Running');
   assert.equal(internalStatus({ ...view, status: 'cleanup_required' }), 'Cleanup Required');
   assert.equal(internalStatus(view, { failureCode: 'internal-resources-insufficient' } as any), 'Insufficient Resources');
   assert.equal(internalStatus(view, { status: 'failed' } as any), 'Failed');
   assert.equal(internalStatus(view, { status: 'passed', result: { cleanup: { infrastructure: true } } } as any), 'Passed');
   assert.equal(internalStatus(view, { status: 'passed', result: { cleanup: { infrastructure: false } } } as any), 'Cleanup Required');
});
const frontendRequire = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react'),
   { renderToStaticMarkup } = frontendRequire('react-dom/server');
async function settings(fixture: any) {
   (globalThis as any).__pluton_recovery_ui = fixture;
   const { build } = backendRequire('esbuild');
   const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/components/Plan/RecoveryTesting/RecoverySettings.tsx', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime'],
      plugins: [
         {
            name: 'recovery-settings-fixtures',
            setup(builder: any) {
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
               builder.onLoad({ filter: /services[\\/]recoveryTests\.ts$/ }, () => ({
                  contents: `const fixture=()=>globalThis.__pluton_recovery_ui;
               export const useRecoveryConfiguration=()=>({data:fixture(),refetch:()=>{}});
               export const useRecoveryTests=()=>({data:fixture().history||[]});
               export const useSaveRecoveryTarget=()=>({isPending:false,mutate:()=>{}});
               export const useSaveRecoveryPolicy=()=>({isPending:false,mutate:()=>{}});`,
                  loader: 'js',
               }));
            },
         },
      ],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', result.outputFiles[0].text)(frontendRequire, module, module.exports);
   try {
      return renderToStaticMarkup(React.createElement(module.exports.default, { planId: 'plan-01' }));
   } finally {
      delete (globalThis as any).__pluton_recovery_ui;
   }
}
test('actual settings renders Custom legacy fields and never offers MySQL Internal', async () => {
   const html = await settings({
      policy: { enabled: false, databaseImport: 'required' },
      targets: [
         {
            engine: 'mariadb',
            host: 'recovery.example.internal',
            port: 3306,
            username: 'recovery_user',
            tls: 'verify-identity',
            enabled: true,
            dedicated: true,
            passwordConfigured: true,
         },
      ],
      mysqlWorker: 'unavailable',
   });
   assert(html.includes('recovery.example.internal'));
   assert.match(html, /Write-only recovery password/);
   const mysql = html.split('<h4>mysql Recovery Target</h4>')[1].split('<h4>postgresql Recovery Target')[0];
   assert.match(mysql, /Custom only/);
   assert.match(mysql, /Unavailable/);
   assert(!mysql.includes('value="internal"'));
});
test('actual Internal settings hides Custom credentials and clearly explains manual lifecycle/cleanup', async () => {
   const html = await settings({
      policy: { enabled: false, databaseImport: 'required', targetModes: { mariadb: 'internal' } },
      targets: [{ engine: 'mariadb', host: 'hidden.example.internal', username: 'hidden_user', passwordConfigured: true }],
      internalTargets: [{ engine: 'mariadb', status: 'cleanup_required', mode: 'operator-managed' }],
      mysqlWorker: 'ready',
   });
   assert(!html.includes('hidden.example.internal'));
   assert(!html.includes('hidden_user'));
   assert.match(html, /Cleanup Required/);
   assert.match(html, /not automatic container startup\/shutdown/);
   assert.match(html, /cannot be Passed until cleanup is confirmed/);
   assert.match(html, /Refresh target readiness/);
});
