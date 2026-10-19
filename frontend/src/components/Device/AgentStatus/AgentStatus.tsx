import Button from '../../common/Button/Button';
import { useState } from 'react';
import type { AgentInfo } from '../../../@types/devices';
import { useRevokeAgentDevice } from '../../../services/devices';
import classes from './AgentStatus.module.scss';

const displayDate = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Never');

type AgentStatusProps = {
   deviceId: string;
   agent: AgentInfo;
};

const AgentStatus = ({ deviceId, agent }: AgentStatusProps) => {
   const revoke = useRevokeAgentDevice();
   const [revokeError, setRevokeError] = useState('');
   const revokeAgent = async () => {
      if (agent.status === 'revoked' || !window.confirm('Revoke this remote machine? Its agent credential will stop working immediately.')) return;
      try {
         await revoke.mutateAsync(deviceId);
      } catch {
         setRevokeError('Could not revoke the remote machine. Its credential may still be active.');
      }
   };

   return (
      <section className={classes.agentStatus}>
         <div className={classes.titleRow}>
            <h3>Remote Agent</h3>
            <span className={`${classes.status} ${classes[agent.status]}`}>{agent.status.toUpperCase()}</span>
         </div>
         <dl className={classes.details}>
            <div>
               <dt>Hostname</dt>
               <dd>{agent.hostname}</dd>
            </div>
            <div>
               <dt>Agent ID</dt>
               <dd className={classes.monospace}>{agent.agentId}</dd>
            </div>
            <div>
               <dt>Last seen</dt>
               <dd>{displayDate(agent.lastSeen)}</dd>
            </div>
            <div>
               <dt>Operating system</dt>
               <dd>{agent.os}</dd>
            </div>
            <div>
               <dt>Architecture</dt>
               <dd>{agent.architecture}</dd>
            </div>
            <div>
               <dt>Agent version</dt>
               <dd>{agent.agentVersion}</dd>
            </div>
            <div>
               <dt>Restic</dt>
               <dd>{agent.resticVersion || 'Not reported'}</dd>
            </div>
            <div>
               <dt>Rclone</dt>
               <dd>{agent.rcloneVersion || 'Not reported'}</dd>
            </div>
            <div>
               <dt>Allowed roots configured</dt>
               <dd>{agent.capabilities.filesystemRootsConfigured ? 'Yes' : 'No'}</dd>
            </div>
            <div>
               <dt>Agent capabilities</dt>
               <dd>{agent.capabilities.commandTypes?.join(', ') || 'None'}</dd>
            </div>
         </dl>
         {revokeError && <p className={classes.error}>{revokeError}</p>}
         {agent.status !== 'revoked' && (
            <Button
               text={revoke.isPending ? 'Revoking…' : 'Revoke remote machine'}
               variant="danger"
               size="sm"
               disabled={revoke.isPending}
               onClick={revokeAgent}
            />
         )}
      </section>
   );
};

export default AgentStatus;
