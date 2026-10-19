import { useState } from 'react';
import { Link } from 'react-router';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import Icon from '../../components/common/Icon/Icon';
import { useLegacyRepositories } from '../../services/legacyRepositories';
import type { LegacyRepository } from '../../@types/legacyRepositories';
import { formatDateTime } from '../../utils/helpers';
import RegisterLegacyRepository from './RegisterLegacyRepository';
import classes from './LegacyRepositories.module.scss';
import { CollectionToolbar, CollectionPagination } from '../../components/common/Table/CollectionControls';
import { useCollectionPage } from '../../components/common/Table/useCollectionPage';
import { stableCollectionSort } from '../../components/common/Table/collection';

const LegacyRepositories = () => {
   const [showRegistration, setShowRegistration] = useState(false);
   const { data, isLoading, error } = useLegacyRepositories();
   const repositories: LegacyRepository[] = data?.result || [];
   const [search, setSearch] = useState('');
   const [status, setStatus] = useState('');
   const [sort, setSort] = useState('name_asc');
   const rows = stableCollectionSort(
      repositories.filter(
         (repository) =>
            `${repository.displayName} ${repository.repositoryPath}`.toLowerCase().includes(search.trim().toLowerCase()) &&
            (!status || repository.validationStatus === status),
      ),
      (a, b) => (sort === 'name_desc' ? -1 : 1) * a.displayName.localeCompare(b.displayName),
   );
   const page = useCollectionPage(rows, JSON.stringify([search, status, sort]));

   return (
      <div className={classes.page}>
         <PageHeader title="Legacy Repositories" icon="storages" buttonTitle="+ Register" buttonAction={() => setShowRegistration(true)} />
         <div className={classes.readOnlyNotice}>
            <Icon type="lock" size={17} />
            <div>
               <strong>READ ONLY</strong>
               <p>
                  Legacy repositories remain outside Pluton's backup and retention lifecycle. This area browses snapshots and restores selected
                  content only to isolated staging.
               </p>
            </div>
         </div>
         <CollectionToolbar
            label="legacy repositories"
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={setSort}
            options={[
               { label: 'Name (A to Z)', value: 'name_asc' },
               { label: 'Name (Z to A)', value: 'name_desc' },
            ]}
         >
            <label>
               Validation status
               <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">All statuses</option>
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="unknown">Unknown</option>
               </select>
            </label>
         </CollectionToolbar>
         {error && (
            <div role="alert" className={classes.errorMessage}>
               {(error as Error).message}
            </div>
         )}
         {isLoading && (
            <div className="loadingScreen">
               <Icon size={45} type="loading" />
            </div>
         )}
         {!isLoading && !error && rows.length === 0 && (
            <div className="empty_container">
               <p>
                  {repositories.length ? (
                     'No legacy repositories match the current filters.'
                  ) : (
                     <>
                        No legacy repositories are registered. <button onClick={() => setShowRegistration(true)}>+ Register a repository</button> to
                        inspect its snapshots.
                     </>
                  )}
               </p>
            </div>
         )}
         <div className={classes.repositoryList}>
            {!isLoading &&
               page.items.map((repository) => (
                  <Link className={classes.repositoryCard} to={`/legacy-repositories/${repository.id}`} key={repository.id}>
                     <div className={classes.repositoryIdentity}>
                        <Icon type="storages" size={22} />
                        <div>
                           <h3>{repository.displayName}</h3>
                           <p>{repository.repositoryPath}</p>
                        </div>
                     </div>
                     <div className={classes.repositoryMeta}>
                        <span className={`${classes.status} ${classes[repository.validationStatus]}`}>{repository.validationStatus}</span>
                        <span className={classes.readOnlyPill}>
                           <Icon type="lock" size={12} /> READ ONLY
                        </span>
                        <span>Checked {repository.lastValidatedAt ? formatDateTime(repository.lastValidatedAt) : 'not yet'}</span>
                     </div>
                  </Link>
               ))}
         </div>
         {!error && <CollectionPagination label="legacy repositories" {...page} busy={isLoading} />}
         {showRegistration && <RegisterLegacyRepository close={() => setShowRegistration(false)} />}
      </div>
   );
};

export default LegacyRepositories;
