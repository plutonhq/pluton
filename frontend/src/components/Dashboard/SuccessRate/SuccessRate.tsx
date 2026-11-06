import { Chart as ChartJS, ArcElement, Tooltip, ChartOptions, ScriptableContext } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import DashboardWidget from '../DashboardWidget/DashboardWidget';
import { DashboardResultCounts } from '../../../@types/dashboard';
import { isDarkMode } from '../../../utils/helpers';
import { DASHBOARD_COLORS, DASHBOARD_TOOLTIP } from '../../../utils/dashboard';
import classes from './SuccessRate.module.scss';

ChartJS.register(ArcElement, Tooltip);

interface SuccessRateProps {
   stats?: DashboardResultCounts;
   isLoading?: boolean;
}

const SuccessRate = ({ stats, isLoading }: SuccessRateProps) => {
   const hasData = !!stats && stats.total > 0;
   const emptyColor = isDarkMode ? '#2a2a2a' : '#eef0fb';

   const data = {
      labels: hasData ? ['Success', 'Warnings', 'Failures'] : ['No Backups'],
      datasets: [
         {
            data: hasData ? [stats.successPct, stats.warningPct, stats.failurePct] : [100],
            backgroundColor: (ctx: ScriptableContext<'doughnut'>) => {
               if (!hasData) return emptyColor;
               if (ctx.dataIndex !== 0) return ctx.dataIndex === 1 ? DASHBOARD_COLORS.warning : DASHBOARD_COLORS.failure;
               const area = ctx.chart.chartArea;
               if (!area) return DASHBOARD_COLORS.primary;
               const gradient = ctx.chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
               gradient.addColorStop(0, DASHBOARD_COLORS.primaryLight);
               gradient.addColorStop(1, DASHBOARD_COLORS.primary);
               return gradient;
            },
            borderWidth: 0,
         },
      ],
   };

   const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      circumference: 180,
      rotation: -90,
      cutout: '80%',
      plugins: {
         legend: { display: false },
         tooltip: {
            ...DASHBOARD_TOOLTIP,
            enabled: hasData,
            callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}%` },
         },
      },
   };

   return (
      <DashboardWidget title="Success Rate" isLoading={isLoading} icon="check-shield">
         <div className={classes.successRate}>
            <div className={classes.gauge}>
               <Doughnut data={data} options={options} />
               <div className={classes.gaugeValue}>{hasData ? `${Math.round(stats.successPct)}%` : '--'}</div>
            </div>
            <ul className={classes.legend}>
               <li>
                  <i style={{ backgroundColor: DASHBOARD_COLORS.warning }} />
                  <b>{hasData ? stats.warningPct : 0}%</b> Warnings
               </li>
               <li>
                  <i style={{ backgroundColor: DASHBOARD_COLORS.failure }} />
                  <b>{hasData ? stats.failurePct : 0}%</b> Failures
               </li>
               <li className={classes.total}>{stats?.total || 0} backups this month</li>
            </ul>
         </div>
      </DashboardWidget>
   );
};

export default SuccessRate;
