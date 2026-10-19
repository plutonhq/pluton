import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'react-toastify';
import ActionModal from '../../components/common/ActionModal/ActionModal';
import Icon from '../../components/common/Icon/Icon';
import NotFound from '../../components/common/NotFound/NotFound';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import {
   useDeleteLegacyRepository,
   useLegacyRepository,
   useLegacyRepositorySnapshots,
   useLegacyRepositoryStats,
   useValidateLegacyRepository,
} from '../../services/legacyRepositories';
import type {
   LegacyRepositorySnapshotFilters,
   LegacyRepositorySnapshot,
   LegacyRepositorySnapshotPageSize,
} from '../../@types/legacyRepositories';
import { formatBytes, formatDateTime } from '../../utils/helpers';
import classes from './LegacyRepositories.module.scss';
import LegacySnapshotBrowser from './LegacySnapshotBrowser';

const LegacyRepositoryDetail = () => {
   const { id } = useParams();
   const navigate = useNavigate();
   const [filters, setFilters] = useState<LegacyRepositorySnapshotFilters>({});
   const [draftFilters, setDraftFilters] = useState<LegacyRepositorySnapshotFilters>({});
   const [page, setPage] = useState(1);
   const [pageSize, setPageSize] = useState<LegacyRepositorySnapshotPageSize>(30);
   const [selectedSnapshot, setSelectedSnapshot] = useState<LegacyRepositorySnapshot>();
   const [showDelete, setShowDelete] = useState(false);
   const { data: repositoryData, isLoading: repositoryLoading, error: repositoryError } = useLegacyRepository(id);
   const snapshotQueryFilters = useMemo(
      () => ({ ...filters, page, pageSize }),
      [filters, page, pageSize]
   );
   const { data: snapshotsData, isLoading: snapshotsLoading, error: snapshotsError } = useLegacyRepositorySnapshots(id, snapshotQueryFilters);
   const { data: statsData, isLoading: statsLoading, error: statsError } = useLegacyRepositoryStats(id);
   const validateMutation = useValidateLegacyRepository();
   const deleteMutation = useDeleteLegacyRepository();
   const repository = repositoryData?.result;
   const snapshotPage = snapshotsData?.result;
   const snapshots = snapshotPage?.items || [];
   const workloads = snapshotPage?.workloads || [];
   const datasets = snapshotPage?.datasets || [];
   const stats = statsData?.result;
   const currentPage = snapshotPage?.page || page;
   const totalPages = snapshotPage?.totalPages || 0;
   const totalSnapshots = snapshotPage?.total || 0;
   const showingStart = totalSnapshots === 0 ? 0 : pageSize === 'all' ? 1 : (currentPage - 1) * pageSize + 1;
   const showingEnd = totalSnapshots === 0 ? 0 : Math.min(totalSnapshots, showingStart + snapshots.length - 1);

   const visiblePages = getVisiblePages(currentPage, totalPages);

   if (!id || (repositoryError && !repositoryLoading)) {
      return <NotFound name="Legacy repository" link="/legacy-repositories" linkText="All Legacy Repositories" />;
   }

   const applyFilters = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFilters({
         tag: draftFilters.tag?.trim() || undefined,
         path: draftFilters.path?.trim() || undefined,
         host: draftFilters.host?.trim() || undefined,
         workload: draftFilters.workload || undefined,
         dataset: draftFilters.dataset || undefined,
      });
      setPage(1);
   };

   const clearFilters = () => {
      setDraftFilters({});
      setFilters({});
      setPage(1);
   };

   const changeWorkload = (workload: string) => {
      const nextWorkload = workload || undefined;
      setDraftFilters((current) => ({ ...current, workload: nextWorkload, dataset: undefined }));
      setFilters((current) => ({ ...current, workload: nextWorkload, dataset: undefined }));
      setPage(1);
   };

   const changeDataset = (dataset: string) => {
      const nextDataset = dataset || undefined;
      setDraftFilters((current) => ({ ...current, dataset: nextDataset }));
      setFilters((current) => ({ ...current, dataset: nextDataset }));
      setPage(1);
   };

   const changePageSize = (value: string) => {
      const nextPageSize = value === 'all' ? 'all' : Number(value) as LegacyRepositorySnapshotPageSize;
      setPageSize(nextPageSize);
      setPage(1);
   };

   const validateAccess = () => {
      validateMutation.mutate(id, {
         onSuccess: () => toast.success('Repository access checked successfully.', { autoClose: 5000 }),
         onError: (error: Error) => toast.error(error.message),
      });
   };

   const deleteRegistration = () => {
      deleteMutation.mutate(id, {
         onSuccess: () => {
            toast.success('Legacy repository registration removed. The repository was not modified.', { autoClose: 5000 });
            navigate('/legacy-repositories');
         },
         onError: (error: Error) => toast.error(error.message),
      });
   };

   return (
      <div className={classes.page}>
         <Link className={classes.backLink} to="/legacy-repositories">← Legacy Repositories</Link>
         {repositoryLoading || !repository ? (
            <div className="loadingScreen"><Icon size={45} type="loading" /></div>
         ) : (
            <>
               <PageHeader
                  title={repository.displayName}
                  pageTitle={repository.displayName}
                  icon="storages"
                  rightSection={
                     <>
                        <button className={classes.secondaryButton} onClick={validateAccess} disabled={validateMutation.isPending}>
                           <Icon type={validateMutation.isPending ? 'loading' : 'verify'} size={14} /> Check access
                        </button>
                        <button className={classes.dangerButton} onClick={() => setShowDelete(true)}>
                           <Icon type="trash" size={14} /> Remove registration
                        </button>
                     </>
                  }
               />
               <div className={classes.readOnlyNotice}>
                  <Icon type="lock" size={17} />
                  <div>
                     <strong>READ ONLY</strong>
                     <p>Browsing reads repository metadata. Selected files or directories can be restored only to isolated staging; backup, retention, prune, repair, migration, initialization, and lock cleanup remain unavailable.</p>
                  </div>
               </div>
               <section className={classes.summaryGrid}>
                  <div className={classes.summaryCard}>
                     <span>Repository path</span>
                     <strong className={classes.pathValue}>{repository.repositoryPath}</strong>
                  </div>
                  <div className={classes.summaryCard}>
                     <span>Status</span>
                     <strong className={`${classes.status} ${classes[repository.validationStatus]}`}>{repository.validationStatus}</strong>
                     <small>{repository.lastValidatedAt ? `Last checked ${formatDateTime(repository.lastValidatedAt)}` : 'Not checked yet'}</small>
                  </div>
                  <div className={classes.summaryCard}>
                     <span>Backend</span>
                     <strong>Local filesystem</strong>
                     <small>Registered {formatDateTime(repository.createdAt)}</small>
                  </div>
               </section>
               <section className={classes.section}>
                  <div className={classes.sectionHeader}>
                     <div>
                        <h3>Safe repository statistics</h3>
                        <p>Read-only metadata reported by Restic when supported.</p>
                     </div>
                  </div>
                  {statsLoading && <Icon type="loading" size={20} />}
                  {statsError && <p className={classes.safeError}>{(statsError as Error).message}</p>}
                  {stats && (
                     <div className={classes.statsGrid}>
                        <div><span>Snapshots</span><strong>{stats.snapshotCount}</strong></div>
                        <div><span>Stored size</span><strong>{formatBytes(stats.totalSize)}</strong></div>
                        <div><span>Uncompressed size</span><strong>{formatBytes(stats.totalUncompressedSize)}</strong></div>
                        <div><span>Compression</span><strong>{stats.compressionRatio.toFixed(2)}×</strong></div>
                     </div>
                  )}
               </section>
               <section className={classes.section}>
                  <div className={classes.sectionHeader}>
                     <div>
                        <h3>Snapshots</h3>
                        <p>Browse structured snapshot entries, choose files or directories, then restore them only to isolated staging.</p>
                     </div>
                  </div>
                  <form className={classes.filterPanel} onSubmit={applyFilters}>
                     <div className={classes.groupingFilters}>
                        <label className={classes.filterField}>
                           <span>Workload</span>
                           <select aria-label="Filter by workload" value={filters.workload || ''} onChange={(event) => changeWorkload(event.target.value)}>
                              <option value="">All workloads</option>
                              {workloads.map((workload) => <option key={workload} value={workload}>{workload}</option>)}
                           </select>
                        </label>
                        <label className={classes.filterField}>
                           <span>Dataset</span>
                           <select aria-label="Filter by dataset" value={filters.dataset || ''} onChange={(event) => changeDataset(event.target.value)}>
                              <option value="">All datasets</option>
                              {datasets.map((dataset) => <option key={dataset} value={dataset}>{dataset}</option>)}
                           </select>
                        </label>
                     </div>
                     <details className={classes.advancedFilters}>
                        <summary>Advanced filters</summary>
                        <div className={classes.filters}>
                           <input aria-label="Filter by tag" value={draftFilters.tag || ''} onChange={(event) => setDraftFilters({ ...draftFilters, tag: event.target.value })} placeholder="Tag" />
                           <input aria-label="Filter by path" value={draftFilters.path || ''} onChange={(event) => setDraftFilters({ ...draftFilters, path: event.target.value })} placeholder="Exact path" />
                           <input aria-label="Filter by host" value={draftFilters.host || ''} onChange={(event) => setDraftFilters({ ...draftFilters, host: event.target.value })} placeholder="Host" />
                        </div>
                     </details>
                     <div className={classes.filterActions}>
                        <button className={classes.secondaryButton} type="submit">Apply filters</button>
                        <button className={classes.textButton} type="button" onClick={clearFilters}>Clear</button>
                     </div>
                  </form>
                  {snapshotsError && <p className={classes.safeError}>{(snapshotsError as Error).message}</p>}
                  {snapshotsLoading && <Icon type="loading" size={20} />}
                  {!snapshotsLoading && !snapshotsError && snapshots.length === 0 && <p className={classes.emptyText}>No snapshots match the current filters.</p>}
                  <div className={classes.snapshotPaginationHeader}>
                     <span>Showing {showingStart}-{showingEnd} of {totalSnapshots} snapshots</span>
                     <label>
                        Snapshots per page
                        <select aria-label="Snapshots per page" value={pageSize} onChange={(event) => changePageSize(event.target.value)}>
                           <option value="10">10</option>
                           <option value="30">30</option>
                           <option value="60">60</option>
                           <option value="100">100</option>
                           <option value="all">All</option>
                        </select>
                     </label>
                  </div>
                  <div className={classes.snapshotList}>
                     {snapshots.map((snapshot) => (
                        <button className={classes.snapshotRow} type="button" key={snapshot.id} onClick={() => setSelectedSnapshot(snapshot)}>
                           <div><strong>{snapshot.shortId}</strong><span>{formatDateTime(snapshot.time)}</span></div>
                           <div><span>{snapshot.hostname || 'Unknown host'}</span><span>{snapshot.tags.length ? snapshot.tags.join(', ') : 'No tags'}</span></div>
                           <span>{snapshot.paths.length} path{snapshot.paths.length === 1 ? '' : 's'}</span>
                        </button>
                     ))}
                  </div>
                  {totalPages > 1 && (
                     <nav className={classes.pagination} aria-label="Legacy snapshot pages">
                        <button type="button" className={classes.pageButton} onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>Previous</button>
                        {visiblePages.map((item, index) => item === 'ellipsis' ? (
                           <span className={classes.pageEllipsis} key={`ellipsis-${index}`}>…</span>
                        ) : (
                           <button type="button" className={`${classes.pageButton} ${item === currentPage ? classes.activePage : ''}`} key={item} onClick={() => setPage(item)} aria-current={item === currentPage ? 'page' : undefined}>{item}</button>
                        ))}
                        <button type="button" className={classes.pageButton} onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}>Next</button>
                     </nav>
                  )}
               </section>
            </>
         )}
         {selectedSnapshot && (
            <LegacySnapshotBrowser repositoryId={id} snapshot={selectedSnapshot} close={() => setSelectedSnapshot(undefined)} />
         )}
         {showDelete && repository && (
            <ActionModal
               title="Remove legacy repository registration"
               message={<>This removes only Pluton's local registration for <strong>{repository.displayName}</strong>. The repository and its snapshots will not be changed.</>}
               closeModal={() => setShowDelete(false)}
               primaryAction={{
                  title: 'Remove registration',
                  type: 'danger',
                  icon: 'trash',
                  isPending: deleteMutation.isPending,
                  action: deleteRegistration,
               }}
            />
         )}
      </div>
   );
};

function getVisiblePages(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
   if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

   const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
   const ordered = [...pages].filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages).sort((a, b) => a - b);
   const result: Array<number | 'ellipsis'> = [];
   ordered.forEach((pageNumber, index) => {
      if (index > 0 && pageNumber - ordered[index - 1] > 1) result.push('ellipsis');
      result.push(pageNumber);
   });
   return result;
}

export default LegacyRepositoryDetail;
