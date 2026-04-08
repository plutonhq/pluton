import { useState, useCallback } from 'react';

export const useSnapshotSort = () => {
   const [sortField, setSortField] = useState<'name' | 'modifiedAt' | 'size'>('name');
   const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

   const handleSort = useCallback(
      (field: 'name' | 'modifiedAt' | 'size') => {
         if (sortField === field) {
            setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
         } else {
            setSortField(field);
            setSortDirection('asc');
         }
      },
      [sortField],
   );

   return {
      sortField,
      sortDirection,
      handleSort,
   };
};
