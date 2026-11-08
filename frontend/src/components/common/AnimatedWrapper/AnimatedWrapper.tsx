import React, { useEffect, useState } from 'react';
import classes from './AnimatedWrapper.module.scss';

export interface AnimatedWrapperProps {
   children: React.ReactNode;
   isVisible: boolean;
   animationDuration?: number;
   animationType?: 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'scale' | 'rotate';
   className?: string;
   onAnimationComplete?: () => void;
   absolute?: boolean;
}

const AnimatedWrapper: React.FC<AnimatedWrapperProps> = ({
   children,
   isVisible,
   animationDuration = 300,
   animationType = 'fade',
   className = '',
   absolute = false, // Default to false for backward compatibility
   onAnimationComplete,
}) => {
   const [isActive, setIsActive] = useState(false);
   const [shouldRender, setShouldRender] = useState(isVisible);

   const rendered = isVisible || shouldRender;
   const active = isVisible && isActive;

   useEffect(() => {
      if (isVisible) {
         // Small delay to ensure DOM is ready before animation starts
         const timer = setTimeout(() => {
            setShouldRender(true);
            setIsActive(true);
         }, 10);
         return () => clearTimeout(timer);
      }
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => {
         setShouldRender(false);
         setIsActive(false);
         onAnimationComplete?.();
      }, animationDuration);
      return () => clearTimeout(timer);
   }, [isVisible, animationDuration, onAnimationComplete]);

   if (!rendered) return null;

   return (
      <div
         className={`
        ${classes.animatedWrapper} 
        ${classes[animationType]} 
        ${active ? classes.active : ''}
        ${absolute ? classes.absolute : ''}
        ${className}
      `}
         style={
            {
               '--animation-duration': `${animationDuration}ms`,
            } as React.CSSProperties
         }
      >
         {children}
      </div>
   );
};

export default AnimatedWrapper;
