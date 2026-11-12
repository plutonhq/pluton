import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../Icon/Icon';
import classes from './LogViewer.module.scss';
import { useGetDownloadLogs } from '../../../services/plans';
import { getLogLevelName } from '../../../utils/helpers';
import { useGetDownloadAppLogs, useLogs } from '../../../services/settings';
import MultiSelect from '../form/MultiSelect/MultiSelect';
import Select from '../form/Select/Select';

interface LogViewerProps {
   type: 'app' | 'plan';
   id: string;
   planMethod?: string;
}

const logTypes = ['info', 'error', 'warn'];
const DAY = 24 * 60 * 60 * 1000;
const rangeOptions = [
   { label: 'All', value: 'all' },
   { label: 'Last 24 hours', value: '24h' },
   { label: 'Last 7 days', value: '7d' },
   { label: 'This month', value: 'month' },
   { label: 'Last month', value: 'lastMonth' },
   { label: 'Custom', value: 'custom' },
];

const getPresetRange = (preset: string): { from?: number; to?: number } => {
   const now = new Date();
   const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
   switch (preset) {
      case '24h':
         return { from: now.getTime() - DAY };
      case '7d':
         return { from: now.getTime() - 7 * DAY };
      case 'month':
         return { from: monthStart };
      case 'lastMonth':
         return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), to: monthStart - 1 };
      default:
         return {};
   }
};

const LogViewer = ({ type, id, planMethod = 'backup' }: LogViewerProps) => {
   const queryClient = useQueryClient();
   const [rangePreset, setRangePreset] = useState('all');
   const [range, setRange] = useState<{ from?: number; to?: number }>({});
   const [customFrom, setCustomFrom] = useState('');
   const [customTo, setCustomTo] = useState('');
   const [levels, setLevels] = useState<string[]>(logTypes);
   const [modules, setModules] = useState<string[] | null>(null);
   const [knownModules, setKnownModules] = useState<string[]>([]);
   const [searchInput, setSearchInput] = useState('');
   const [search, setSearch] = useState('');
   const downloadPlanLogsMutation = useGetDownloadLogs();
   const downloadAppLogsMutation = useGetDownloadAppLogs();

   useEffect(() => {
      const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
      return () => clearTimeout(timer);
   }, [searchInput]);

   const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useLogs(type, id, {
      ...range,
      levels: levels.length === logTypes.length ? undefined : levels,
      modules: modules ?? undefined,
      search: search || undefined,
   });

   const pages = data?.pages;
   const logs = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
   const scannedTo = pages?.[pages.length - 1]?.scannedTo;

   // Keep module options from earlier filters, so a module can be picked again.
   const newModules = [...new Set(pages?.flatMap((page) => page.modules) ?? [])].filter((m) => !knownModules.includes(m));
   if (newModules.length > 0) {
      setKnownModules([...knownModules, ...newModules]);
   }

   const updateRangePreset = (preset: string) => {
      setRangePreset(preset);
      if (preset !== 'custom') {
         setRange(getPresetRange(preset));
      }
   };

   const refresh = () => {
      if (rangePreset !== 'custom') {
         setRange(getPresetRange(rangePreset));
      }
      queryClient.resetQueries({ queryKey: ['logs', type, id] });
   };

   const applyCustomRange = () => {
      setRange({
         from: customFrom ? new Date(customFrom).getTime() : undefined,
         to: customTo ? new Date(customTo).getTime() : undefined,
      });
   };

   const downloadLogs = () => {
      if (type === 'plan') {
         downloadPlanLogsMutation.mutate({ id, ...range });
      } else {
         downloadAppLogsMutation.mutate({ settingsID: id, ...range });
      }
   };

   return (
      <div className={classes.logViewer}>
         <div className={classes.toolbar}>
            <div className={classes.toolbarLeft}>
               <Select size="small" fieldValue={rangePreset} options={rangeOptions} onUpdate={updateRangePreset} />
               {rangePreset === 'custom' && (
                  <div className={classes.customRange}>
                     <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                     <span>to</span>
                     <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                     <button onClick={applyCustomRange}>Apply</button>
                  </div>
               )}
            </div>
            <div className={classes.toolbarRight}>
               <div className={classes.filters}>
                  <MultiSelect
                     title="Log Levels"
                     fieldValue={levels}
                     options={logTypes.map((logType) => ({ label: logType, value: logType }))}
                     onUpdate={(updatedLogTypes) => setLevels(updatedLogTypes)}
                  />
               </div>
               <div className={classes.filters}>
                  <MultiSelect
                     title={type === 'plan' ? 'Task Type' : 'Module Type'}
                     fieldValue={modules ?? knownModules}
                     options={knownModules.map((taskType) => ({ label: taskType || 'General', value: taskType }))}
                     onUpdate={(updatedTaskTypes) => setModules(updatedTaskTypes.length === knownModules.length ? null : updatedTaskTypes)}
                  />
               </div>
               <div className={classes.search}>
                  <Icon type="search" size={16} />
                  <input type="text" placeholder="Search Log Messages..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
               </div>
               <button onClick={refresh}>
                  <Icon type="reload" size={16} />
                  <span>Refresh</span>
               </button>
               <button onClick={downloadLogs}>
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
                  logs.map((log, index) => {
                     const logType = getLogLevelName(log.level);
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
         <div className={classes.footer}>
            <span>
               {logs.length} entries
               {scannedTo ? ` · back to ${new Date(scannedTo).toLocaleString()}` : ''}
            </span>
            {hasNextPage && (
               <button className={classes.loadOlder} disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                  {isFetchingNextPage ? 'Loading...' : 'Load older'}
               </button>
            )}
         </div>
      </div>
   );
};

export default LogViewer;
