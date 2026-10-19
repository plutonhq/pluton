import type { RecoveryEngine, RecoveryPolicy, RecoveryTest, InternalTargetView } from '../@types/recoveryTests';
export function recoveryTargetChoices(engine: RecoveryEngine, automatic = false): readonly ('internal' | 'custom')[] {
   return engine === 'mysql' && !automatic ? ['custom'] : ['internal', 'custom'];
}
export function recoveryTargetMode(policy: RecoveryPolicy, engine: RecoveryEngine): 'internal' | 'custom' {
   return policy.targetModes?.[engine] || 'custom';
}
export function internalStatus(view?: InternalTargetView, latest?: RecoveryTest): string {
   if (view?.status === 'cleanup_required' || latest?.result?.cleanup.infrastructure === false) return 'Cleanup Required';
   if (view?.status === 'running') return 'Running';
   if (latest?.failureCode === 'internal-resources-insufficient') return 'Insufficient Resources';
   if (view?.status === 'ready') return 'Ready';
   if (latest?.status === 'passed' || latest?.status === 'passed_with_warning') return 'Passed';
   if (latest?.status === 'failed' || latest?.status === 'cancelled') return 'Failed';
   return 'Not Provisioned';
}
