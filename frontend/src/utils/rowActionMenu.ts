type Anchor = { left: number; right: number; top: number; bottom: number };

/** Viewport coordinates for a portalled menu, independent of table scrolling. */
export function rowMenuPosition(
   anchor: Anchor,
   menu: { width: number; height: number },
   viewport: { width: number; height: number; bottomInset?: number },
) {
   const padding = 8;
   const gap = 6;
   const bottom = viewport.height - (viewport.bottomInset ?? 0) - padding;
   const below = Math.max(0, bottom - anchor.bottom - gap);
   const above = Math.max(0, anchor.top - padding - gap);
   const placement = menu.height <= below || below >= above ? 'bottom' : 'top';
   const maxHeight = placement === 'bottom' ? below : above;
   const height = Math.min(menu.height, maxHeight);
   return {
      left: Math.max(padding, Math.min(anchor.right - menu.width, viewport.width - menu.width - padding)),
      top: Math.max(padding, Math.min(placement === 'bottom' ? anchor.bottom + gap : anchor.top - gap - height, bottom - height)),
      maxHeight,
      placement,
   };
}

export function rowMenuFocusIndex(key: string, current: number, count: number): number | undefined {
   if (!count) return undefined;
   if (key === 'Home') return 0;
   if (key === 'End') return count - 1;
   if (key === 'ArrowDown') return (current + 1) % count;
   if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
   return undefined;
}
