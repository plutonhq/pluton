import { useState } from 'react';
import Modal from '../../common/Modal/Modal';
import Input from '../../common/form/Input/Input';
import Button from '../../common/Button/Button';
import { useCreateAgentEnrollment, useRevokeAgentEnrollment, type AgentEnrollment } from '../../../services/devices';
import classes from './AgentEnrollment.module.scss';

type AgentEnrollmentProps = {
   close: () => void;
};

type InstallVariant = 'quick' | 'secure';

const communityForkUrl = 'https://github.com/ffigoperdana/pluton.git';

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

const buildInstallCommand = (serverUrl: string, allowedRoot: string, insecureHttp: boolean, token?: string) => {
   const lines = [
      'sudo ./installers/install-agent.sh \\',
      '  --server ' + shellQuote(serverUrl) + ' \\',
      ...(token ? ['  --token ' + shellQuote(token) + ' \\'] : []),
      '  --allowed-root ' + shellQuote(allowedRoot) + (insecureHttp ? ' \\' : ''),
      ...(insecureHttp ? ['  --allow-insecure-http'] : []),
   ];
   return lines.join('\n');
};

const copyToClipboard = async (value: string) => {
   try {
      if (navigator.clipboard?.writeText) {
         await navigator.clipboard.writeText(value);
         return;
      }
   } catch {
      // Trusted-LAN HTTP pages often cannot use the modern Clipboard API.
   }

   const textArea = document.createElement('textarea');
   textArea.value = value;
   textArea.setAttribute('readonly', '');
   textArea.style.position = 'fixed';
   textArea.style.opacity = '0';
   document.body.appendChild(textArea);
   textArea.select();
   const copied = document.execCommand('copy');
   textArea.remove();
   if (!copied) throw new Error('Clipboard access was denied.');
};

const AgentEnrollmentModal = ({ close }: AgentEnrollmentProps) => {
   const [name, setName] = useState('');
   const [allowedRoot, setAllowedRoot] = useState('');
   const [enrollment, setEnrollment] = useState<AgentEnrollment | null>(null);
   const [revokeError, setRevokeError] = useState('');
   const [copyError, setCopyError] = useState('');
   const [copiedVariant, setCopiedVariant] = useState<InstallVariant | null>(null);
   const createEnrollment = useCreateAgentEnrollment();
   const revokeEnrollment = useRevokeAgentEnrollment();
   const serverUrl = enrollment?.serverUrl || (typeof window === 'undefined' ? '' : window.location.origin);
   const requiresInsecureHttp = serverUrl.startsWith('http:') && enrollment?.insecureHttpAllowed === true;
   const insecureHttpBlocked = serverUrl.startsWith('http:') && enrollment?.insecureHttpAllowed !== true;
   const sourceRoot = allowedRoot.trim();
   const hasValidSourceRoot = sourceRoot.startsWith('/');
   const canGenerateCommands = enrollment && hasValidSourceRoot && !insecureHttpBlocked;
   const quickInstallCommand = canGenerateCommands ? buildInstallCommand(serverUrl, sourceRoot, requiresInsecureHttp, enrollment.token) : '';
   const secureInstallCommand = canGenerateCommands ? buildInstallCommand(serverUrl, sourceRoot, requiresInsecureHttp) : '';

   const create = async () => {
      try {
         const result = await createEnrollment.mutateAsync(name);
         setEnrollment(result);
      } catch {
         // The UI renders a safe, generic error below.
      }
   };

   const copyCommand = async (variant: InstallVariant, command: string) => {
      setCopyError('');
      try {
         await copyToClipboard(command);
         setCopiedVariant(variant);
      } catch {
         setCopiedVariant(null);
         setCopyError('Could not copy the command. Select and copy it manually.');
      }
   };

   const revoke = async () => {
      if (!enrollment) return;
      try {
         await revokeEnrollment.mutateAsync(enrollment.id);
         close();
      } catch {
         setRevokeError('Could not revoke enrollment token. It may still be active.');
      }
   };

   return (
      <Modal title="Add Remote Machine" width="min(960px, calc(100vw - 32px))" closeModal={close} disableBackdropClick={Boolean(enrollment)}>
         {!enrollment ? (
            <div className={classes.content}>
               <p>
                  Create a single-use enrollment token for a self-hosted Pluton Agent. A capable agent can run the limited remote filesystem backup
                  workflow.
               </p>
               <Input
                  label="Machine name"
                  required={true}
                  full={true}
                  fieldValue={name}
                  placeholder="app-01"
                  onUpdate={setName}
                  error={createEnrollment.isError ? 'Could not create enrollment token.' : ''}
               />
               <div className={classes.actions}>
                  <Button text="Cancel" variant="tertiary" onClick={close} />
                  <Button
                     text={createEnrollment.isPending ? 'Creating…' : 'Create enrollment token'}
                     variant="primary"
                     disabled={!name.trim() || createEnrollment.isPending}
                     onClick={create}
                  />
               </div>
            </div>
         ) : (
            <div className={classes.content}>
               <p className={classes.warning}>Copy this token now. It is not stored in the browser after this dialog closes.</p>
               <label className={classes.label}>One-time enrollment token</label>
               <code className={classes.token}>{enrollment.token}</code>
               <label className={classes.label}>Step 1 — Clone your Pluton community fork</label>
               <pre className={classes.command}>{`git clone ${communityForkUrl} pluton\ncd pluton`}</pre>
               <Input
                  label="Allowed source root"
                  required={true}
                  full={true}
                  fieldValue={allowedRoot}
                  placeholder="/srv/example-app"
                  onUpdate={(value) => {
                     setAllowedRoot(value);
                     setCopiedVariant(null);
                     setCopyError('');
                  }}
                  error={allowedRoot && !hasValidSourceRoot ? 'Enter an absolute Linux path.' : ''}
               />
               <p className={classes.help}>This path is included in the generated command and validated again on the remote host.</p>
               {canGenerateCommands ? (
                  <div className={classes.installOptions}>
                     <section className={classes.installOption} aria-labelledby="quick-install-title">
                        <h4 className={classes.installTitle} id="quick-install-title">
                           Step 2 — Quick install
                        </h4>
                        <p className={classes.quickWarning}>
                           The easiest option for a trusted internal/admin environment. The token is one-time and short-lived, but may be stored in
                           shell history and briefly appear in process listings.
                        </p>
                        <pre className={classes.command}>{quickInstallCommand}</pre>
                        <div className={classes.copyAction}>
                           <Button
                              text={copiedVariant === 'quick' ? 'Copied' : 'Copy quick install command'}
                              variant="secondary"
                              size="sm"
                              icon={copiedVariant === 'quick' ? 'check' : 'copy'}
                              onClick={() => copyCommand('quick', quickInstallCommand)}
                           />
                        </div>
                     </section>
                     <section className={classes.installOption} aria-labelledby="secure-install-title">
                        <h4 className={classes.installTitle} id="secure-install-title">
                           Step 3 — Secure install
                        </h4>
                        <p className={classes.help}>
                           Preferred for public, VPS, or less-trusted environments. The installer requests the token interactively and keeps it out of
                           shell history and process arguments.
                        </p>
                        <pre className={classes.command}>{secureInstallCommand}</pre>
                        <div className={classes.copyAction}>
                           <Button
                              text={copiedVariant === 'secure' ? 'Copied' : 'Copy secure install command'}
                              variant="secondary"
                              size="sm"
                              icon={copiedVariant === 'secure' ? 'check' : 'copy'}
                              onClick={() => copyCommand('secure', secureInstallCommand)}
                           />
                        </div>
                     </section>
                  </div>
               ) : hasValidSourceRoot ? null : (
                  <p className={classes.help}>Enter the absolute source root to generate complete copy-paste installation commands.</p>
               )}
               {insecureHttpBlocked && (
                  <p className={classes.error}>
                     This Pluton server is not configured to accept agent HTTP. Use HTTPS or enable the explicit server-side trusted-LAN setting
                     before installing an agent.
                  </p>
               )}
               {copyError && <p className={classes.error}>{copyError}</p>}
               <label className={classes.label}>Agent service commands</label>
               <pre className={classes.command}>
                  systemctl status pluton-agent{`\n`}sudo ./installers/install-agent.sh uninstall{`\n`}sudo ./installers/install-agent.sh uninstall
                  --purge
               </pre>
               {revokeError && <p className={classes.error}>{revokeError}</p>}
               <p className={classes.help}>
                  For HTTP on a trusted LAN, the server and agent must each explicitly allow insecure HTTP. Backup source metadata and temporary
                  storage credentials cross the control channel, so use HTTPS for every untrusted or public network.
               </p>
               <div className={classes.actions}>
                  <Button text="Revoke token" variant="danger" onClick={revoke} disabled={revokeEnrollment.isPending} />
                  <Button text="Done" variant="primary" onClick={close} />
               </div>
            </div>
         )}
      </Modal>
   );
};

export default AgentEnrollmentModal;
