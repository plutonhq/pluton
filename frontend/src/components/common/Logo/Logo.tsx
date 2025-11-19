interface LogoProps {
   size: number;
   color?: string;
   faceColor?: string;
   emotion?: string;
}

const Logo = ({ size = 60, color = '' }: LogoProps) => {
   return (
      <svg enableBackground="new 0 0 120 120" height={size} viewBox="0 0 120 120" width={size} xmlns="http://www.w3.org/2000/svg">
         <path
            d="M71,5.08V20.17L109.12,2.61c0,.55.08,1,.08,1.35q0,32.1,0,64.19h0A49.21,49.21,0,1,1,35.53,25.48l34-19.65c.36-.21.74-.41,1.39-.76ZM60,40.87a27.35,27.35,0,1,0,19.3,8,27.32,27.32,0,0,0-19.3-8Z"
            fill={color || 'currentColor'}
         />
      </svg>
   );
};

export default Logo;
