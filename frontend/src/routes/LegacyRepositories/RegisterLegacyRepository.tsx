import { useState, type FormEvent } from 'react';
import { toast } from 'react-toastify';
import Icon from '../../components/common/Icon/Icon';
import SidePanel from '../../components/common/SidePanel/SidePanel';
import { useRegisterLegacyRepository } from '../../services/legacyRepositories';
import classes from './LegacyRepositories.module.scss';

type RegisterLegacyRepositoryProps = {
   close: () => void;
};

const RegisterLegacyRepository = ({ close }: RegisterLegacyRepositoryProps) => {
   const [displayName, setDisplayName] = useState('');
   const [repositoryPath, setRepositoryPath] = useState('');
   const [password, setPassword] = useState('');
   const registerMutation = useRegisterLegacyRepository();

   const registerRepository = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      registerMutation.mutate(
         { displayName, repositoryPath, password },
         {
            onSuccess: () => {
               toast.success('Legacy repository registered for read-only inspection.', { autoClose: 5000 });
               close();
            },
            onError: (error: Error) => toast.error(error.message),
         }
      );
   };

   return (
      <SidePanel
         close={close}
         title="Register Legacy Repository"
         icon={<Icon type="lock" size={18} />}
         footer={
            <button className={classes.primaryButton} type="submit" form="legacy-repository-registration" disabled={registerMutation.isPending}>
               <Icon type={registerMutation.isPending ? 'loading' : 'check'} size={13} /> Register read-only repository
            </button>
         }
      >
         <form id="legacy-repository-registration" onSubmit={registerRepository}>
            <div className={classes.readOnlyNotice}>
               <Icon type="lock" size={16} />
               <div>
                  <strong>READ ONLY</strong>
                  <p>Pluton validates access and browses snapshots. Selected content can be restored only to isolated staging; it will not create, retain, delete, or modify this repository.</p>
               </div>
            </div>
            <div className={classes.field}>
               <label htmlFor="legacy-display-name">Display name</label>
               <input
                  id="legacy-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={100}
                  required
                  autoComplete="off"
               />
            </div>
            <div className={classes.field}>
               <label htmlFor="legacy-repository-path">Local repository path</label>
               <input
                  id="legacy-repository-path"
                  value={repositoryPath}
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  required
                  autoComplete="off"
                  placeholder="C:\\backups\\legacy-repository"
               />
               <small>The path must be absolute on this Pluton server.</small>
            </div>
            <div className={classes.field}>
               <label htmlFor="legacy-repository-password">Repository password</label>
               <input
                  id="legacy-repository-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="new-password"
               />
               <small>The password is encrypted before the local registration is saved and is never shown again.</small>
            </div>
         </form>
      </SidePanel>
   );
};

export default RegisterLegacyRepository;
