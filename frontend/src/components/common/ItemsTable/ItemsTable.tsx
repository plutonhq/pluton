import { ReactNode } from 'react';
import Icon from '../Icon/Icon';
import classes from './ItemsTable.module.scss';

type ItemsTableProps = {
   columns: { label: string; sortKey?: string; maxWidth?: number }[];
   rows: { id: string; cells: ReactNode[] }[];
   sortBy: string;
   onSort: (sortBy: string) => void;
   emptyMessage?: ReactNode;
};

const getNextSort = (sortKey: string, sortBy: string) => {
   if (sortBy === `${sortKey}_asc`) return `${sortKey}_desc`;
   if (sortBy === `${sortKey}_desc`) return '';
   return `${sortKey}_asc`;
};

const ItemsTable = ({ columns, rows, sortBy, onSort, emptyMessage }: ItemsTableProps) => {
   const getCellStyle = (index: number) => {
      const maxWidth = columns[index]?.maxWidth;
      return maxWidth ? { maxWidth } : undefined;
   };

   return (
      <div className={classes.itemsTable}>
         <div className={classes.itemsTableHead}>
            {columns.map(({ label, sortKey }, index) => (
               <div
                  key={label}
                  className={sortKey ? classes.sortable : ''}
                  style={getCellStyle(index)}
                  onClick={() => sortKey && onSort(getNextSort(sortKey, sortBy))}
               >
                  {label}
                  {sortKey && sortBy === `${sortKey}_asc` && <Icon type="caret-up" size={12} />}
                  {sortKey && sortBy === `${sortKey}_desc` && <Icon type="caret-down" size={12} />}
               </div>
            ))}
         </div>
         <div className={classes.itemsTableContent}>
            {rows.map((row) => (
               <div key={row.id} className={classes.itemsTableRow}>
                  {row.cells.map((cell, index) => (
                     <div key={index} style={getCellStyle(index)}>
                        {cell}
                     </div>
                  ))}
               </div>
            ))}
            {rows.length === 0 && emptyMessage && <div className={classes.noItems}>{emptyMessage}</div>}
         </div>
      </div>
   );
};

export default ItemsTable;
