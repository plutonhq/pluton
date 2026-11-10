import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, ChartOptions, ScriptableContext } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import DashboardWidget from '../DashboardWidget/DashboardWidget';
import { DashboardMonth } from '../../../@types/dashboard';
import { isDarkMode } from '../../../utils/helpers';
import { DASHBOARD_COLORS, DASHBOARD_TOOLTIP, getDashboardMonthLabel } from '../../../utils/dashboard';
import classes from './MonthlyBackupStats.module.scss';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface MonthlyBackupStatsProps {
   months?: DashboardMonth[];
   isLoading?: boolean;
}

const MonthlyBackupStats = ({ months = [], isLoading }: MonthlyBackupStatsProps) => {
   const textColor = isDarkMode ? '#888' : '#8b8b8b';
   const radius = 8;
   const barStyle = { barThickness: 8, borderSkipped: false as const, grouped: false };

   // Chart.js rounds only the top segment of a stack, so round the outer ends of each month's stack here.
   const segmentRadius = (ctx: ScriptableContext<'bar'>) => {
      const month = months[ctx.dataIndex];
      const values = month ? [month.successPct, month.warningPct, month.failurePct] : [];
      const filled = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i !== -1);
      const bottom = ctx.datasetIndex === filled[0] ? radius : 0;
      const top = ctx.datasetIndex === filled[filled.length - 1] ? radius : 0;
      return { topLeft: top, topRight: top, bottomLeft: bottom, bottomRight: bottom };
   };
   const valueStyle = { ...barStyle, stack: 'values', borderRadius: segmentRadius };

   const data = {
      labels: months.map((m) => getDashboardMonthLabel(m.month).toUpperCase()),
      datasets: [
         // 0% segments are null: Chart.js inflates bars, so an empty segment would show as a thin line.
         { label: 'Success', data: months.map((m) => m.successPct || null), backgroundColor: DASHBOARD_COLORS.success, ...valueStyle },
         { label: 'Warning', data: months.map((m) => m.warningPct || null), backgroundColor: DASHBOARD_COLORS.warning, ...valueStyle },
         { label: 'Failure', data: months.map((m) => m.failurePct || null), backgroundColor: DASHBOARD_COLORS.failure, ...valueStyle },
         {
            label: 'Track',
            data: months.map(() => 100),
            backgroundColor: isDarkMode ? '#252525' : '#f1f4ff',
            ...barStyle,
            stack: 'track',
            borderRadius: radius,
            order: 1,
         },
      ],
   };

   const options: ChartOptions<'bar'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
         legend: { display: false },
         tooltip: {
            ...DASHBOARD_TOOLTIP,
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            filter: (item) => item.dataset.label !== 'Track',
            callbacks: {
               title: (items) => {
                  const month = months[items[0]?.dataIndex ?? 0];
                  return month ? `${getDashboardMonthLabel(month.month)} (${month.total} backups)` : '';
               },
               label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y ?? 0}%`,
            },
         },
      },
      scales: {
         x: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: { color: textColor, font: { size: 10 } },
         },
         y: {
            stacked: true,
            min: 0,
            max: 100,
            grid: { display: false },
            border: { display: false },
            ticks: { color: textColor, font: { size: 10 }, stepSize: 25, callback: (value) => `${value}%` },
         },
      },
   };

   return (
      <DashboardWidget title="Monthly Backup Stats" isLoading={isLoading}>
         <div className={classes.chart}>
            <Bar data={data} options={options} />
         </div>
      </DashboardWidget>
   );
};

export default MonthlyBackupStats;
