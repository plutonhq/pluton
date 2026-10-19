import { Children, cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { rowMenuFocusIndex, rowMenuPosition } from '../../../utils/rowActionMenu';
import Icon from '../../common/Icon/Icon';
import classes from './BackupRowMenu.module.scss';

const menuItems = (menu: HTMLDivElement | null) => Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);

/** Presentation only: actions and authorization remain with the owning backup row. */
export default function BackupRowMenu({
   backupId,
   open,
   onOpenChange,
   children,
}: {
   backupId: string;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   children: ReactNode;
}) {
   const id = useId();
   const trigger = useRef<HTMLButtonElement>(null);
   const menu = useRef<HTMLDivElement>(null);
   const [position, setPosition] = useState<ReturnType<typeof rowMenuPosition>>();

   useLayoutEffect(() => {
      if (!open) {
         setPosition(undefined);
         return;
      }
      const button = trigger.current;
      const popup = menu.current;
      if (!button || !popup) return;
      let frame = 0;
      const update = () => {
         const anchor = button.getBoundingClientRect();
         const table = button.closest('[data-backup-table]')?.getBoundingClientRect();
         const bottomInset = window.matchMedia('(max-width: 768px)').matches ? 58 : 0;
         if (
            anchor.bottom <= 0 ||
            anchor.top >= window.innerHeight - bottomInset ||
            anchor.right <= 0 ||
            anchor.left >= window.innerWidth ||
            (table && (anchor.right <= table.left || anchor.left >= table.right))
         ) {
            onOpenChange(false);
            return;
         }
         setPosition(
            rowMenuPosition(
               anchor,
               { width: popup.getBoundingClientRect().width, height: popup.scrollHeight + 2 },
               {
                  width: document.documentElement.clientWidth,
                  height: window.innerHeight,
                  bottomInset,
               },
            ),
         );
      };
      const schedule = () => {
         cancelAnimationFrame(frame);
         frame = requestAnimationFrame(update);
      };
      const outside = (event: PointerEvent) => {
         if (!popup.contains(event.target as Node) && !button.contains(event.target as Node)) onOpenChange(false);
      };
      update();
      const observer = new ResizeObserver(schedule);
      observer.observe(popup);
      observer.observe(button);
      window.addEventListener('resize', schedule);
      document.addEventListener('scroll', schedule, true);
      document.addEventListener('pointerdown', outside);
      return () => {
         cancelAnimationFrame(frame);
         observer.disconnect();
         window.removeEventListener('resize', schedule);
         document.removeEventListener('scroll', schedule, true);
         document.removeEventListener('pointerdown', outside);
      };
   }, [open, onOpenChange]);

   const positioned = !!position;
   useLayoutEffect(() => {
      if (open && positioned) menuItems(menu.current)[0]?.focus({ preventScroll: true });
   }, [open, positioned]);

   return (
      <>
         <button
            ref={trigger}
            id={`${id}-trigger`}
            type="button"
            className={classes.trigger}
            aria-label={`Actions for backup-${backupId}`}
            aria-haspopup="menu"
            aria-controls={open ? `${id}-menu` : undefined}
            aria-expanded={open}
            onClick={() => onOpenChange(!open)}
            onKeyDown={(event) => {
               if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  onOpenChange(true);
               }
            }}
         >
            <Icon type="dots-vertical" size={18} />
         </button>
         {open &&
            createPortal(
               <div
                  ref={menu}
                  id={`${id}-menu`}
                  role="menu"
                  aria-labelledby={`${id}-trigger`}
                  className={classes.menu}
                  style={{ left: position?.left, top: position?.top, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}
                  data-placement={position?.placement}
                  onBlur={(event) => {
                     if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) onOpenChange(false);
                  }}
                  onKeyDown={(event) => {
                     if (event.key === 'Escape' || event.key === 'Tab') {
                        if (event.key === 'Escape') {
                           event.preventDefault();
                           event.stopPropagation();
                        }
                        trigger.current?.focus({ preventScroll: true });
                        onOpenChange(false);
                        return;
                     }
                     const buttons = menuItems(menu.current);
                     const next = rowMenuFocusIndex(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
                     if (next !== undefined) {
                        event.preventDefault();
                        buttons[next]?.focus();
                     }
                  }}
               >
                  {Children.map(children, (child) =>
                     isValidElement(child) && child.type === 'button'
                        ? cloneElement(child as ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>, {
                             role: 'menuitem',
                             type: 'button',
                             tabIndex: -1,
                          })
                        : child,
                  )}
               </div>,
               document.body,
            )}
      </>
   );
}
