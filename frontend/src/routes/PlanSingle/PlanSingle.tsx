import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import Icon from '../../components/common/Icon/Icon';
import EditPlan from '../../components/Plan/EditPlan/EditPlan';
import PlanLogs from '../../components/Plan/PlanLogs/PlanLogs';
import { useComponentOverride } from '../../context/ComponentOverrideContext';
import PlanStats from '../../components/Plan/PlanStats/PlanStats';
import { usePlanSingleActions } from '../../hooks/usePlanSingleActions';
import classes from './PlanSingle.module.scss';
import NotFound from '../../components/common/NotFound/NotFound';
import PlanPruneModal from '../../components/Plan/PlanPruneModal/PlanPruneModal';
import PlanUnlockModal from '../../components/Plan/PlanUnlockModal/PlanUnlockModal';
import PlanRemoveModal from '../../components/Plan/PlanRemoveModal/PlanRemoveModal';
import PlanProgress from '../../components/Plan/PlanProgress/PlanProgress';
import PlanBackups from '../../components/Plan/PlanBackups/PlanBackups';

const PlanSingle = () => {
   const [showMoreOptions, setShowMoreOptions] = useState(false);
   const { id } = useParams();

   const EditPlanModal = useComponentOverride('EditPlan', EditPlan);

   const [searchParams] = useSearchParams();
   const isBackupPending = searchParams.get('pendingbackup') === '1';

   const {
      showDeleteModal,
      setShowDeleteModal,
      showEditModal,
      setShowEditModal,
      showPruneModal,
      setShowPruneModal,
      showLogsModal,
      setShowLogsModal,
      showUnlockModal,
      setShowUnlockModal,

      plan,
      isLoading,
      refetchPlan,
      activeBackups,
      activeRestores,
      lastBackupItem,
      taskPending,
      planError,
      actionInProgress,
      changeStatus,
      backupNow,
   } = usePlanSingleActions();

   // const errorMessage = planError?.message;
   const errorStatusCode = (planError as Error & { status?: number })?.status;
   if (!id || errorStatusCode === 404) {
      return <NotFound name="Plan" link="/" />;
   } else {
      if (isLoading) {
         return (
            <div className="loadingScreen">
               <Icon size={60} type="loading" />
            </div>
         );
      }

      const { isActive, method, title, description, stats, settings } = plan;
      const prune = settings.prune;
      const snapshotsCount = stats.snapshots?.length || 0;
      const isSync = method === 'sync';

      return (
         <div className={classes.planSingle}>
            <PageHeader
               title={
                  <>
                     {title}{' '}
                     {description && (
                        <span className={classes.planDescription} data-tooltip-id="appTooltip" data-tooltip-content={description}>
                           <Icon type="note" size={13} />
                        </span>
                     )}
                     {!isActive && (
                        <span className="label warn">
                           <Icon size={14} type={'pause'} color="#bf8d20" /> Paused
                        </span>
                     )}
                  </>
               }
               pageTitle={title}
               icon="plans"
               rightSection={
                  <>
                     <div className={classes.planActions}>
                        <button className={classes.actionBtn} onClick={backupNow}>
                           <Icon size={14} type={isSync ? 'sync' : 'backup'} /> {isSync ? 'Sync' : 'Backup'} Now
                        </button>
                        <button className={`${classes.actionBtn} ${!isActive ? classes.actionBtnHighlight : ''}`} onClick={changeStatus}>
                           <Icon size={14} type={isActive ? 'pause' : 'resume'} /> {isActive ? 'Pause' : 'Resume'}
                        </button>
                        <button className={classes.actionBtn} onClick={() => setShowEditModal(true)}>
                           <Icon size={14} type="edit-settings" /> Edit
                        </button>
                        <button className={`${classes.actionBtn} ${classes.actionMoreBtn}`} onClick={() => setShowMoreOptions(!showMoreOptions)}>
                           <Icon size={14} type="dots-vertical" />
                        </button>

                        {showMoreOptions && (
                           <ul className={classes.moreOptions}>
                              <li
                                 className={classes.actionBtn}
                                 onClick={() => {
                                    setShowPruneModal(true);
                                    setShowMoreOptions(false);
                                 }}
                              >
                                 <Icon size={14} type="prune" /> Clean Up
                              </li>
                              {!isSync && (
                                 <li
                                    className={classes.actionBtn}
                                    onClick={() => {
                                       setShowUnlockModal(true);
                                       setShowMoreOptions(false);
                                    }}
                                 >
                                    <Icon size={14} type="unlock" /> Unlock
                                 </li>
                              )}
                              <li
                                 className={classes.actionBtn}
                                 onClick={() => {
                                    setShowLogsModal(true);
                                    setShowMoreOptions(false);
                                 }}
                              >
                                 <Icon size={14} type="logs" /> View Logs
                              </li>
                              <li
                                 className={classes.actionBtn}
                                 onClick={() => {
                                    setShowDeleteModal(true);
                                    setShowMoreOptions(false);
                                 }}
                              >
                                 <Icon size={14} type="trash" /> Remove
                              </li>
                           </ul>
                        )}
                     </div>
                  </>
               }
            />
            <div className={classes.planContent}>
               <PlanStats plan={plan} isSync={isSync} lastBackupItem={lastBackupItem} />
               <PlanProgress
                  plan={plan}
                  isBackupPending={isBackupPending}
                  activeBackups={activeBackups}
                  activeRestores={activeRestores}
                  refetchPlan={refetchPlan}
               />
               <PlanBackups plan={plan} />
            </div>

            {/* Action Modals */}
            {showPruneModal && (
               <PlanPruneModal
                  planId={id}
                  method={plan.method}
                  prune={prune}
                  snapshotsCount={snapshotsCount}
                  taskPending={taskPending}
                  close={() => setShowPruneModal(false)}
               />
            )}
            {showDeleteModal && (
               <PlanRemoveModal planId={id} taskPending={taskPending} actionInProgress={actionInProgress} close={() => setShowDeleteModal(false)} />
            )}
            {showUnlockModal && <PlanUnlockModal planId={id} taskPending={taskPending} close={() => setShowUnlockModal(false)} />}
            {showEditModal && <EditPlanModal plan={plan} close={() => setShowEditModal(false)} />}
            {showLogsModal && <PlanLogs planId={id} planMethod={plan.method} sourceType={plan.sourceType} close={() => setShowLogsModal(false)} />}
         </div>
      );
   }
};

export default PlanSingle;
