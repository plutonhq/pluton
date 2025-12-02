import { useState } from 'react';
import { useNavigate } from 'react-router';
import classes from './Setup.module.scss';
import Logo from '../../components/common/Logo/Logo';
import { APP_NAME } from '../../utils/constants';
import Icon from '../../components/common/Icon/Icon';
import PageTitle from '../../components/App/PageTitle/PageTitle';
import { useSetupStatus, useCompleteSetup } from '../../services/settings';

const Setup = () => {
   const navigate = useNavigate();
   const [encryptionKey, setEncryptionKey] = useState<string>('');
   const [userName, setUserName] = useState<string>('admin');
   const [userPassword, setUserPassword] = useState<string>('');
   const [confirmPassword, setConfirmPassword] = useState<string>('');
   const [error, setError] = useState<string | null>(null);
   const [success, setSuccess] = useState<boolean>(false);

   const { data: statusData, isLoading: statusLoading, isError: statusError } = useSetupStatus();
   const setupMutation = useCompleteSetup();

   const handleSetup = () => {
      setError(null);

      // Validate encryption key
      if (!encryptionKey || encryptionKey.length < 12) {
         setError('Encryption key must be at least 12 characters long');
         return;
      }

      // Validate username
      if (!userName || userName.length < 1) {
         setError('Username cannot be empty');
         return;
      }

      // Validate password
      if (!userPassword || userPassword.length < 1) {
         setError('Password cannot be empty');
         return;
      }

      // Validate password confirmation
      if (userPassword !== confirmPassword) {
         setError('Passwords do not match');
         return;
      }

      setupMutation.mutate(
         {
            encryptionKey,
            userName,
            userPassword,
         },
         {
            onSuccess: (res) => {
               if (res.success) {
                  setSuccess(true);
                  setError(null);
                  // Redirect to login after 2 seconds
                  setTimeout(() => {
                     navigate('/login');
                  }, 2000);
               } else {
                  setError(res.error || 'Setup failed');
               }
            },
            onError: (err: Error) => {
               setError(err.message || 'Setup failed');
            },
         },
      );
   };

   // Show loading state
   if (statusLoading) {
      return (
         <div className={classes.setupPage}>
            <PageTitle title="Initial Setup" />
            <div className={classes.setupLogo}>
               <h3>
                  <Logo size={40} /> <span>{APP_NAME}</span>
               </h3>
            </div>
            <div className={classes.setupContainer}>
               <div className={classes.loadingSpinner}>
                  <Icon size={40} type="loading" />
               </div>
            </div>
         </div>
      );
   }

   // If setup is not pending, redirect to login
   if (statusData && !statusData.data.setupPending) {
      navigate('/login');
      return null;
   }

   // Show error if status check failed
   if (statusError) {
      return (
         <div className={classes.setupPage}>
            <PageTitle title="Initial Setup" />
            <div className={classes.setupLogo}>
               <h3>
                  <Logo size={40} /> <span>{APP_NAME}</span>
               </h3>
            </div>
            <div className={classes.setupContainer}>
               <div className={classes.setupErrorMsg}>Failed to check setup status. Please refresh the page.</div>
            </div>
         </div>
      );
   }

   return (
      <div className={classes.setupPage}>
         <PageTitle title="Initial Setup" />
         <div className={classes.setupLogo}>
            <h3>
               <Logo size={40} /> <span>{APP_NAME}</span>
            </h3>
         </div>
         <div className={classes.setupContainer}>
            <div className={classes.setupHeader}>
               <h2>Initial Setup</h2>
               <p>Configure your {APP_NAME} installation. These credentials will be securely stored in your system's credential manager.</p>
            </div>

            <div className={classes.setupInfoBox}>
               <p>
                  Your encryption key will be used to encrypt all your backups.
                  <strong> Keep it safe - if you lose it, you won't be able to restore your backups!</strong>
               </p>
            </div>

            {success ? (
               <div className={classes.setupSuccessMsg}>Setup completed successfully! Redirecting to login...</div>
            ) : (
               <div className={classes.setupForm}>
                  <div className={classes.setupInput}>
                     <label>Encryption Key</label>
                     <Icon type="lock" classes={classes.setupInputIcon} />
                     <input
                        type="password"
                        value={encryptionKey}
                        placeholder="Enter encryption key (min 12 characters)"
                        onChange={(e) => setEncryptionKey(e.target.value)}
                     />
                     <div className={classes.inputHint}>Used to encrypt all your backups. Minimum 12 characters.</div>
                  </div>

                  <div className={classes.setupInput}>
                     <label>Admin Username</label>
                     <Icon type="user" classes={classes.setupInputIcon} />
                     <input type="text" value={userName} placeholder="Enter admin username" onChange={(e) => setUserName(e.target.value)} />
                  </div>

                  <div className={classes.setupInput}>
                     <label>Admin Password</label>
                     <Icon type="password" classes={classes.setupInputIcon} />
                     <input
                        type="password"
                        value={userPassword}
                        placeholder="Enter admin password"
                        onChange={(e) => setUserPassword(e.target.value)}
                     />
                  </div>

                  <div className={classes.setupInput}>
                     <label>Confirm Password</label>
                     <Icon type="password" classes={classes.setupInputIcon} />
                     <input
                        type="password"
                        value={confirmPassword}
                        placeholder="Confirm admin password"
                        onChange={(e) => setConfirmPassword(e.target.value)}
                     />
                  </div>

                  <button className={classes.setupButton} onClick={handleSetup} disabled={setupMutation.isPending}>
                     {setupMutation.isPending ? 'Setting up...' : 'Complete Setup'}
                  </button>

                  {error && <div className={classes.setupErrorMsg}>{error}</div>}
               </div>
            )}
         </div>
      </div>
   );
};

export default Setup;
