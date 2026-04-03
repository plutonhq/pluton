import { useCallback, useEffect, useRef, useState } from 'react';
import { storageOptionField } from '../../../@types/storages';
import Tristate from '../../common/form/Tristate/Tristate';
import Icon from '../../common/Icon/Icon';
import classes from '../AddStorage/AddStorage.module.scss';
import StorageSettings from '../StorageSettings/StorageSettings';
import { startStorageAuthorize, getStorageAuthorizeStatus, cancelStorageAuthorize } from '../../../services/storage';

interface StorageAuthSettingsProps {
   storageType: string;
   fields: storageOptionField[];
   settings: Record<string, string | number | boolean>;
   authTypes: string[];
   errors: Record<string, string>;
   currentAuthType: string;
   onUpdate: (newSettings: StorageAuthSettingsProps['settings']) => void;
   onAuthTypeChange: (authType: string) => void;
}

type OAuthStatus = 'idle' | 'authorizing' | 'success' | 'error';

const StorageAuthSettings = ({
   storageType,
   fields,
   settings,
   authTypes,
   currentAuthType,
   errors,
   onUpdate,
   onAuthTypeChange,
}: StorageAuthSettingsProps) => {
   const [showAdvanced, setShowAdvanced] = useState(true);
   const [showOAuthDoc, setShowOAuthDoc] = useState(false);

   // OAuth auto-authorize state
   const [oauthStatus, setOauthStatus] = useState<OAuthStatus>('idle');
   const [authSessionId, setAuthSessionId] = useState<string | null>(null);
   const [authUrl, setAuthUrl] = useState<string | null>(null);
   const [authError, setAuthError] = useState<string | null>(null);
   const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

   const installType = (window as any).plutonInstallType;
   const isDesktop = installType === 'binary' || installType === 'dev';

   console.log('availableAuthTypes :', fields, authTypes, currentAuthType);

   useEffect(() => {
      if (!currentAuthType && authTypes.length > 0) {
         onAuthTypeChange(authTypes[0]);
      }
   }, [authTypes, currentAuthType, onAuthTypeChange]);

   // Cleanup polling on unmount
   useEffect(() => {
      return () => {
         if (pollingRef.current) {
            clearInterval(pollingRef.current);
         }
      };
   }, []);

   const stopPolling = useCallback(() => {
      if (pollingRef.current) {
         clearInterval(pollingRef.current);
         pollingRef.current = null;
      }
   }, []);

   const startOAuthAuthorize = useCallback(async () => {
      setOauthStatus('authorizing');
      setAuthUrl(null);
      setAuthError(null);

      try {
         const { sessionId } = await startStorageAuthorize(storageType);
         setAuthSessionId(sessionId);

         // Start polling every 2 seconds
         pollingRef.current = setInterval(async () => {
            try {
               const result = await getStorageAuthorizeStatus(sessionId);

               if (result.authUrl) {
                  setAuthUrl(result.authUrl);
               }

               if (result.status === 'success' && result.token) {
                  stopPolling();
                  setOauthStatus('success');
                  onUpdate({ ...settings, token: result.token });
               } else if (result.status === 'error') {
                  stopPolling();
                  setOauthStatus('error');
                  setAuthError(result.error || 'Authorization failed');
               }
            } catch (err: any) {
               stopPolling();
               setOauthStatus('error');
               setAuthError(err?.message || 'Failed to check authorization status');
            }
         }, 2000);
      } catch (err: any) {
         setOauthStatus('error');
         setAuthError(err?.message || 'Failed to start authorization');
      }
   }, [storageType, settings, onUpdate, stopPolling]);

   const handleCancelAuthorize = useCallback(async () => {
      stopPolling();
      if (authSessionId) {
         try {
            await cancelStorageAuthorize(authSessionId);
         } catch {
            // Ignore cancel errors
         }
      }
      setOauthStatus('idle');
      setAuthSessionId(null);
      setAuthUrl(null);
      setAuthError(null);
   }, [authSessionId, stopPolling]);

   return (
      <div className={classes.authSettings}>
         <div
            className={`${classes.advancedButton}  ${showAdvanced ? classes.advancedButtonActive : ''}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
         >
            <Icon type={'authentication'} size={14} />
            <span>{storageType === 'local' ? 'Local Storage Setup' : 'Account Authentication'}</span>
            <Icon type={showAdvanced ? 'caret-up' : 'caret-down'} />
         </div>
         {showAdvanced && (
            <div className={classes.advancedOptions}>
               {showAdvanced && authTypes.length > 1 && (
                  <div className={classes.field}>
                     <Tristate
                        label={'Authentication Type'}
                        inline={true}
                        fieldValue={currentAuthType}
                        options={[
                           { label: 'User (oAuth)', value: 'oauth', disabled: authTypes.includes('oauth') === false },
                           { label: 'User/Pass', value: 'password', disabled: authTypes.includes('password') === false },
                           { label: 'App/Client', value: 'client', disabled: authTypes.includes('client') === false },
                        ]}
                        hint={
                           'User (oAuth): Use the generated Link to login to your account and authorize the App.\n Username/Password: Your own Username/Password will be used to backup. \n App/Client: Provide App/Client keys that can be found in your cloud storage account dashboard'
                        }
                        onUpdate={(newVal: string) => onAuthTypeChange(newVal)}
                     />
                  </div>
               )}
               <StorageSettings
                  fields={fields.filter((f) => f.authFieldType === currentAuthType)}
                  settings={settings}
                  onUpdate={(newSettings) => onUpdate(newSettings)}
                  errors={errors}
               />

               {currentAuthType === 'oauth' && isDesktop && oauthStatus === 'idle' && (
                  <div className={classes.oauthButton}>
                     <button className={classes.oauthAuthorizeBtn} onClick={startOAuthAuthorize}>
                        <Icon type={'key'} size={14} /> Authorize & Get Access Token
                     </button>
                  </div>
               )}

               {currentAuthType === 'oauth' && isDesktop && oauthStatus !== 'idle' && (
                  <div className={`${classes.oauthContainer} ${classes[oauthStatus]}`}>
                     {oauthStatus === 'authorizing' && (
                        <div className={classes.oauthProgress}>
                           <p>
                              <strong>Waiting for authorization...</strong>
                              <br />A browser window should have opened. Please authorize the connection in your browser.
                           </p>
                           {authUrl && (
                              <p>
                                 If the browser didn't open automatically,{' '}
                                 <a href={authUrl} target="_blank" rel="noopener noreferrer">
                                    click here to authorize
                                 </a>
                                 .
                              </p>
                           )}
                           <button className={classes.oauthInnerBtn} onClick={handleCancelAuthorize}>
                              Cancel
                           </button>
                        </div>
                     )}
                     {oauthStatus === 'success' && (
                        <div className={classes.oauthProgress}>
                           <p>
                              <Icon type={'check'} size={14} /> <strong>Authorization successful!</strong> Token has been automatically filled in.
                           </p>
                        </div>
                     )}
                     {oauthStatus === 'error' && (
                        <div className={classes.oauthProgress}>
                           <p>
                              <strong>Authorization failed:</strong> {authError}
                           </p>
                           <button className={classes.oauthInnerBtn} onClick={startOAuthAuthorize}>
                              <Icon type={'key'} size={14} /> Try Again
                           </button>
                        </div>
                     )}
                  </div>
               )}

               {currentAuthType === 'oauth' && !isDesktop && (
                  <div className={classes.oauthDoc}>
                     <h4 onClick={() => setShowOAuthDoc(!showOAuthDoc)}>
                        <Icon type={'key'} size={14} /> Acquiring the OAuth Access Token
                        <button>
                           <Icon type={showOAuthDoc ? 'caret-up' : 'caret-down'} />
                        </button>
                     </h4>
                     {showOAuthDoc && (
                        <>
                           <p>
                              <strong>Step 1:</strong> On a machine with a browser,{' '}
                              <a href="https://rclone.org/downloads/" target="_blank">
                                 install rclone
                              </a>{' '}
                              and execute this command in the CLI: <code className={classes.codeBlock}>rclone authorize {storageType}</code>
                           </p>
                           <p>
                              <strong>Step 2:</strong> A browser window will open where you will need to authorize Rclone to connect to your{' '}
                              {storageType} account. Authorize the connection.
                           </p>
                           <p>
                              <strong>Step 3:</strong> Once authorized, the cli where you ran the command, should display a message similar to this:
                              <code className={classes.codeBlock}>
                                 {`Paste the following into your remote machine --->`}
                                 <strong>{`{"access_token":"....","token_type":"bearer...}`}</strong>
                                 {`<---End paste`}
                              </code>
                              Copy everything between <code>{`--->`}</code> and <code>{`<---`}</code>. Eg:{' '}
                              <code>{`{"access_token":"....","token_type":"bearer...}`}</code>
                           </p>
                           <p>
                              <strong>Step 4:</strong> Paste the copied content in the <strong>OAuth Access Token</strong> field above.
                           </p>
                           <p>
                              <strong>Step 5:</strong> If you no longer need Rclone, you can safely remove it from your system.
                           </p>
                        </>
                     )}
                  </div>
               )}
            </div>
         )}
      </div>
   );
};
export default StorageAuthSettings;
