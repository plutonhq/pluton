import React, { useEffect, useId, useRef, useState } from 'react';
import Icon from '../Icon/Icon';
import classes from './Modal.module.scss';
import { createPortal } from 'react-dom';

export interface ModalProps {
   children: React.ReactNode;
   width?: string;
   title?: string;
   classNames?: string;
   disablePortal?: boolean;
   disableBackdropClick?: boolean;
   closeModal: () => void;
   stableLayout?: boolean;
   closeDisabled?: boolean;
}

const Modal = ({
   children,
   width,
   closeModal,
   title,
   disablePortal = false,
   classNames = '',
   disableBackdropClick = false,
   stableLayout = false,
   closeDisabled = false,
}: ModalProps) => {
   const [isActive, setIsActive] = useState(false);
   const [isAutoVertical, setIsAutoVertical] = useState(false);
   const modalContentRef = useRef<HTMLDivElement>(null);
   const animationDuration = 300;
   const closeRef = useRef(closeModal);
   closeRef.current = closeModal;
   const closeDisabledRef = useRef(closeDisabled);
   closeDisabledRef.current = closeDisabled;
   const focusedRef = useRef<HTMLElement | null>(null);
   const titleId = useId();
   const closeTimer = useRef<ReturnType<typeof setTimeout>>();

   useEffect(() => {
      const closeModalOnEsc = (event: KeyboardEvent) => {
         if (event.key === 'Escape' && !closeDisabledRef.current) {
            closeRef.current();
         }
      };
      window.addEventListener('keydown', closeModalOnEsc, false);

      // Trigger animation after component mounts
      const animation = setTimeout(() => {
         setIsActive(true);
      }, 10);

      return () => {
         window.removeEventListener('keydown', closeModalOnEsc, false);
         clearTimeout(animation);
         clearTimeout(closeTimer.current);
      };
   }, []);

   useEffect(() => {
      if (!stableLayout) return;
      const previous = document.activeElement as HTMLElement | null;
      modalContentRef.current?.focus({ preventScroll: true });
      return () => {
         if (previous?.isConnected) previous.focus({ preventScroll: true });
      };
   }, [stableLayout]);

   useEffect(() => {
      if (stableLayout && focusedRef.current && !focusedRef.current.isConnected && document.activeElement === document.body)
         modalContentRef.current?.focus({ preventScroll: true });
   });

   useEffect(() => {
      if (stableLayout) return;
      const checkModalHeight = () => {
         if (modalContentRef.current) {
            const height = modalContentRef.current.offsetHeight;
            setIsAutoVertical(height > 500);
         }
      };
      checkModalHeight();
   }, [isActive, children, stableLayout]);

   const handleClose = () => {
      if (closeDisabledRef.current) return;
      setIsActive(false);
      // Wait for animation to complete before actually closing
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
         closeRef.current();
      }, animationDuration);
   };

   const keepFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!stableLayout || event.key !== 'Tab') return;
      const panel = modalContentRef.current!;
      const nodes = [
         ...panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
         ),
      ].filter((node) => !node.closest('[hidden], [aria-hidden="true"]'));
      const first = nodes[0],
         last = nodes[nodes.length - 1];
      if (!first) {
         event.preventDefault();
         panel.focus({ preventScroll: true });
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
         event.preventDefault();
         last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
         event.preventDefault();
         first.focus({ preventScroll: true });
      }
   };

   const closeOnBGClick = (e: React.SyntheticEvent) => {
      if (disableBackdropClick) return;
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (e.target === e.currentTarget) {
         handleClose();
      }
   };

   const renderModalContent = () => {
      return (
         <div
            className={`${classes.modal} ${classNames} ${stableLayout ? classes.stableLayout : isAutoVertical ? classes.autoVertical : ''} ${isActive ? classes.active : ''}`}
            onClick={closeOnBGClick}
            data-testid="modal"
         >
            <div
               className={`${classes.modalContent} ${isActive ? classes.active : ''}`}
               style={{ width: width }}
               ref={modalContentRef}
               role="dialog"
               aria-modal="true"
               aria-labelledby={title ? titleId : undefined}
               aria-label={title ? undefined : 'Dialog'}
               tabIndex={-1}
               onKeyDown={keepFocus}
               onFocusCapture={(event) => {
                  focusedRef.current = event.target as HTMLElement;
               }}
            >
               {title && <h3 id={titleId}>{title}</h3>}
               <button type="button" className={classes.modalClose} onClick={handleClose} disabled={closeDisabled} aria-label="Close dialog">
                  <Icon type="close" size={24} />
               </button>
               <div className={classes.modalChildren}>{children}</div>
            </div>
         </div>
      );
   };

   return disablePortal ? renderModalContent() : createPortal(renderModalContent(), document.body);
};

export default Modal;
