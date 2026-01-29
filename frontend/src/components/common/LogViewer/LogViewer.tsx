import { useState, useEffect } from 'react';
import Icon from '../Icon/Icon';
import classes from './LogViewer.module.scss';
import { useGetDownloadLogs } from '../../../services/plans';
import { getLogLevelName } from '../../../utils/helpers';
import { useGetDownloadAppLogs } from '../../../services/settings';
import MultiSelect from '../form/MultiSelect/MultiSelect';
import { LogItem } from '../../../@types/settings';

interface LogViewerProps {
   type: string;
   planId?: string;
   planMethod?: string;
   sourceType?: string;
   settingsID?: string;
   isLoading: boolean;
   logs: LogItem[];
}

const logTypes = ['info', 'error', 'warn'];
const ITEMS_PER_PAGE = 500;
const PAGINATION_THRESHOLD = 1000;

const LogViewer = ({ type = '', planMethod = 'backup', logs = [], planId, settingsID = '1', isLoading }: LogViewerProps) => {
   const allTaskTypes = [...new Set(logs.map((log) => log.module))];
   const [search, setSearch] = useState('');
   const [filters, setFilters] = useState<string[]>(['info', 'error', 'warn']);
   const [taskTypes, setTaskTypes] = useState<string[]>([]);
   const [currentPage, setCurrentPage] = useState(1);
   const downloadPlanLogsMutation = useGetDownloadLogs();
   const downloadAppLogsMutation = useGetDownloadAppLogs();

   useEffect(() => {
      if (allTaskTypes.length > 0 && taskTypes.length === 0) {
         setTaskTypes(allTaskTypes);
      }
   }, [allTaskTypes.length]);

   const theLogs = logs
      .filter((log) => {
         const matchesSearch = log.msg?.toLowerCase().includes(search.toLowerCase());
         const matchesBackupId = log.backupId?.toLowerCase().includes(search.toLowerCase());
         const logType = getLogLevelName(log.level);
         const matchesFilter = filters.includes(logType);
         const matchesTaskType = taskTypes.includes(log.module);
         return (matchesSearch || matchesBackupId) && matchesFilter && matchesTaskType;
      })
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

   const showPagination = theLogs.length > PAGINATION_THRESHOLD;
   const totalPages = Math.ceil(theLogs.length / ITEMS_PER_PAGE);
   const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
   const endIndex = startIndex + ITEMS_PER_PAGE;
   const paginatedLogs = showPagination ? theLogs.slice(startIndex, endIndex) : theLogs;

   const handlePageChange = (page: number) => {
      setCurrentPage(page);
   };

   const getPageNumbers = () => {
      const pages = [];
      const maxVisiblePages = 5;
      let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

      if (endPage - startPage < maxVisiblePages - 1) {
         startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }

      for (let i = startPage; i <= endPage; i++) {
         pages.push(i);
      }
      return pages;
   };

   return (
      <div className={classes.logViewer}>
         <div className={classes.toolbar}>
            <div className={classes.toolbarLeft}>
               <div className={classes.toolbarSummary}>
                  {theLogs.length}/{logs.length} log items
                  {showPagination && ` (Page ${currentPage} of ${totalPages})`}
               </div>
            </div>
            <div className={classes.toolbarRight}>
               <div className={classes.filters}>
                  <MultiSelect
                     title="Log Levels"
                     fieldValue={filters}
                     options={logTypes.map((logType) => ({ label: logType, value: logType }))}
                     onUpdate={(updatedLogTypes) => setFilters(updatedLogTypes)}
                  />
               </div>
               <div className={classes.filters}>
                  <MultiSelect
                     title={type === 'plan' ? 'Task Type' : 'Module Type'}
                     fieldValue={taskTypes}
                     options={allTaskTypes.map((taskType) => ({ label: taskType || 'General', value: taskType }))}
                     onUpdate={(updatedTaskTypes) => setTaskTypes(updatedTaskTypes)}
                  />
               </div>
               <div className={classes.search}>
                  <Icon type="search" size={16} />
                  <input type="text" placeholder="Search Log Messages..." value={search} onChange={(e) => setSearch(e.target.value)} />
               </div>
               <button
                  onClick={() => (type === 'plan' && planId ? downloadPlanLogsMutation.mutate(planId) : downloadAppLogsMutation.mutate(settingsID))}
               >
                  <Icon type="download" size={16} />
                  <span>Download</span>
               </button>
            </div>
         </div>
         <div className={classes.logsTable}>
            <div className={classes.logsHeader}>
               <div className={classes.logsHeaderItem}>Level</div>
               <div className={`${classes.logsHeaderItem} ${classes.logsHeaderItemTime}`}>Time</div>
               <div className={classes.logsHeaderItem}>{type === 'plan' ? 'Task' : 'Module'}</div>
               <div className={classes.logsHeaderItem}>{type === 'plan' && planMethod !== 'sync' ? 'Backup Id' : 'PID'}</div>
               <div className={classes.logsHeaderItem}>Message</div>
            </div>
            <div className={classes.logs}>
               {!isLoading &&
                  paginatedLogs.map((log, index) => {
                     const logType = getLogLevelName(log.level);
                     // const isBackupLogStart = type === 'plan' && log.backupId && log.msg.includes('Started');
                     return (
                        <div key={index} className={`${classes.log}`}>
                           <div className={`${classes.logType} ${classes[`logType--${logType.toLowerCase()}`]}`}>
                              <Icon type={`log-${logType.toLowerCase()}`} size={13} /> {logType}
                           </div>
                           <div className={classes.logTime}>{new Date(log.time).toLocaleString()}</div>
                           <div className={classes.logModule}>{log.module}</div>
                           <div className={classes.logID}>{type === 'plan' && planMethod !== 'sync' ? log.backupId || 'N/A' : log.pid || 'N/A'}</div>
                           <div className={classes.logMessage}>{log.msg}</div>
                        </div>
                     );
                  })}
               {isLoading && (
                  <div className={classes.loading}>
                     <Icon type="loading" size={20} />
                  </div>
               )}
            </div>
         </div>
         {showPagination && !isLoading && (
            <div className={classes.pagination}>
               <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className={classes.paginationButton}>
                  <Icon type="arrow-left" size={16} />
               </button>
               {getPageNumbers().map((page) => (
                  <button
                     key={page}
                     onClick={() => handlePageChange(page)}
                     className={`${classes.paginationButton} ${currentPage === page ? classes.paginationButtonActive : ''}`}
                  >
                     {page}
                  </button>
               ))}
               <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className={classes.paginationButton}>
                  <Icon type="arrow-right" size={16} />
               </button>
            </div>
         )}
      </div>
   );
};

export default LogViewer;
