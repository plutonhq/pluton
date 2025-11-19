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

   useEffect(() => {
      if (isVisible) {
         setShouldRender(true);
         // Small delay to ensure DOM is ready before animation starts
         setTimeout(() => {
            setIsActive(true);
         }, 10);
      } else {
         setIsActive(false);
         // Wait for animation to complete before unmounting
         const timer = setTimeout(() => {
            setShouldRender(false);
            onAnimationComplete?.();
         }, animationDuration);
         return () => clearTimeout(timer);
      }
   }, [isVisible, animationDuration, onAnimationComplete]);

   if (!shouldRender) return null;

   return (
      <div
         className={`
        ${classes.animatedWrapper} 
        ${classes[animationType]} 
        ${isActive ? classes.active : ''} 
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
