import { useEffect, useState } from 'react';
import { storageOptionField } from '../../../@types/storages';
import Tristate from '../../common/form/Tristate/Tristate';
import Icon from '../../common/Icon/Icon';
import classes from '../AddStorage/AddStorage.module.scss';
import StorageSettings from '../StorageSettings/StorageSettings';

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

   console.log('availableAuthTypes :', fields, authTypes, currentAuthType);

   useEffect(() => {
      if (!currentAuthType && authTypes.length > 0) {
         onAuthTypeChange(authTypes[0]);
      }
   }, [authTypes, currentAuthType, onAuthTypeChange]);

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
               {currentAuthType === 'oauth' && (
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
