import { NavLink } from 'react-router';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, ChartOptions, ScriptableContext } from 'chart.js';
import { Line } from 'react-chartjs-2';
import DashboardWidget from '../DashboardWidget/DashboardWidget';
import { DashboardSummary } from '../../../@types/dashboard';
import { formatBytes, isDarkMode } from '../../../utils/helpers';
import { DASHBOARD_COLORS, DASHBOARD_TOOLTIP, getDashboardMonthLabel } from '../../../utils/dashboard';
import classes from './StorageUsage.module.scss';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

interface StorageUsageProps {
   usage?: DashboardSummary['storageUsage'];
   isLoading?: boolean;
}

const StorageUsage = ({ usage, isLoading }: StorageUsageProps) => {
   const series = usage?.series || [];
   const monthChange = usage?.monthChange || 0;
   const topPlan = usage?.topPlan;

   const data = {
      labels: series.map((s) => getDashboardMonthLabel(s.month)),
      datasets: [
         {
            label: 'Storage Used',
            data: series.map((s) => s.size),
            borderColor: DASHBOARD_COLORS.primary,
            borderWidth: 2,
            tension: 0.45,
            fill: true,
            backgroundColor: (ctx: ScriptableContext<'line'>) => {
               const area = ctx.chart.chartArea;
               if (!area) return 'transparent';
               const gradient = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
               gradient.addColorStop(0, isDarkMode ? 'rgba(87, 90, 255, 0.35)' : 'rgba(87, 90, 255, 0.22)');
               gradient.addColorStop(1, 'rgba(87, 90, 255, 0)');
               return gradient;
            },
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBorderWidth: 2,
            pointHoverBackgroundColor: isDarkMode ? '#1c1c1c' : '#fff',
            pointHoverBorderColor: DASHBOARD_COLORS.primary,
         },
      ],
   };

   const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { autoPadding: false, padding: { top: 10 } },
      plugins: {
         legend: { display: false },
         tooltip: {
            ...DASHBOARD_TOOLTIP,
            callbacks: {
               label: (ctx) => formatBytes(ctx.parsed.y || 0),
            },
         },
      },
      scales: {
         x: {
            grid: { display: false },
            border: { display: false },
            ticks: { align: 'inner', color: isDarkMode ? '#888' : '#8b8b8b', font: { size: 10 } },
            // Tick padding is also added to the sides; keep it only below the chart.
            afterFit: (scale) => {
               scale.paddingLeft = 0;
               scale.paddingRight = 0;
            },
         },
         y: { display: false, beginAtZero: true },
      },
   };

   return (
      <DashboardWidget title="Storage Usage" isLoading={isLoading} customClasses={classes.storageUsage} icon="storage-drive">
         <ul className={classes.stats}>
            <li>
               <i />
               <b>{formatBytes(usage?.totalNow || 0)}</b> Total storage used
            </li>
            <li>
               <i />
               <b>
                  {monthChange >= 0 ? '+' : '-'}
                  {formatBytes(Math.abs(monthChange))}
               </b>{' '}
               Change this month
            </li>
            <li>
               <i />
               {topPlan ? (
                  <>
                     <NavLink to={`/plan/${topPlan.id}`}>{topPlan.title}</NavLink> Top plan this month (+{formatBytes(topPlan.bytes)})
                  </>
               ) : (
                  'No new backup data this month'
               )}
            </li>
         </ul>
         <div className={classes.chart}>
            <Line data={data} options={options} />
         </div>
      </DashboardWidget>
   );
};

export default StorageUsage;
