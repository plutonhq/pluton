import { useMemo, useRef, useState, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import Icon from '../../common/Icon/Icon';
import { BackupChartPoint } from '../../../@types/backups';
import { formatBytes, formatNumberToK } from '../../../utils/helpers';
import { useTheme } from '../../../context/ThemeContext';
import classes from './PlanSizeChart.module.scss';
import { backupStatistics } from '../../../utils/backupStatistics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

type RangeKey = '7d' | '14d' | '1m' | '3m' | '6m';

const RANGE_OPTIONS: { key: RangeKey; label: string; labelFull: string; days: number }[] = [
   { key: '7d', label: '7d', labelFull: '7 days', days: 7 },
   { key: '14d', label: '14d', labelFull: '14 days', days: 14 },
   { key: '1m', label: '1m', labelFull: '1 month', days: 30 },
   { key: '3m', label: '3m', labelFull: '3 months', days: 90 },
   { key: '6m', label: '6m', labelFull: '6 months', days: 180 },
];

interface PlanSizeChartProps {
   backups: BackupChartPoint[];
   remoteManaged?: boolean;
   isSync?: boolean;
}

const PlanSizeChart = ({ backups, remoteManaged = false, isSync = false }: PlanSizeChartProps) => {
   const { theme } = useTheme();
   // Canvas cannot resolve CSS var() colors. Re-read the shared palette when the
   // applied app theme changes, not the OS preference captured at module load.
   const tooltipColors = useMemo(() => {
      const palette = getComputedStyle(document.documentElement);
      return {
         background: palette.getPropertyValue('--content-background-color').trim(),
         title: palette.getPropertyValue('--content-title-color').trim(),
         body: palette.getPropertyValue('--content-text-color').trim(),
      };
   }, [theme]);
   const [range, setRange] = useState<RangeKey>('3m');
   const [open, setOpen] = useState(false);
   const dropdownRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      if (!open) return;
      const onClick = (e: MouseEvent) => {
         if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
            setOpen(false);
         }
      };
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
   }, [open]);

   const activeRange = RANGE_OPTIONS.find((r) => r.key === range) || RANGE_OPTIONS[3];

   const filtered = useMemo(() => {
      const cutoff = Date.now() - activeRange.days * 24 * 60 * 60 * 1000;
      // Preserve legacy local chart layout; remote points must represent actual snapshots only.
      const theBackups = !remoteManaged && backups && backups.length === 1 ? [backups[0], backups[0]] : backups || [];
      return [...theBackups]
         .filter((b) => {
            if (remoteManaged && (b.status !== 'completed' || !b.completionStats)) return false;
            const t = new Date(b.started).getTime();
            return !isNaN(t) && t >= cutoff;
         })
         .sort((a, b) => new Date(a.started).getTime() - new Date(b.started).getTime());
   }, [backups, activeRange.days, remoteManaged]);

   const labels = filtered.map((b) => new Date(b.started).toLocaleString());
   const sizeData = filtered.map((b) =>
      remoteManaged ? (backupStatistics(b.completionStats as unknown as Record<string, unknown>).logicalBytes ?? null) : b.totalSize || 0,
   );
   const filesData = filtered.map((b) =>
      remoteManaged ? (backupStatistics(b.completionStats as unknown as Record<string, unknown>).totalFiles ?? null) : b.totalFiles || 0,
   );

   const sizeLabel = isSync ? 'Size' : 'Snapshot Size';
   const data = {
      labels,
      datasets: [
         {
            label: sizeLabel,
            data: sizeData,
            yAxisID: 'ySize',
            borderColor: 'transparent',
            backgroundColor: 'rgba(87, 132, 255, 0.12)',
            fill: true,
            tension: 0.4,
            borderWidth: 1.5,
            pointRadius: filtered.length === 1 ? 3 : 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: 'rgba(87, 90, 255, 1)',
         },
         {
            label: 'Files',
            data: filesData,
            yAxisID: 'yFiles',
            borderColor: '#9a9bff',
            backgroundColor: 'transparent',
            borderDash: [3, 3],
            fill: false,
            tension: 0.4,
            borderWidth: 1.2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: 'rgba(87, 90, 255, 1)',
         },
      ],
   };

   const options: ChartOptions<'line'> = {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
         legend: { display: false },
         tooltip: {
            displayColors: false,
            backgroundColor: tooltipColors.background,
            titleColor: tooltipColors.title,
            bodyColor: tooltipColors.body,
            padding: 8,
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
            callbacks: {
               title: (items) => {
                  const idx = items[0]?.dataIndex ?? 0;
                  const b = filtered[idx];
                  return b ? new Date(b.started).toLocaleString() : '';
               },
               label: (ctx) => {
                  if (ctx.dataset.label === sizeLabel) return `${isSync ? 'Size' : 'Logical snapshot size'}: ${formatBytes(ctx.parsed.y || 0)}`;
                  return `Files: ${formatNumberToK(ctx.parsed.y || 0)}`;
               },
            },
         },
      },
      scales: {
         x: { display: false },
         ySize: { display: false, beginAtZero: true },
         yFiles: { display: false, beginAtZero: true, position: 'right' },
      },
   };

   return (
      <div className={classes.chartWrap}>
         <div className={classes.rangeSelector} ref={dropdownRef}>
            <button type="button" className={classes.rangeBtn} onClick={() => setOpen((v) => !v)}>
               {activeRange.label}
            </button>
            {open && (
               <ul className={classes.rangeMenu}>
                  {RANGE_OPTIONS.slice()
                     .reverse()
                     .map((opt) => (
                        <li
                           key={opt.key}
                           className={opt.key === range ? classes.active : ''}
                           onClick={() => {
                              setRange(opt.key);
                              setOpen(false);
                           }}
                        >
                           {opt.labelFull}
                        </li>
                     ))}
               </ul>
            )}
         </div>
         {filtered.length === 0 ? (
            <div className={classes.empty}>
               <Icon type="folders" size={16} /> No data in range
            </div>
         ) : (
            <div className={classes.chartCanvas}>
               <Line data={data} options={options} />
            </div>
         )}
      </div>
   );
};

export default PlanSizeChart;
