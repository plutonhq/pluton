export const DASHBOARD_COLORS = {
   primary: '#575aff',
   primaryLight: '#aebcff',
   success: '#5ddcb8',
   warning: '#fcd385',
   failure: '#f9907e',
};

export const DASHBOARD_TOOLTIP = {
   displayColors: false,
   backgroundColor: '#0f1035',
   titleColor: '#fff',
   bodyColor: '#fff',
   padding: 10,
   caretSize: 6,
   titleFont: { size: 11, weight: 'normal' as const },
   bodyFont: { size: 12, weight: 'bold' as const },
};

/** Converts a 'YYYY-MM' key to a short month name, e.g. 'Jan'. */
export const getDashboardMonthLabel = (month: string) => {
   const [year, monthNum] = month.split('-').map(Number);
   return new Date(year, (monthNum || 1) - 1, 1).toLocaleString('default', { month: 'short' });
};
