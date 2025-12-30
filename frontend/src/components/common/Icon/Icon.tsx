import { PropsWithChildren } from 'react';

type IconProps = {
   type: string;
   color?: string;
   size?: number;
   title?: string;
   classes?: string;
};

type IconWrapperProps = {
   viewBox: string;
   size: number;
};

const Icon = ({ type, color = 'currentColor', size = 16, title = '', classes = '' }: IconProps) => {
   return (
      <span className={`icon ${classes}`} title={title}>
         {type === 'loading' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8a8 8 0 0 1-8 8z" opacity=".5" fill={color} />
               <path d="M20 12h2A10 10 0 0 0 12 2v2a8 8 0 0 1 8 8z" fill={color}>
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
               </path>
            </IconWrapper>
         )}
         {type === 'close' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="m7 7l10 10M7 17L17 7"></path>
            </IconWrapper>
         )}
         {type === 'close-circle' && (
            <IconWrapper size={size} viewBox="0 0 32 32">
               <path
                  fill={color}
                  d="M16 2C8.2 2 2 8.2 2 16s6.2 14 14 14s14-6.2 14-14S23.8 2 16 2m5.4 21L16 17.6L10.6 23L9 21.4l5.4-5.4L9 10.6L10.6 9l5.4 5.4L21.4 9l1.6 1.6l-5.4 5.4l5.4 5.4z"
               ></path>
            </IconWrapper>
         )}
         {type === 'password' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zm3-2V7a4 4 0 1 1 8 0v4m-1 5h.01m-3 0h.01m-3 0h.01"
               />
            </IconWrapper>
         )}
         {type === 'user' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"
               />
            </IconWrapper>
         )}
         {type === 'plans' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path
                  fill={color}
                  d="M8 3a3 3 0 0 0-3 3a.5.5 0 0 1-.5.5h-.25a2.25 2.25 0 0 0 0 4.5h.772q.048.516.185 1H4.25a3.25 3.25 0 0 1-.22-6.493a4 4 0 0 1 7.887-.323a5.5 5.5 0 0 0-1.084-.174A3 3 0 0 0 8 3m7 7.5a4.5 4.5 0 1 1-9 0a4.5 4.5 0 0 1 9 0m-4.854-2.353l-2 2a.5.5 0 0 0 .708.707L10 9.707V12.5a.5.5 0 0 0 1 0V9.707l1.146 1.147a.5.5 0 0 0 .708-.708l-2-2A.5.5 0 0 0 10.503 8h-.006a.5.5 0 0 0-.348.144z"
               ></path>
            </IconWrapper>
         )}
         {type === 'sync' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path
                  fill={color}
                  d="M8 3a3 3 0 0 0-3 3a.5.5 0 0 1-.5.5h-.25a2.25 2.25 0 0 0 0 4.5h.772q.048.516.185 1H4.25a3.25 3.25 0 0 1-.22-6.493a4 4 0 0 1 7.887-.323a5.5 5.5 0 0 0-1.084-.174A3 3 0 0 0 8 3m2.5 12a4.5 4.5 0 1 0 0-9a4.5 4.5 0 0 0 0 9M13 8v1.5a.5.5 0 0 1-.5.5H11a.5.5 0 0 1 0-1h.47a1.996 1.996 0 0 0-2.57.55a.5.5 0 0 1-.8-.6a2.996 2.996 0 0 1 3.9-.8V8a.5.5 0 0 1 1 0m-4.5 5.5A.5.5 0 0 1 8 13v-1.5a.5.5 0 0 1 .5-.5H10a.5.5 0 0 1 0 1h-.47a1.996 1.996 0 0 0 2.57-.55a.5.5 0 1 1 .8.6a2.996 2.996 0 0 1-3.9.799V13a.5.5 0 0 1-.5.5"
               ></path>
            </IconWrapper>
         )}
         {type === 'rescue' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none">
                  <path d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10" />
                  <path d="M15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0" />
                  <path
                     stroke={color}
                     strokeLinecap="square"
                     strokeWidth="2"
                     d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10Z"
                  />
                  <path stroke={color} strokeLinecap="square" strokeWidth="2" d="M12 5a7 7 0 0 1 7 7m-4 0a3 3 0 1 1-6 0a3 3 0 0 1 6 0Z" />
               </g>
            </IconWrapper>
         )}
         {type === 'restore' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M12 3a9 9 0 0 0-9 9H0l4 4l4-4H5a7 7 0 0 1 7-7a7 7 0 0 1 7 7a7 7 0 0 1-7 7c-1.5 0-2.91-.5-4.06-1.3L6.5 19.14A9.1 9.1 0 0 0 12 21a9 9 0 0 0 9-9a9 9 0 0 0-9-9m2 9a2 2 0 0 0-2-2a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2"
               ></path>
            </IconWrapper>
         )}
         {type === 'storages' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <g fill="none">
                  <path stroke={color} strokeLinejoin="round" strokeWidth={4} d="M44 29H4v13h40z"></path>
                  <path fill={color} d="M35.5 38a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5"></path>
                  <path stroke={color} strokeLinejoin="round" strokeWidth={4} d="M4 29L9.038 4.999H39.02l4.98 24"></path>
                  <path
                     stroke={color}
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     strokeWidth={4}
                     d="M19.006 16.026c-2.143 0-4.006 1.486-4.006 3.487C15 22 17.095 23 19.697 23h1.28m8.03-6.974c2.097 0 3.993.973 3.993 3.487C33 22 30.89 23 28.288 23h-1.3m2.019-6.974C29.007 13.042 27.023 11 24 11s-4.994 1.993-4.994 5.026"
                  ></path>
                  <path stroke={color} strokeWidth={4} d="M20 23h8"></path>
               </g>
            </IconWrapper>
         )}

         {type === 'devices' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm0 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm4-7v.01M7 16v.01"
               ></path>
            </IconWrapper>
         )}
         {type === 'sources' && (
            <IconWrapper size={size} viewBox="0 0 430 502">
               <circle cx="215" cy="55" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <circle cx="375" cy="155" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <circle cx="55" cy="155" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <circle cx="215" cy="251" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <circle cx="375" cy="347" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <circle cx="55" cy="347" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <circle cx="215" cy="447" r="40" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={30} />
               <line
                  x1="88.92"
                  y1="133.8"
                  x2="181.08"
                  y2="76.2"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
               <line
                  x1="248.92"
                  y1="76.2"
                  x2="341.08"
                  y2="133.8"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
               <line
                  x1="181.08"
                  y1="229.8"
                  x2="88.92"
                  y2="176.2"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
               <line
                  x1="341.08"
                  y1="176.2"
                  x2="248.92"
                  y2="229.8"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
               <line
                  x1="248.92"
                  y1="272.2"
                  x2="341.08"
                  y2="325.8"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
               <line
                  x1="181.08"
                  y1="425.8"
                  x2="88.92"
                  y2="368.2"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
               <line
                  x1="88.92"
                  y1="325.8"
                  x2="181.08"
                  y2="272.2"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={30}
               />
            </IconWrapper>
         )}
         {type === 'send' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zm7.318-19.539l-10.94 10.939"
               ></path>
            </IconWrapper>
         )}
         {type === 'sort-up' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path
                  fill={color}
                  d="m12.927 2.573l3 3A.25.25 0 0 1 15.75 6H13.5v6.75a.75.75 0 0 1-1.5 0V6H9.75a.25.25 0 0 1-.177-.427l3-3a.25.25 0 0 1 .354 0M0 12.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75m0-4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8.25m0-4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.25"
               ></path>{' '}
            </IconWrapper>
         )}

         {type === 'sort-down' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path
                  fill={color}
                  d="M0 4.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.25m0 4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8.25m0 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75M13.5 10h2.25a.25.25 0 0 1 .177.427l-3 3a.25.25 0 0 1-.354 0l-3-3A.25.25 0 0 1 9.75 10H12V3.75a.75.75 0 0 1 1.5 0z"
               ></path>
            </IconWrapper>
         )}

         {type === 'columns' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  fillRule="evenodd"
                  d="M4 2a2 2 0 1 1 0 4a2 2 0 0 1 0-4m8 0a2 2 0 1 1 0 4a2 2 0 0 1 0-4m10 2a2 2 0 1 0-4 0a2 2 0 0 0 4 0M4 10a2 2 0 1 1 0 4a2 2 0 0 1 0-4m10 2a2 2 0 1 0-4 0a2 2 0 0 0 4 0m6-2a2 2 0 1 1 0 4a2 2 0 0 1 0-4M6 20a2 2 0 1 0-4 0a2 2 0 0 0 4 0m6-2a2 2 0 1 1 0 4a2 2 0 0 1 0-4m10 2a2 2 0 1 0-4 0a2 2 0 0 0 4 0"
                  clipRule="evenodd"
               ></path>
            </IconWrapper>
         )}
         {type === 'rows' && (
            <IconWrapper size={size} viewBox="0 0 28 28">
               <path
                  fill={color}
                  d="M3 7a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1m0 14a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1m1-8a1 1 0 1 0 0 2h20a1 1 0 1 0 0-2z"
               ></path>
            </IconWrapper>
         )}

         {type === 'computer-remote' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M16.668 3H4.25l-.154.005A2.25 2.25 0 0 0 2 5.25v10.502l.005.154a2.25 2.25 0 0 0 2.245 2.096h4.249V20.5H6.75l-.102.007A.75.75 0 0 0 6.75 22h10.5l.102-.006a.75.75 0 0 0-.102-1.494h-1.751v-2.498h4.25l.154-.005a2.25 2.25 0 0 0 2.096-2.245V9.5h-1.5v6.252l-.007.102a.75.75 0 0 1-.743.648H4.25l-.102-.007a.75.75 0 0 1-.648-.743V5.25l.007-.102A.75.75 0 0 1 4.25 4.5H16.5v-.75c0-.268.06-.523.168-.75m-6.67 15.002h4l.001 2.498h-4zM17.5 3.75a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1-.75-.75V7h-.323a.54.54 0 0 0-.508.366l-.914 2.742a2.04 2.04 0 0 1-1.932 1.392H13v1.75a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1-.75-.75v-4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75V10h.823c.23 0 .436-.148.508-.366l.914-2.742A2.04 2.04 0 0 1 17.177 5.5h.323zM19 6.268V7h2.5V4.5H19zM9 10v2.5h2.5V10z"
               ></path>
            </IconWrapper>
         )}
         {type === 'computer' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M6.75 22a.75.75 0 0 1-.102-1.493l.102-.007h1.749v-2.498H4.25a2.25 2.25 0 0 1-2.245-2.096L2 15.752V5.25a2.25 2.25 0 0 1 2.096-2.245L4.25 3h15.499a2.25 2.25 0 0 1 2.245 2.096l.005.154v10.502a2.25 2.25 0 0 1-2.096 2.245l-.154.005h-4.25V20.5h1.751a.75.75 0 0 1 .102 1.494L17.25 22zm7.248-3.998h-4l.001 2.498h4zM19.748 4.5H4.25a.75.75 0 0 0-.743.648L3.5 5.25v10.502c0 .38.282.694.648.743l.102.007h15.499a.75.75 0 0 0 .743-.648l.007-.102V5.25a.75.75 0 0 0-.648-.743z"
               ></path>
            </IconWrapper>
         )}
         {type === 'computer-alt' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <g fill="none" stroke={color} strokeLinejoin="round" strokeWidth={4}>
                  <rect width={36} height={28} x={6} y={6} rx={3}></rect>
                  <path strokeLinecap="round" d="M14 42h20m-10-8v8"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'vm-host' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <g fill="none" stroke={color} strokeWidth={4}>
                  <path
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     d="M24 6H9a3 3 0 0 0-3 3v22a3 3 0 0 0 3 3h30a3 3 0 0 0 3-3v-5m-18 8v8m-10 0h20"
                  ></path>
                  <circle cx={37} cy={13} r={3}></circle>
                  <path
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     d="M37 20v-4m0-6V6m-6.062 10.5l3.464-2m5.196-3l3.464-2m-12.124 0l3.464 2m5.196 3l3.464 2"
                  ></path>
               </g>
            </IconWrapper>
         )}
         {type === 'vm' && (
            <IconWrapper size={size} viewBox="0 0 40 40">
               <rect x="1.5" y="1.5" width="36" height="28" rx="3" fill="none" stroke={color} strokeLinejoin="round" strokeWidth="3" />
               <path
                  d="M14,42H34M24,34v8"
                  transform="translate(-4.5 -4.5)"
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
               />
               <path
                  d="M32.42,14.75l-8.06-3.58a.9.9,0,0,0-.72,0l-8.06,3.58-.05,0a.2.2,0,0,1-.08,0l0,0a.69.69,0,0,0-.17.17l-.05.07a1,1,0,0,0-.07.15l0,.07a1,1,0,0,0,0,.24v9a.89.89,0,0,0,.53.82l8.06,3.58A.76.76,0,0,0,24,29a.77.77,0,0,0,.36-.09h0l8.06-3.58a.89.89,0,0,0,.53-.82V15.57a.91.91,0,0,0-.53-.82M24,13l5.85,2.6L24,18.17l-1.17-.52-4.68-2.08Zm-7.16,11V17l6.26,2.78v7Zm8.06,2.79v-7L31.16,17v7Z"
                  transform="translate(-4.5 -4.5)"
                  fill={color}
                  strokeMiterlimit="10"
                  strokeWidth="0.75"
               />
            </IconWrapper>
         )}
         {type === 'database' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M4 18V6m16 6v6"></path>
                  <path d="M12 10c4.418 0 8-1.79 8-4s-3.582-4-8-4s-8 1.79-8 4s3.582 4 8 4Z"></path>
                  <path strokeLinecap="round" d="M20 12c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path>
                  <path d="M20 18c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'postgres' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="#336791"
                  d="M10.74 12.89v-.11c.06-.15.12-.29.19-.43a5.15 5.15 0 0 0 .26-3.74a.86.86 0 0 0-.66-.74a3.12 3.12 0 0 0-2.08.61v.18a11.3 11.3 0 0 1-.06 2.41a2.37 2.37 0 0 0 .62 2a2 2 0 0 0 1.43.63a8 8 0 0 1 .3-.81M10 8.58a.36.36 0 0 1-.09-.23a.2.2 0 0 1 .09-.12a.74.74 0 0 1 .48-.07c.25 0 .5.16.48.34a.51.51 0 0 1-.49.33h-.06a.63.63 0 0 1-.41-.25"
               ></path>
               <path
                  fill="#336791"
                  d="M7.88 11a12.6 12.6 0 0 0 .06-2.3v-.28a7 7 0 0 1 1.54-4.55c-1-.32-3.4-1-4.87.1c-.9.64-1.32 1.84-1.23 3.55a25 25 0 0 0 1 4.4c.68 2.22 1.45 3.62 2.11 3.85c.1 0 .41.13.86-.41c.64-.76 1.23-1.41 1.5-1.7l-.19-.19A2.89 2.89 0 0 1 7.88 11m3.5 3.4c-.16-.06-.24-.1-.42.11a2.5 2.5 0 0 0-.29.35c-.35.43-.5.58-1.51.79a2 2 0 0 0-.4.11a1 1 0 0 0 .37.16a2.21 2.21 0 0 0 2.5-.8a.41.41 0 0 0 0-.35a.6.6 0 0 0-.25-.37m6.29-5.82a5 5 0 0 0 .08-.79c-.66-.08-1.42-.07-1.72.36c-.58.83.56 2.88 1 3.75a4 4 0 0 1 .26.48a2 2 0 0 0 .15.31a3.7 3.7 0 0 0 .16-2.13a7.5 7.5 0 0 1-.07-1.05a6 6 0 0 1 .14-.93m-.56-.16a.6.6 0 0 1-.32.17h-.06a.47.47 0 0 1-.44-.3c0-.14.2-.24.44-.28s.48 0 .5.15a.38.38 0 0 1-.12.26"
               ></path>
               <path
                  fill="#336791"
                  d="M17 4.88a6.06 6.06 0 0 1 1.37 2.57a.7.7 0 0 1 0 .15a5.7 5.7 0 0 1-.09 1.06a7 7 0 0 0-.09.86a6.6 6.6 0 0 0 .07 1a4 4 0 0 1-.36 2.71l.07.08c2.22-3.49 3-7.54 2.29-8.43a4.77 4.77 0 0 0-3.81-1.8a7.3 7.3 0 0 0-1.63.16A6.2 6.2 0 0 1 17 4.88"
               ></path>
               <path
                  fill="#336791"
                  d="M21.65 14c-.07-.2-.37-.85-1.47-.62a6 6 0 0 1-1 .13a19.7 19.7 0 0 0 2.06-4.88c.37-1.45.66-3.39-.11-4.38A5.91 5.91 0 0 0 16.37 2a8.4 8.4 0 0 0-2.46.35a9.4 9.4 0 0 0-1.45-.14a4.8 4.8 0 0 0-2.46.62a12 12 0 0 0-1.77-.44A5.44 5.44 0 0 0 4 3.05c-1.24.87-1.81 2.39-1.71 4.52a26.3 26.3 0 0 0 1 4.67A16 16 0 0 0 4.4 15a3.4 3.4 0 0 0 1.75 1.83a1.71 1.71 0 0 0 1.69-.37a2 2 0 0 0 1 .59a3.65 3.65 0 0 0 2.35-.14v.81a8.5 8.5 0 0 0 .31 2.36a1 1 0 0 1 0 .13a3 3 0 0 0 .71 1.24a2.08 2.08 0 0 0 1.49.56a3 3 0 0 0 .7-.08a3.27 3.27 0 0 0 2.21-1.27a7.34 7.34 0 0 0 .91-4v-.26h.17a5.24 5.24 0 0 0 2.4-.4c.45-.23 1.91-1 1.56-2m-1.81 1.47a4.7 4.7 0 0 1-1.8.34a2.6 2.6 0 0 1-.79-.1c-.1.94-.32 2.69-.45 3.42a2.47 2.47 0 0 1-2.25 2.3a3.2 3.2 0 0 1-.66.07A2 2 0 0 1 12 20a16.8 16.8 0 0 1-.28-4.06a2.56 2.56 0 0 1-1.78.66a4 4 0 0 1-.94-.13c-.09 0-.87-.23-.86-.73s.66-.59.9-.64c.86-.18.92-.25 1.19-.59a3 3 0 0 1 .19-.24a2.56 2.56 0 0 1-1.11-.3c-.23.25-.86.93-1.54 1.74a1.43 1.43 0 0 1-1.11.63a1.2 1.2 0 0 1-.35 0C5.43 16 4.6 14.55 3.84 12a25 25 0 0 1-1-4.53c-.1-1.92.4-3.28 1.47-4c1.92-1.36 5-.31 5.7-.06a4 4 0 0 1 2.41-.66a5.6 5.6 0 0 1 1.4.18a7.5 7.5 0 0 1 2.5-.4a5.35 5.35 0 0 1 4.32 2c.69.88.23 3 0 3.89a18.8 18.8 0 0 1-2.41 5.41c.16.11.65.31 2 0c.46-.1.73 0 .82.25c.22.55-.7 1.13-1.21 1.37z"
               ></path>
               <path
                  fill="#336791"
                  d="M17.43 13.59a4 4 0 0 1-.62-1c0-.07-.12-.24-.23-.43c-.58-1-1.79-3.22-1-4.34a2.16 2.16 0 0 1 2.12-.61a6.3 6.3 0 0 0-1.13-1.94a5.41 5.41 0 0 0-4.13-2a3.34 3.34 0 0 0-2.55.95A5.82 5.82 0 0 0 8.51 7.8l.15-.08A3.7 3.7 0 0 1 10 7.3a1.45 1.45 0 0 1 1.76 1.19a5.73 5.73 0 0 1-.29 4.09a3 3 0 0 0-.17.39v.11c-.1.27-.19.52-.25.73a.94.94 0 0 1 .57.07a1.16 1.16 0 0 1 .62.74v.16a.3.3 0 0 1 0 .09a22.2 22.2 0 0 0 .22 4.9a1.5 1.5 0 0 0 2 1.09A1.92 1.92 0 0 0 16.25 19c.15-.88.45-3.35.49-3.88c0-1.06.52-1.27.84-1.36z"
               ></path>
               <path
                  fill="#336791"
                  d="m18 14.33l-.08-.06h-.12c-.26.07-.5.14-.47.8a1.9 1.9 0 0 0 .93.12a4.3 4.3 0 0 0 1.38-.29a3 3 0 0 0 .79-.52a3.47 3.47 0 0 1-2.43-.05"
               ></path>
            </IconWrapper>
         )}
         {type === 'mysql' && (
            <IconWrapper size={size} viewBox="0 0 32 32">
               <path
                  fill="#5d87a1"
                  fillRule="evenodd"
                  d="M8.785 6.865a3 3 0 0 0-.785.1V7h.038a6.5 6.5 0 0 0 .612.785c.154.306.288.611.441.917l.038-.039a1.07 1.07 0 0 0 .4-.957a4 4 0 0 1-.23-.4c-.115-.191-.364-.287-.517-.44"
               ></path>
               <path
                  fill="#00758f"
                  fillRule="evenodd"
                  d="M27.78 23.553a8.85 8.85 0 0 0-3.712.536c-.287.115-.745.115-.785.478c.154.153.172.4.307.613a4.5 4.5 0 0 0 .995 1.167c.4.306.8.611 1.225.879c.745.461 1.588.728 2.314 1.187c.422.268.842.612 1.264.9c.21.153.343.4.611.5v-.058a4 4 0 0 0-.291-.613c-.191-.19-.383-.363-.575-.554a9.1 9.1 0 0 0-1.99-1.932c-.613-.422-1.953-1-2.2-1.7l-.039-.039a7.7 7.7 0 0 0 1.321-.308c.65-.172 1.243-.133 1.912-.3c.307-.077.862-.268.862-.268v-.3c-.342-.34-.587-.795-.947-1.116a25 25 0 0 0-3.122-2.328c-.587-.379-1.344-.623-1.969-.946c-.226-.114-.6-.17-.737-.36a7.6 7.6 0 0 1-.776-1.457a47 47 0 0 1-1.551-3.293a20 20 0 0 0-.965-2.157A19.1 19.1 0 0 0 11.609 5a9 9 0 0 0-2.421-.776c-.474-.02-.946-.057-1.419-.075a8 8 0 0 1-.869-.664C5.818 2.8 3.038 1.328 2.242 3.277C1.732 4.508 3 5.718 3.435 6.343A9 9 0 0 1 4.4 7.762c.133.322.171.663.3 1a23 23 0 0 0 .987 2.538a9 9 0 0 0 .7 1.172c.153.209.417.3.474.645a5.4 5.4 0 0 0-.436 1.419a8.34 8.34 0 0 0 .549 6.358c.3.473 1.022 1.514 1.987 1.116c.851-.34.662-1.419.908-2.364c.056-.229.019-.379.132-.53v.184s.483 1.061.723 1.6a10.8 10.8 0 0 0 2.4 2.59A3.5 3.5 0 0 1 14 24.657V25h.427a1.05 1.05 0 0 0-.427-.788a9.4 9.4 0 0 1-.959-1.16a25 25 0 0 1-2.064-3.519c-.3-.6-.553-1.258-.793-1.857c-.11-.231-.11-.58-.295-.7a7.3 7.3 0 0 0-.884 1.313a11.4 11.4 0 0 0-.517 2.921c-.073.02-.037 0-.073.038c-.589-.155-.792-.792-1.014-1.332a8.76 8.76 0 0 1-.166-5.164c.128-.405.683-1.681.461-2.068c-.111-.369-.48-.58-.682-.871a8 8 0 0 1-.663-1.237C5.912 9.5 5.69 8.3 5.212 7.216a10.4 10.4 0 0 0-.921-1.489A9.6 9.6 0 0 1 3.276 4.22c-.092-.213-.221-.561-.074-.793a.3.3 0 0 1 .259-.252c.238-.212.921.058 1.16.174a9.2 9.2 0 0 1 1.824.967c.258.194.866.685.866.685h.18c.612.133 1.3.037 1.876.21a12.3 12.3 0 0 1 2.755 1.32a17 17 0 0 1 5.969 6.545c.23.439.327.842.537 1.3c.4.94.9 1.9 1.3 2.814a12.6 12.6 0 0 0 1.36 2.564c.286.4 1.435.612 1.952.822a14 14 0 0 1 1.32.535c.651.4 1.3.861 1.913 1.3c.305.23 1.262.708 1.32 1.091"
               ></path>
            </IconWrapper>
         )}
         {type === 'mongodb' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="#439934"
                  d="M13.74 4.23c-.84-1-1.57-2-1.71-2.22H12c-.14.21-.87 1.22-1.71 2.22c-7.2 9.19 1.14 15.39 1.14 15.39l.07.05c.06.95.22 2.33.22 2.33h.62s.15-1.37.21-2.33l.07-.06s8.32-6.19 1.12-15.38M12 19.48a3.5 3.5 0 0 1-.48-.48L12 9l.45 10a3.6 3.6 0 0 1-.45.48"
               ></path>
            </IconWrapper>
         )}
         {type === 'firebase' && (
            <IconWrapper size={size} viewBox="0 0 128 128">
               <path
                  fill="#ffa000"
                  d="M17.474 103.276L33.229 2.462a2.91 2.91 0 0 1 5.44-.924l16.294 30.39l6.494-12.366a2.91 2.91 0 0 1 5.15 0l43.97 83.714z"
               ></path>
               <path fill="#f57c00" d="M71.903 64.005L54.955 31.913l-37.481 71.363Z"></path>
               <path
                  fill="#ffca28"
                  d="M110.577 103.276L98.51 28.604a2.91 2.91 0 0 0-1.984-2.286a2.91 2.91 0 0 0-2.94.714l-76.112 76.243l42.115 23.618a8.73 8.73 0 0 0 8.51 0l42.478-23.618Z"
               ></path>
               <path
                  fill="#fff"
                  fillOpacity={0.2}
                  d="M98.51 28.604a2.91 2.91 0 0 0-1.984-2.286a2.91 2.91 0 0 0-2.94.713L78.479 42.178L66.6 19.562a2.91 2.91 0 0 0-5.15 0l-6.494 12.365L38.662 1.538A2.91 2.91 0 0 0 35.605.044a2.91 2.91 0 0 0-2.384 2.425L17.474 103.276h-.051l.05.058l.415.204l75.676-75.764a2.91 2.91 0 0 1 4.932 1.571l11.965 74.003l.116-.073zm-80.898 74.534L33.228 3.182A2.91 2.91 0 0 1 35.613.756a2.91 2.91 0 0 1 3.057 1.495l16.292 30.39l6.495-12.366a2.91 2.91 0 0 1 5.15 0L78.245 42.41L17.61 103.138Z"
               ></path>
               <path
                  fill="#a52714"
                  d="M68.099 126.18a8.73 8.73 0 0 1-8.51 0l-42.015-23.55l-.102.647l42.115 23.61a8.73 8.73 0 0 0 8.51 0l42.48-23.61l-.11-.67l-42.37 23.575z"
                  opacity={0.2}
               ></path>
            </IconWrapper>
         )}
         {type === 'supabase' && (
            <IconWrapper size={size} viewBox="0 0 32 32">
               <path
                  fill="#66bb6a"
                  d="M29.92 12H16V2.85a1 1 0 0 0-1.78-.624L1.3 18.376A1 1 0 0 0 2.08 20H16v9.15a1 1 0 0 0 1.78.624l12.92-16.15A1 1 0 0 0 29.92 12"
               ></path>
            </IconWrapper>
         )}

         {type === 'google-workspace' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <path
                  fill="#ffc107"
                  d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917"
               ></path>
               <path
                  fill="#ff3d00"
                  d="m6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691"
               ></path>
               <path
                  fill="#4caf50"
                  d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.9 11.9 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44"
               ></path>
               <path
                  fill="#1976d2"
                  d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917"
               ></path>
            </IconWrapper>
         )}
         {type === 'microsoft-365' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path fill="#f1511b" d="M121.666 121.666H0V0h121.666z"></path>
               <path fill="#80cc28" d="M256 121.666H134.335V0H256z"></path>
               <path fill="#00adef" d="M121.663 256.002H0V134.336h121.663z"></path>
               <path fill="#fbbc09" d="M256 256.002H134.335V134.336H256z"></path>
            </IconWrapper>
         )}
         {type === 'authentication' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  d="M18 24V12m5 10l-10-7m10 0l-10 7M8 11A5 5 0 1 0 8 1a5 5 0 0 0 0 10Zm5.023 2.023C11.772 11.76 10.013 11 8 11c-4 0-7 3-7 7v5h10"
               ></path>
            </IconWrapper>
         )}
         {type === 'device-space' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <g fill="none">
                  <path stroke={color} strokeLinejoin="round" strokeWidth={4} d="M44 29H4v13h40z"></path>
                  <path fill={color} d="M35.5 38a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5"></path>
                  <path stroke={color} strokeLinejoin="round" strokeWidth={4} d="M4 29L9.038 4.999H39.02l4.98 24"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'disk' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path d="M7 3v5h8"></path>
                  <path d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path>
                  <path d="M17 21v-8H7v8"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'storage-disk' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M5 7h14a3 3 0 0 1 2.995 2.824L22 10v4a3 3 0 0 1-2.824 2.995L19 17H5a3 3 0 0 1-2.995-2.824L2 14v-4a3 3 0 0 1 2.824-2.995zh14zm14 1.5H5A1.5 1.5 0 0 0 3.5 10v4A1.5 1.5 0 0 0 5 15.5h14a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 19 8.5M18 10a1 1 0 1 1 0 2a1 1 0 0 1 0-2m-4 0a1 1 0 1 1 0 2a1 1 0 0 1 0-2"
               ></path>
            </IconWrapper>
         )}
         {type === 'storage-drive' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M5.415 5.27A2.25 2.25 0 0 1 7.441 4h9.118c.863 0 1.65.493 2.026 1.27l3.09 6.388c.214.44.325.925.325 1.415v3.677A2.25 2.25 0 0 1 19.75 19H4.25A2.25 2.25 0 0 1 2 16.75v-3.677c0-.49.11-.974.324-1.415zm11.82.653a.75.75 0 0 0-.676-.423H7.441a.75.75 0 0 0-.676.423L4.31 11h15.382zM3.5 13.25v3.5c0 .414.336.75.75.75h15.5a.75.75 0 0 0 .75-.75v-3.5a.75.75 0 0 0-.75-.75H4.25a.75.75 0 0 0-.75.75M18 16a1 1 0 1 0 0-2a1 1 0 0 0 0 2"
               ></path>
            </IconWrapper>
         )}

         {type === 'net-wireless' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M17.745 10.751a8.3 8.3 0 0 1 1.492 2.07a.75.75 0 1 1-1.336.682a6.8 6.8 0 0 0-1.217-1.691A6.562 6.562 0 0 0 6.19 13.485a.75.75 0 1 1-1.338-.677a8.062 8.062 0 0 1 12.893-2.057m-2.102 3.069c.448.447.816.997 1.072 1.582a.75.75 0 1 1-1.374.602a3.7 3.7 0 0 0-.759-1.124a3.59 3.59 0 0 0-5.08 0c-.31.311-.562.69-.747 1.111a.75.75 0 1 1-1.374-.601a5.1 5.1 0 0 1 1.06-1.57a5.09 5.09 0 0 1 7.202 0m-2.582 2.62a1.5 1.5 0 1 1-2.122 2.121a1.5 1.5 0 0 1 2.122-2.122"
               ></path>
            </IconWrapper>
         )}
         {type === 'net-wired' && (
            <IconWrapper size={size} viewBox="0 0 2048 2048">
               <path
                  fill="currentColor"
                  d="M1408 1792q27 0 50 10t40 27t28 41t10 50q0 27-10 50t-27 40t-41 28t-50 10q-27 0-50-10t-40-27t-28-41t-10-50q0-27 10-50t27-40t41-28t50-10m-512 256q0-133 50-249t137-204t203-137t250-50v128q-106 0-199 40t-162 110t-110 163t-41 199zm-384 0q0-141 36-272t103-245t160-207t208-160t244-103t273-37v128q-124 0-238 32t-213 90t-182 141t-140 181t-91 214t-32 238zM2048 896h-256v1152h-128V896h-256V128h640zm-512-640v128h384V256zm384 512V512h-128v128h-128V512h-128v256zm-640 26q-149 31-282 93t-248 151t-205 201t-156 241t-98 272t-35 296H128q0-169 39-329t111-303t176-267t231-221t278-165t317-99z"
               ></path>
            </IconWrapper>
         )}
         {type === 'settings' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path d="M20 7h-9m3 10H5"></path>
                  <circle cx={17} cy={17} r={3}></circle>
                  <circle cx={7} cy={7} r={3}></circle>
               </g>
            </IconWrapper>
         )}
         {type === 'settings-alt' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" fillRule="evenodd">
                  <path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"></path>
                  <path
                     fill={color}
                     d="M18 4a1 1 0 1 0-2 0v1H4a1 1 0 0 0 0 2h12v1a1 1 0 1 0 2 0V7h2a1 1 0 1 0 0-2h-2zM4 11a1 1 0 1 0 0 2h2v1a1 1 0 1 0 2 0v-1h12a1 1 0 1 0 0-2H8v-1a1 1 0 0 0-2 0v1zm-1 7a1 1 0 0 1 1-1h12v-1a1 1 0 1 1 2 0v1h2a1 1 0 1 1 0 2h-2v1a1 1 0 1 1-2 0v-1H4a1 1 0 0 1-1-1"
                  ></path>
               </g>
            </IconWrapper>
         )}
         {type === 'cog' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeWidth={1.5}>
                  <circle cx={12} cy={12} r={3}></circle>
                  <path
                     strokeLinecap="round"
                     d="M3.661 10.64c.473.296.777.802.777 1.36s-.304 1.064-.777 1.36c-.321.203-.529.364-.676.556a2 2 0 0 0-.396 1.479c.052.394.285.798.75 1.605c.467.807.7 1.21 1.015 1.453a2 2 0 0 0 1.479.396c.24-.032.483-.13.819-.308a1.62 1.62 0 0 1 1.567.008c.483.28.77.795.79 1.353c.014.38.05.64.143.863a2 2 0 0 0 1.083 1.083C10.602 22 11.068 22 12 22s1.398 0 1.765-.152a2 2 0 0 0 1.083-1.083c.092-.223.129-.483.143-.863c.02-.558.307-1.074.79-1.353a1.62 1.62 0 0 1 1.567-.008c.336.178.58.276.82.308a2 2 0 0 0 1.478-.396c.315-.242.548-.646 1.014-1.453c.208-.36.369-.639.489-.873m-.81-2.766a1.62 1.62 0 0 1-.777-1.36c0-.559.304-1.065.777-1.362c.321-.202.528-.363.676-.555a2 2 0 0 0 .396-1.479c-.052-.394-.285-.798-.75-1.605c-.467-.807-.7-1.21-1.015-1.453a2 2 0 0 0-1.479-.396c-.24.032-.483.13-.82.308a1.62 1.62 0 0 1-1.566-.008a1.62 1.62 0 0 1-.79-1.353c-.014-.38-.05-.64-.143-.863a2 2 0 0 0-1.083-1.083C13.398 2 12.932 2 12 2s-1.398 0-1.765.152a2 2 0 0 0-1.083 1.083c-.092.223-.129.483-.143.863a1.62 1.62 0 0 1-.79 1.353a1.62 1.62 0 0 1-1.567.008c-.336-.178-.58-.276-.82-.308a2 2 0 0 0-1.478.396C4.04 5.79 3.806 6.193 3.34 7c-.208.36-.369.639-.489.873"
                  ></path>
               </g>
            </IconWrapper>
         )}
         {type === 'integration' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4.513 19.487c2.512 2.392 5.503 1.435 6.7.466c.618-.501.897-.825 1.136-1.065c.837-.777.784-1.555.24-2.177c-.219-.249-1.616-1.591-2.956-2.967c-.694-.694-1.172-1.184-1.582-1.58c-.547-.546-1.026-1.172-1.744-1.154c-.658 0-1.136.58-1.735 1.179c-.688.688-1.196 1.555-1.375 2.333c-.539 2.273.299 3.888 1.316 4.965m0 0L2 21.999M19.487 4.515c-2.513-2.394-5.494-1.42-6.69-.45c-.62.502-.898.826-1.138 1.066c-.837.778-.784 1.556-.239 2.178c.078.09.31.32.635.644m7.432-3.438c1.017 1.077 1.866 2.71 1.327 4.985c-.18.778-.688 1.645-1.376 2.334c-.598.598-1.077 1.179-1.735 1.179c-.718.018-1.09-.502-1.639-1.048m3.423-7.45L22 2m-5.936 9.964c-.41-.395-.994-.993-1.688-1.687c-.858-.882-1.74-1.75-2.321-2.325m4.009 4.012l-1.562 1.524m-3.99-3.983l1.543-1.553"
                  color={color}
               ></path>
            </IconWrapper>
         )}
         {type === 'logs' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 12h.01M4 6h.01M4 18h.01M8 18h2m-2-6h2M8 6h2m4 0h6m-6 6h6m-6 6h6"
               ></path>
            </IconWrapper>
         )}
         {type === 'logout' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="m17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5M4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4z"
               ></path>
            </IconWrapper>
         )}
         {type === 'tags' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path d="m15 5l6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"></path>
                  <path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"></path>
                  <circle cx={6.5} cy={9.5} r={0.5} fill={color}></circle>
               </g>
            </IconWrapper>
         )}
         {type === 'search' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14"
               ></path>
            </IconWrapper>
         )}
         {type === 'clock' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <circle cx={12} cy={12} r={9}></circle>
                  <path d="M11 8v5h5"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'timeline' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M4 2v6H2V2zM2 22v-6h2v6zm3-10c0 1.11-.89 2-2 2a2 2 0 1 1 2-2m11-8c4.42 0 8 3.58 8 8s-3.58 8-8 8c-3.6 0-6.64-2.38-7.65-5.65L6 12l2.35-2.35C9.36 6.38 12.4 4 16 4m0 2c-3.31 0-6 2.69-6 6s2.69 6 6 6s6-2.69 6-6s-2.69-6-6-6m-1 7V8h1.5v4.2l3 1.8l-.82 1.26z"
               ></path>
            </IconWrapper>
         )}
         {type === 'sad' && (
            <IconWrapper size={size} viewBox="0 0 12 12">
               <path
                  fill="currentColor"
                  d="M2.67 5.39c.18.16.59.39 1.1.39c.14 0 .31-.03.47-.07c.71-.19 1.08-.75 1.18-1.06a.504.504 0 0 0-.95-.33a.77.77 0 0 1-.5.43c-.37.09-.64-.12-.64-.12a.505.505 0 0 0-.71.05c-.18.21-.16.53.05.71m5.62.39q-.21 0-.45-.06c-.71-.19-1.08-.76-1.18-1.06c-.09-.26.05-.55.31-.63c.26-.09.55.05.63.31c0 0 .13.32.49.42c.37.1.63-.11.64-.12c.21-.17.52-.15.7.06s.16.52-.05.7c-.19.17-.59.38-1.09.38m.453 3.157a.5.5 0 0 0 .194-.68C8.332 7.168 7.25 6.5 6 6.5s-2.332.668-2.937 1.757a.5.5 0 0 0 .874.486C4.369 7.964 5.121 7.5 6 7.5c.878 0 1.63.464 2.063 1.243a.5.5 0 0 0 .68.194M12 6A6 6 0 1 1 0 6a6 6 0 0 1 12 0m-1 0A5 5 0 1 0 1 6a5 5 0 0 0 10 0"
               ></path>
            </IconWrapper>
         )}
         {type === 'sidebar' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <rect width={18} height={18} x={3} y={3} rx={2}></rect>
                  <path d="M9 3v18"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'key' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
                  <circle cx={16.5} cy={7.5} r={0.5} fill={color}></circle>
               </g>
            </IconWrapper>
         )}
         {type === 'bolt' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M11 21h-1l1-7H6.74S10.42 7.54 13 3h1l-1 7h4.28z"></path>
            </IconWrapper>
         )}
         {type === 'backup' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M6.5 20q-2.28 0-3.89-1.57Q1 16.85 1 14.58q0-1.95 1.17-3.48q1.18-1.53 3.08-1.95q.63-2.3 2.5-3.72Q9.63 4 12 4q2.93 0 4.96 2.04Q19 8.07 19 11q1.73.2 2.86 1.5q1.14 1.28 1.14 3q0 1.88-1.31 3.19T18.5 20H13q-.82 0-1.41-.59Q11 18.83 11 18v-5.15L9.4 14.4L8 13l4-4l4 4l-1.4 1.4l-1.6-1.55V18h5.5q1.05 0 1.77-.73q.73-.72.73-1.77t-.73-1.77Q19.55 13 18.5 13H17v-2q0-2.07-1.46-3.54Q14.08 6 12 6Q9.93 6 8.46 7.46Q7 8.93 7 11h-.5q-1.45 0-2.47 1.03Q3 13.05 3 14.5T4.03 17q1.02 1 2.47 1H9v2m3-7"
               ></path>
            </IconWrapper>
         )}
         {type === 'pause' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M14 19V5h4v14zm-8 0V5h4v14z"></path>
            </IconWrapper>
         )}
         {type === 'resume' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M6 18V6h2v12zm4 0l10-6l-10-6z"></path>
            </IconWrapper>
         )}
         {type === 'clone' && (
            <IconWrapper size={size} viewBox="0 0 512 512">
               <path
                  fill={color}
                  d="M464 0H144c-26.51 0-48 21.49-48 48v48H48c-26.51 0-48 21.49-48 48v320c0 26.51 21.49 48 48 48h320c26.51 0 48-21.49 48-48v-48h48c26.51 0 48-21.49 48-48V48c0-26.51-21.49-48-48-48M362 464H54a6 6 0 0 1-6-6V150a6 6 0 0 1 6-6h42v224c0 26.51 21.49 48 48 48h224v42a6 6 0 0 1-6 6m96-96H150a6 6 0 0 1-6-6V54a6 6 0 0 1 6-6h308a6 6 0 0 1 6 6v308a6 6 0 0 1-6 6"
               ></path>
            </IconWrapper>
         )}
         {type === 'trash' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M5 20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8h2V6h-4V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2H3v2h2zM9 4h6v2H9zM8 8h9v12H7V8z"
               ></path>
               <path fill={color} d="M9 10h2v8H9zm4 0h2v8h-2z"></path>
            </IconWrapper>
         )}
         {type === 'encrypted' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M11.1 15h1.8q.225 0 .388-.187t.112-.413l-.475-2.625q.5-.25.788-.725T14 10q0-.825-.587-1.412T12 8t-1.412.588T10 10q0 .575.288 1.05t.787.725L10.6 14.4q-.05.225.113.413T11.1 15m.9 6.9q-.175 0-.325-.025t-.3-.075Q8 20.675 6 17.637T4 11.1V6.375q0-.625.363-1.125t.937-.725l6-2.25q.35-.125.7-.125t.7.125l6 2.25q.575.225.938.725T20 6.375V11.1q0 3.5-2 6.538T12.625 21.8q-.15.05-.3.075T12 21.9"
               ></path>
            </IconWrapper>
         )}
         {type === 'compressed' && (
            <IconWrapper size={size} viewBox="-2 -4 24 24">
               <path
                  fill={color}
                  d="M10.83 2H17a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3h5c1.306 0 2.417.835 2.83 2M17 4H9.415l-.471-1.334A1 1 0 0 0 8 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1m-3 2h2v2h-2zm-2-2h2v2h-2zm0 4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2z"
               ></path>
            </IconWrapper>
         )}
         {type === 'lock' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M12 2a5 5 0 0 1 5 5v3a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3V7a5 5 0 0 1 5-5m0 12a2 2 0 0 0-1.995 1.85L10 16a2 2 0 1 0 2-2m0-10a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3"
               ></path>
            </IconWrapper>
         )}

         {type === 'unlock' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none">
                  <path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"></path>
                  <path
                     fill={color}
                     d="M12 2c1.091 0 2.117.292 3 .804a1 1 0 1 1-1 1.73A4 4 0 0 0 8 8l11 .001a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1a6 6 0 0 1 6-6m7 8H5v10h14zm-7 2a2 2 0 0 1 1.134 3.647l-.134.085V17a1 1 0 0 1-1.993.117L11 17v-1.268A2 2 0 0 1 12 12m7.918-6.979l.966.26a1 1 0 0 1-.518 1.93l-.965-.258a1 1 0 0 1 .517-1.932M18.633 2.09a1 1 0 0 1 .707 1.225l-.129.482a1 1 0 1 1-1.932-.517l.13-.483a1 1 0 0 1 1.224-.707"
                  ></path>
               </g>
            </IconWrapper>
         )}

         {type === 'folders' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path d="M9 3h3l2 2h5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2"></path>
                  <path d="M17 16v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'fm-directory' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <svg xmlns="http://www.w3.org/2000/svg" width={48} height={48} viewBox="0 0 48 48">
                  <path fill="#ffa000" d="M40 12H22l-4-4H8c-2.2 0-4 1.8-4 4v8h40v-4c0-2.2-1.8-4-4-4"></path>
                  <path fill="#ffca28" d="M40 12H8c-2.2 0-4 1.8-4 4v20c0 2.2 1.8 4 4 4h32c2.2 0 4-1.8 4-4V16c0-2.2-1.8-4-4-4"></path>
               </svg>
            </IconWrapper>
         )}
         {type === 'fm-file' && (
            <IconWrapper size={size} viewBox="0 0 48 48">
               <path fill="#90caf9" d="M40 45H8V3h22l10 10z"></path>
               <path fill="#e1f5fe" d="M38.5 14H29V4.5z"></path>
            </IconWrapper>
         )}
         {type === 'fm-drive' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <g fill={color}>
                  <path d="M232 80v96a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8V80a8 8 0 0 1 8-8h192a8 8 0 0 1 8 8" opacity={0.2}></path>
                  <path d="M224 64H32a16 16 0 0 0-16 16v96a16 16 0 0 0 16 16h192a16 16 0 0 0 16-16V80a16 16 0 0 0-16-16m0 112H32V80h192zm-24-48a12 12 0 1 1-12-12a12 12 0 0 1 12 12"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'file' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M3 1h12.414L21 6.586V23H3zm15.586 6L15 3.414V7zM13 3H5v18h14V9h-6zm-6 9h10v2H7zm0 4h10v2H7z"></path>
            </IconWrapper>
         )}
         {type === 'reload' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M10 11H7.101l.001-.009a5 5 0 0 1 .752-1.787a5.05 5.05 0 0 1 2.2-1.811q.455-.193.938-.291a5.1 5.1 0 0 1 2.018 0a5 5 0 0 1 2.525 1.361l1.416-1.412a7 7 0 0 0-2.224-1.501a7 7 0 0 0-1.315-.408a7.1 7.1 0 0 0-2.819 0a7 7 0 0 0-1.316.409a7.04 7.04 0 0 0-3.08 2.534a7 7 0 0 0-1.054 2.505c-.028.135-.043.273-.063.41H2l4 4zm4 2h2.899l-.001.008a4.98 4.98 0 0 1-2.103 3.138a4.9 4.9 0 0 1-1.787.752a5.1 5.1 0 0 1-2.017 0a5 5 0 0 1-1.787-.752a5 5 0 0 1-.74-.61L7.05 16.95a7 7 0 0 0 2.225 1.5c.424.18.867.317 1.315.408a7.1 7.1 0 0 0 2.818 0a7.03 7.03 0 0 0 4.395-2.945a7 7 0 0 0 1.053-2.503c.027-.135.043-.273.063-.41H22l-4-4z"
               ></path>{' '}
            </IconWrapper>
         )}
         {type === 'interval' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M5 22q-.825 0-1.412-.587T3 20V6q0-.825.588-1.412T5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588T21 6v6h-2v-2H5v10h7v2zm14 2q-1.825 0-3.187-1.137T14.1 20h1.55q.325 1.1 1.238 1.8t2.112.7q1.45 0 2.475-1.025T22.5 19t-1.025-2.475T19 15.5q-.725 0-1.35.262t-1.1.738H18V18h-4v-4h1.5v1.425q.675-.65 1.575-1.037T19 14q2.075 0 3.538 1.463T24 19t-1.463 3.538T19 24M5 8h14V6H5zm0 0V6z"
               ></path>
            </IconWrapper>
         )}
         {(type === 'cli' || type === 'terminal') && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill={color}>
                  <path d="m5.033 14.828l1.415 1.415L10.69 12L6.448 7.757L5.033 9.172L7.862 12zM15 14h-4v2h4z"></path>
                  <path
                     fillRule="evenodd"
                     d="M2 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm20 2H2v16h20z"
                     clipRule="evenodd"
                  ></path>
               </g>
            </IconWrapper>
         )}
         {type === 'rclone' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M11.842.626a7.33 7.33 0 0 0-6.196 3.667a7.3 7.3 0 0 0-.966 4.175a8 8 0 0 1 2.657-.454l1.47-.002a3.2 3.2 0 0 1 .425-1.648a3.196 3.196 0 0 1 5.535 3.196l-1.478 2.564l1.195 2.072h2.391l1.478-2.566A7.336 7.336 0 0 0 11.842.626m-1.545 8.073l-2.96.003a7.337 7.337 0 1 0 4.096 13.423a8 8 0 0 1-1.72-2.075l-.737-1.273a3.2 3.2 0 0 1-1.64.457a3.196 3.196 0 1 1 0-6.391l2.96-.002l1.197-2.071zm9.587.747a8 8 0 0 1-.935 2.528l-.734 1.275c.489.271.915.671 1.215 1.192a3.196 3.196 0 0 1-5.535 3.195l-1.482-2.563H10.02l-1.195 2.071l1.483 2.563a7.336 7.336 0 0 0 12.707-7.337a7.3 7.3 0 0 0-3.132-2.924"
               ></path>
            </IconWrapper>
         )}
         {type === 'restic' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M1.25 13C1.25 7.063 6.063 2.25 12 2.25S22.75 7.063 22.75 13a.75.75 0 0 1-1.238.57c-1.22-1.046-2.01-1.418-2.694-1.418c-.683 0-1.474.372-2.693 1.417a.75.75 0 0 1-1.019-.039c-.838-.838-1.622-1.312-2.356-1.5v6.743c0 1.094-.436 1.964-1.123 2.55c-.67.572-1.538.839-2.377.839c-.84 0-1.707-.267-2.377-.84c-.687-.585-1.123-1.455-1.123-2.55a.75.75 0 0 1 1.5 0c0 .666.251 1.116.596 1.41c.36.307.868.48 1.404.48s1.043-.173 1.404-.48c.345-.294.596-.744.596-1.41V12.03c-.734.19-1.518.663-2.356 1.501a.75.75 0 0 1-1.018.04c-1.22-1.046-2.01-1.418-2.694-1.418s-1.474.372-2.694 1.417A.75.75 0 0 1 1.25 13"
               ></path>
            </IconWrapper>
         )}
         {type === 'progress' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M2 12c0 5.523 4.477 10 10 10s10-4.477 10-10S17.523 2 12 2S2 6.477 2 12m18 0a8 8 0 1 1-16 0a8 8 0 0 1 16 0m-2 0a6 6 0 0 1-10.243 4.243L12 12V6a6 6 0 0 1 6 6"
               ></path>
            </IconWrapper>
         )}
         {type === 'files' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} color={color}>
                  <path d="M14.499 19h-2c-2.828 0-4.243 0-5.121-.879c-.879-.878-.879-2.293-.879-5.121V8c0-2.828 0-4.243.879-5.121C8.256 2 9.67 2 12.499 2h1.343c.818 0 1.226 0 1.594.152c.367.152.657.442 1.235 1.02l2.657 2.656c.578.578.867.868 1.019 1.235s.152.776.152 1.594V13c0 2.828 0 4.243-.879 5.121c-.878.879-2.293.879-5.12.879"></path>
                  <path d="M14.999 2.5v1c0 1.886 0 2.828.586 3.414s1.528.586 3.414.586h1M6.499 5a3 3 0 0 0-3 3v8c0 2.828 0 4.243.879 5.121C5.256 22 6.67 22 9.499 22h5a3 3 0 0 0 3-3M10 11h4m-4 4h7"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'speed' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M11 3.558V5a1 1 0 1 0 2 0V3.558A8.504 8.504 0 0 1 20.442 11H19a1 1 0 1 0 0 2h1.44c-.224 1.817-1.044 3.448-2.24 4.74a.75.75 0 1 0 1.1 1.02C20.943 16.985 22 14.633 22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 2.633 1.057 4.985 2.7 6.76a.75.75 0 1 0 1.1-1.02C4.604 16.449 3.784 14.818 3.56 13H5a1 1 0 1 0 0-2H3.558a8.46 8.46 0 0 1 1.766-4.262l.969.97a1 1 0 0 0 1.414-1.415l-.969-.969A8.46 8.46 0 0 1 11 3.558m5.759 3.076a.646.646 0 0 0-.807.015l-.218.183a396 396 0 0 0-2.351 1.99c-.656.56-1.327 1.14-1.863 1.613a40 40 0 0 0-.689.62a5 5 0 0 0-.42.424a1.837 1.837 0 0 0 .312 2.619a1.934 1.934 0 0 0 2.677-.306c.088-.108.205-.296.325-.497c.128-.215.285-.49.459-.798c.347-.62.768-1.392 1.175-2.145a372 372 0 0 0 1.439-2.697l.131-.249a.61.61 0 0 0-.17-.772"
               ></path>
            </IconWrapper>
         )}
         {type === 'error' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.47 2 2 6.5 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 18a8 8 0 0 1-8-8a8 8 0 0 1 8-8a8 8 0 0 1 8 8a8 8 0 0 1-8 8"
               ></path>
            </IconWrapper>
         )}
         {type === 'error-circle-filled' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  fillRule="evenodd"
                  d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10s10-4.477 10-10M12 7a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1m-1 9a1 1 0 0 1 1-1h.008a1 1 0 1 1 0 2H12a1 1 0 0 1-1-1"
                  clipRule="evenodd"
               ></path>
            </IconWrapper>
         )}
         {type === 'eye' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M12 3c5.392 0 9.878 3.88 10.819 9c-.94 5.12-5.427 9-10.819 9s-9.878-3.88-10.818-9C2.122 6.88 6.608 3 12 3m0 16a9.005 9.005 0 0 0 8.778-7a9.005 9.005 0 0 0-17.555 0A9.005 9.005 0 0 0 12 19m0-2.5a4.5 4.5 0 1 1 0-9a4.5 4.5 0 0 1 0 9m0-2a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5"
               ></path>
            </IconWrapper>
         )}
         {type === 'eye-hide' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M17.883 19.297A10.95 10.95 0 0 1 12 21c-5.392 0-9.878-3.88-10.818-9A11 11 0 0 1 4.52 5.935L1.394 2.808l1.414-1.414l19.799 19.798l-1.414 1.415zM5.936 7.35A8.97 8.97 0 0 0 3.223 12a9.005 9.005 0 0 0 13.201 5.838l-2.028-2.028A4.5 4.5 0 0 1 8.19 9.604zm6.978 6.978l-3.242-3.241a2.5 2.5 0 0 0 3.241 3.241m7.893 2.265l-1.431-1.431A8.9 8.9 0 0 0 20.778 12A9.005 9.005 0 0 0 9.552 5.338L7.974 3.76C9.221 3.27 10.58 3 12 3c5.392 0 9.878 3.88 10.819 9a10.95 10.95 0 0 1-2.012 4.593m-9.084-9.084Q11.86 7.5 12 7.5a4.5 4.5 0 0 1 4.492 4.778z"
               ></path>
            </IconWrapper>
         )}
         {type === 'play' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M6.906 4.537A.6.6 0 0 0 6 5.053v13.894a.6.6 0 0 0 .906.516l11.723-6.947a.6.6 0 0 0 0-1.032z"
               />
            </IconWrapper>
         )}
         {type === 'box' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeWidth="1.5">
                  <path d="M10.55 2.876L4.595 6.182a2.98 2.98 0 0 0-1.529 2.611v6.414a2.98 2.98 0 0 0 1.529 2.61l5.957 3.307a2.98 2.98 0 0 0 2.898 0l5.957-3.306a2.98 2.98 0 0 0 1.529-2.611V8.793a2.98 2.98 0 0 0-1.529-2.61L13.45 2.876a2.98 2.98 0 0 0-2.898 0Z" />
                  <path d="M20.33 6.996L12 12L3.67 6.996M12 21.49V12" />
               </g>
            </IconWrapper>
         )}
         {type === 'compare' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M10 23v-2H5q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h5V1h2v22zm4-18V3h5q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21h-5v-2h5V5zm0 8v-2h3v2zm0-4V7h3v2zm-7 8h3v-2H7zm0-4h3v-2H7zm0-4h3V7H7z"
               />
            </IconWrapper>
         )}
         {type === 'diff' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M6.01 2c-1.93 0-3.5 1.57-3.5 3.5c0 1.58 1.06 2.903 2.5 3.337v7.16c-.001.179.027 1.781 1.174 2.931C6.892 19.64 7.84 20 9 20v2l4-3l-4-3v2c-1.823 0-1.984-1.534-1.99-2V8.837c1.44-.434 2.5-1.757 2.5-3.337c0-1.93-1.571-3.5-3.5-3.5m0 5c-.827 0-1.5-.673-1.5-1.5S5.183 4 6.01 4s1.5.673 1.5 1.5S6.837 7 6.01 7m13 8.163V7.997C19.005 6.391 17.933 4 15 4V2l-4 3l4 3V6c1.829 0 2.001 1.539 2.01 2v7.163c-1.44.434-2.5 1.757-2.5 3.337c0 1.93 1.57 3.5 3.5 3.5s3.5-1.57 3.5-3.5c0-1.58-1.06-2.903-2.5-3.337m-1 4.837c-.827 0-1.5-.673-1.5-1.5s.673-1.5 1.5-1.5s1.5.673 1.5 1.5s-.673 1.5-1.5 1.5"
               />
            </IconWrapper>
         )}
         {type === 'info' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 11v5m0 5a9 9 0 1 1 0-18a9 9 0 0 1 0 18m.05-13v.1h-.1V8z"
               ></path>
            </IconWrapper>
         )}
         {type === 'log-info' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2m1 15h-2v-6h2zm0-8h-2V7h2z"
                  strokeWidth={0.5}
                  stroke={color}
               ></path>
            </IconWrapper>
         )}
         {type === 'log-warn' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M2.725 21q-.275 0-.5-.137t-.35-.363t-.137-.488t.137-.512l9.25-16q.15-.25.388-.375T12 3t.488.125t.387.375l9.25 16q.15.25.138.513t-.138.487t-.35.363t-.5.137zM12 18q.425 0 .713-.288T13 17t-.288-.712T12 16t-.712.288T11 17t.288.713T12 18m0-3q.425 0 .713-.288T13 14v-3q0-.425-.288-.712T12 10t-.712.288T11 11v3q0 .425.288.713T12 15"
                  strokeWidth={0.5}
                  stroke={color}
               ></path>
            </IconWrapper>
         )}
         {type === 'log-error' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2zm0-4h-2V7h2z"
                  strokeWidth={0.5}
                  stroke={color}
               ></path>
            </IconWrapper>
         )}
         {type === 'graph' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill="currentColor" d="M3 12h4v9H3zm14-4h4v13h-4zm-7-6h4v19h-4z"></path>
            </IconWrapper>
         )}

         {type === 'integrity' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11.46 20.846A12 12 0 0 1 3.5 6A12 12 0 0 0 12 3a12 12 0 0 0 8.5 3a12 12 0 0 1-.09 7.06M15 19l2 2l4-4"
               ></path>
            </IconWrapper>
         )}
         {type === 'dots-vertical' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 5.92A.96.96 0 1 0 12 4a.96.96 0 0 0 0 1.92m0 7.04a.96.96 0 1 0 0-1.92a.96.96 0 0 0 0 1.92M12 20a.96.96 0 1 0 0-1.92a.96.96 0 0 0 0 1.92"
               ></path>
            </IconWrapper>
         )}

         {type === 'edit-settings' && (
            <IconWrapper size={size} viewBox="0 0 32 32">
               <path
                  fill={color}
                  d="m31.707 19.293l-3-3a1 1 0 0 0-1.414 0L18 25.586V30h4.414l9.293-9.293a1 1 0 0 0 0-1.414M21.586 28H20v-1.586l5-5L26.586 23zM28 21.586L26.414 20L28 18.414L29.586 20zM16 22c-3.364 0-6-2.636-6-6s2.636-6 6-6s6 2.636 6 6s-2.636 6-6 6m0-10c-2.28 0-4 1.72-4 4s1.72 4 4 4s4-1.72 4-4s-1.72-4-4-4"
               ></path>
               <path
                  fill={color}
                  d="m27.547 12l1.733-1l-2.336-4.044a2 2 0 0 0-2.373-.894l-2.434.823a11 11 0 0 0-1.312-.758l-.503-2.52A2 2 0 0 0 18.36 2h-4.72a2 2 0 0 0-1.962 1.608l-.503 2.519c-.46.224-.906.469-1.327.753l-2.42-.818a2 2 0 0 0-2.373.894l-2.36 4.088a2 2 0 0 0 .412 2.502l1.931 1.697C5.021 15.495 5 15.745 5 16q0 .387.028.766l-1.92 1.688a2 2 0 0 0-.413 2.502l2.36 4.088a2 2 0 0 0 2.374.894l2.434-.823q.627.423 1.312.758l.503 2.519A2 2 0 0 0 13.64 30H16v-2h-2.36l-.71-3.55a9.1 9.1 0 0 1-2.695-1.572l-3.447 1.166l-2.36-4.088l2.725-2.395a8.9 8.9 0 0 1-.007-3.128l-2.719-2.39l2.361-4.087l3.427 1.16A9 9 0 0 1 12.93 7.55L13.64 4h4.721l.71 3.55a9.1 9.1 0 0 1 2.695 1.572l3.447-1.166z"
               ></path>
            </IconWrapper>
         )}
         {type === 'edit' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 20h16M4 20v-4l8-8M4 20h4l8-8m-4-4l2.869-2.869l.001-.001c.395-.395.593-.593.821-.667a1 1 0 0 1 .618 0c.228.074.425.272.82.666l1.74 1.74c.396.396.594.594.668.822a1 1 0 0 1 0 .618c-.074.228-.272.426-.668.822h0L16 12.001m-4-4l4 4"
               ></path>
            </IconWrapper>
         )}
         {type === 'verify' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeWidth={2}>
                  <circle cx={12} cy={12} r={9}></circle>
                  <path d="m8 12l3 3l5-6"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'download' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="m12 16l-5-5l1.4-1.45l2.6 2.6V4h2v8.15l2.6-2.6L17 11zm-6 4q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20z"
               ></path>
            </IconWrapper>
         )}
         {type === 'downloading' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path strokeDasharray="2 4" strokeDashoffset={6} d="M12 3c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9">
                     <animate attributeName="stroke-dashoffset" dur="0.6s" repeatCount="indefinite" values="6;0"></animate>
                  </path>
                  <path strokeDasharray={32} strokeDashoffset={32} d="M12 21c-4.97 0 -9 -4.03 -9 -9c0 -4.97 4.03 -9 9 -9">
                     <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.1s" dur="0.4s" values="32;0"></animate>
                  </path>
                  <path strokeDasharray={10} strokeDashoffset={10} d="M12 8v7.5">
                     <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" values="10;0"></animate>
                  </path>
                  <path strokeDasharray={6} strokeDashoffset={6} d="M12 15.5l3.5 -3.5M12 15.5l-3.5 -3.5">
                     <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" values="6;0"></animate>
                  </path>
               </g>
            </IconWrapper>
         )}
         {type === 'check' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path fill={color} d="M7.3 14.2L.2 9l1.7-2.4l4.8 3.5l6.6-8.5l2.3 1.8z"></path>
            </IconWrapper>
         )}
         {type === 'check-circle' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="m10.6 16.6l7.05-7.05l-1.4-1.4l-5.65 5.65l-2.85-2.85l-1.4 1.4zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8"
               ></path>
            </IconWrapper>
         )}
         {type === 'check-circle-filled' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="m10.6 16.6l7.05-7.05l-1.4-1.4l-5.65 5.65l-2.85-2.85l-1.4 1.4zM12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22"
               ></path>
            </IconWrapper>
         )}
         {type === 'caret-down' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path
                  fill={color}
                  d="M128 188a11.962 11.962 0 0 1-8.485-3.515l-80-80a12 12 0 0 1 16.97-16.97L128 159.029l71.515-71.514a12 12 0 0 1 16.97 16.97l-80 80A11.962 11.962 0 0 1 128 188z"
               />
            </IconWrapper>
         )}
         {type === 'caret-up' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path
                  fill={color}
                  d="M208 172a11.962 11.962 0 0 1-8.485-3.515L128 96.971l-71.515 71.514a12 12 0 0 1-16.97-16.97l80-80a12 12 0 0 1 16.97 0l80 80A12 12 0 0 1 208 172z"
               />
            </IconWrapper>
         )}
         {type === 'arrow-up' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M13 7.828V20h-2V7.828l-5.364 5.364l-1.414-1.414L12 4l7.778 7.778l-1.414 1.414z"></path>
            </IconWrapper>
         )}

         {type === 'arrow-down' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="m13 16.172l5.364-5.364l1.414 1.414L12 20l-7.778-7.778l1.414-1.414L11 16.172V4h2z"></path>
            </IconWrapper>
         )}
         {type === 'arrow-left' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M7.828 11H20v2H7.828l5.364 5.364l-1.414 1.414L4 12l7.778-7.778l1.414 1.414z"></path>
            </IconWrapper>
         )}
         {type === 'arrow-right' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="m16.172 11l-5.364-5.364l1.414-1.414L20 12l-7.778 7.778l-1.414-1.414L16.172 13H4v-2z"></path>
            </IconWrapper>
         )}
         {type === 'email' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none">
                  <path
                     fill={color}
                     d="M3 5v-.75a.75.75 0 0 0-.75.75zm18 0h.75a.75.75 0 0 0-.75-.75zM3 5.75h18v-1.5H3zM20.25 5v12h1.5V5zM19 18.25H5v1.5h14zM3.75 17V5h-1.5v12zM5 18.25c-.69 0-1.25-.56-1.25-1.25h-1.5A2.75 2.75 0 0 0 5 19.75zM20.25 17c0 .69-.56 1.25-1.25 1.25v1.5A2.75 2.75 0 0 0 21.75 17z"
                  ></path>
                  <path stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m3 5l9 9l9-9"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'home' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path fill={color} d="M6 19h3v-6h6v6h3v-9l-6-4.5L6 10zm-2 2V9l8-6l8 6v12h-7v-6h-2v6zm8-8.75"></path>
            </IconWrapper>
         )}
         {type === 'help' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M11.95 18q.525 0 .888-.363t.362-.887t-.362-.888t-.888-.362t-.887.363t-.363.887t.363.888t.887.362m-.9-3.85h1.85q0-.825.188-1.3t1.062-1.3q.65-.65 1.025-1.238T15.55 8.9q0-1.4-1.025-2.15T12.1 6q-1.425 0-2.312.75T8.55 8.55l1.65.65q.125-.45.563-.975T12.1 7.7q.8 0 1.2.438t.4.962q0 .5-.3.938t-.75.812q-1.1.975-1.35 1.475t-.25 1.825M12 22q-2.075 0-3.9-.787t-3.175-2.138T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8"
               ></path>
            </IconWrapper>
         )}
         {type === 'note' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="none"
                  stroke={color}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10m6-6v.172a2 2 0 0 1-.586 1.414l-3.828 3.828a2 2 0 0 1-1.414.586H15m6-6h-4a2 2 0 0 0-2 2v4M7 7h10M7 11h10M7 15h4"
               />
            </IconWrapper>
         )}
         {type === 'sort' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path
                  fill={color}
                  d="M0 4.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.25m0 4a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8.25m0 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75M13.5 10h2.25a.25.25 0 0 1 .177.427l-3 3a.25.25 0 0 1-.354 0l-3-3A.25.25 0 0 1 9.75 10H12V3.75a.75.75 0 0 1 1.5 0z"
               ></path>
            </IconWrapper>
         )}
         {type === 'notification' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeWidth={1.5}>
                  <path
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     d="M21.25 10.745V16.5a4 4 0 0 1-4 4H6.75a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4h7.151"
                  ></path>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.75 7.59L10 11.72a3.94 3.94 0 0 0 4 0l2.219-1.257"></path>
                  <circle cx={19} cy={5} r={2.5}></circle>
               </g>
            </IconWrapper>
         )}
         {type === 'prune' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M3 23v-7q0-2.075 1.463-3.537T8 11h1V3q0-.825.588-1.412T11 1h2q.825 0 1.413.588T15 3v8h1q2.075 0 3.538 1.463T21 16v7zm2-2h2v-3q0-.425.288-.712T8 17t.713.288T9 18v3h2v-3q0-.425.288-.712T12 17t.713.288T13 18v3h2v-3q0-.425.288-.712T16 17t.713.288T17 18v3h2v-5q0-1.25-.875-2.125T16 13H8q-1.25 0-2.125.875T5 16zm8-10V3h-2v8zm0 0h-2z"
               ></path>
            </IconWrapper>
         )}
         {type === 'performance' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill={color}>
                  <path fillRule="evenodd" d="M11 9v4.17a3.001 3.001 0 1 0 2 0V9zm0 7a1 1 0 1 1 2 0a1 1 0 0 1-2 0" clipRule="evenodd"></path>
                  <path d="M12 5a7 7 0 0 1 7 7v1h-2v-1a5 5 0 0 0-10 0v1H5v-1a7 7 0 0 1 7-7"></path>
                  <path
                     fillRule="evenodd"
                     d="M12 23c6.075 0 11-4.925 11-11S18.075 1 12 1S1 5.925 1 12s4.925 11 11 11m0-2a9 9 0 1 0 0-18a9 9 0 0 0 0 18"
                     clipRule="evenodd"
                  ></path>
               </g>
            </IconWrapper>
         )}
         {type === 'pattern' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={color}
                  d="M7 3a4 4 0 0 1 4 4c0 1.86-1.27 3.43-3 3.87v2.26c.37.09.72.24 1.04.43l4.52-4.52C13.2 8.44 13 7.75 13 7a4 4 0 0 1 4-4a4 4 0 0 1 4 4a4 4 0 0 1-4 4c-.74 0-1.43-.2-2-.55L10.45 15c.35.57.55 1.26.55 2a4 4 0 0 1-4 4a4 4 0 0 1-4-4c0-1.86 1.27-3.43 3-3.87v-2.26C4.27 10.43 3 8.86 3 7a4 4 0 0 1 4-4m10 10a4 4 0 0 1 4 4a4 4 0 0 1-4 4a4 4 0 0 1-4-4a4 4 0 0 1 4-4m0 2a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2a2 2 0 0 0-2-2"
               ></path>
            </IconWrapper>
         )}
         {type === 'copy' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none">
                  <path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z"></path>
                  <path
                     fill={color}
                     d="M19 2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2zm-4 6H5v12h10zm-5 7a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm9-11H9v2h6a2 2 0 0 1 2 2v8h2zm-7 7a1 1 0 0 1 .117 1.993L12 13H8a1 1 0 0 1-.117-1.993L8 11z"
                  ></path>
               </g>
            </IconWrapper>
         )}
         {type === 'file-new' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} color={color}>
                  <path d="M13 2h.273c3.26 0 4.892 0 6.024.798c.324.228.612.5.855.805c.848 1.066.848 2.6.848 5.67v2.545c0 2.963 0 4.445-.469 5.628c-.754 1.903-2.348 3.403-4.37 4.113c-1.257.441-2.83.441-5.98.441c-1.798 0-2.698 0-3.416-.252c-1.155-.406-2.066-1.263-2.497-2.35C4 18.722 4 17.875 4 16.182V12"></path>
                  <path d="M21 12a3.333 3.333 0 0 1-3.333 3.333c-.666 0-1.451-.116-2.098.057a1.67 1.67 0 0 0-1.179 1.179c-.173.647-.057 1.432-.057 2.098A3.333 3.333 0 0 1 11 22m0-16H3m4-4v8"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'file-modified' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} color={color}>
                  <path d="M20.054 11V7.817c0-1.693 0-2.54-.268-3.216c-.433-1.088-1.347-1.945-2.506-2.35c-.72-.253-1.623-.253-3.428-.253c-3.159 0-4.738 0-6 .441c-2.027.71-3.627 2.21-4.383 4.114c-.47 1.183-.47 2.665-.47 5.629v2.545c-.001 3.07-.001 4.605.85 5.671c.243.306.532.577.858.805c1.048.737 2.522.794 5.314.798"></path>
                  <path d="M3 11.979c0-1.84 1.58-3.314 3.421-3.314c.666 0 1.45.116 2.098-.057a1.67 1.67 0 0 0 1.179-1.179c.173-.647.056-1.432.056-2.098a3.333 3.333 0 0 1 3.334-3.333m6.789 12.485l.688.684a1.477 1.477 0 0 1 0 2.096l-3.603 3.651a2 2 0 0 1-1.04.546l-2.232.482a.495.495 0 0 1-.59-.586l.474-2.209c.074-.392.265-.752.548-1.034l3.648-3.63a1.495 1.495 0 0 1 2.107 0"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'file-removed' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} color={color}>
                  <path d="M11 6H3m10-4h.273c3.26 0 4.892 0 6.024.798c.324.228.612.5.855.805c.848 1.066.848 2.6.848 5.67v2.545c0 2.963 0 4.445-.469 5.628c-.754 1.903-2.348 3.403-4.37 4.113c-1.257.441-2.83.441-5.98.441c-1.798 0-2.698 0-3.416-.252c-1.155-.406-2.066-1.263-2.497-2.35C4 18.722 4 17.875 4 16.182V12"></path>
                  <path d="M21 12a3.333 3.333 0 0 1-3.333 3.333c-.666 0-1.451-.116-2.098.057a1.67 1.67 0 0 0-1.179 1.179c-.173.647-.057 1.432-.057 2.098A3.333 3.333 0 0 1 11 22"></path>
               </g>
            </IconWrapper>
         )}

         {type === 'cpu' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <rect width={16} height={16} x={4} y={4} rx={2}></rect>
                  <rect width={6} height={6} x={9} y={9} rx={1}></rect>
                  <path d="M15 2v2m0 16v2M2 15h2M2 9h2m16 6h2m-2-6h2M9 2v2m0 16v2"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'memory' && (
            <IconWrapper size={size} viewBox="0 0 16 16">
               <path
                  fill="currentColor"
                  d="M14.414 4.586A2 2 0 0 0 13 4V2.5a.5.5 0 0 0-1 0V4h-2V2.5a.5.5 0 1 0-1 0V4H7V2.5a.5.5 0 1 0-1 0V4H4V2.5a.5.5 0 1 0-1 0V4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2v1.5a.5.5 0 0 0 1 0V12h2v1.5a.5.5 0 0 0 1 0V12h2v1.5a.5.5 0 0 0 1 0V12h2v1.5a.5.5 0 0 0 1 0V12a2 2 0 0 0 2-2V6a2 2 0 0 0-.586-1.414M14 10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1zm-1.5-4h-9a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5M12 9H4V7h8z"
               ></path>
            </IconWrapper>
         )}

         {type === 'percent' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                  <path fill="currentColor" d="M12 3a9 9 0 0 1 8.497 6.025L12 12z" stroke="none"></path>
                  <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0"></path>
               </g>
            </IconWrapper>
         )}

         {/* /OS LOGOS */}
         {type === 'windows' && (
            <IconWrapper size={size} viewBox="0 0 128 128">
               <path
                  fill="#00adef"
                  d="m126 1.637l-67 9.834v49.831l67-.534zM1.647 66.709l.003 42.404l50.791 6.983l-.04-49.057zm56.82.68l.094 49.465l67.376 9.509l.016-58.863zM1.61 19.297l.047 42.383l50.791-.289l-.023-49.016z"
               ></path>
            </IconWrapper>
         )}
         {type === 'macos' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="#222"
                  d="M16.3 0c.214 1.46-.378 2.89-1.16 3.9c-.835 1.08-2.27 1.92-3.66 1.88c-.254-1.4.398-2.83 1.19-3.8C13.539.91 15.03.1 16.3.01zm.5 6c1.59 0 3.27.874 4.47 2.38c-3.93 2.17-3.29 7.84.68 9.36c-.413.996-.919 1.95-1.51 2.85c-.982 1.51-2.37 3.39-4.08 3.41c-.706.007-1.17-.207-1.67-.438c-.579-.267-1.21-.557-2.32-.551c-1.1.005-1.74.292-2.33.556c-.512.23-.984.443-1.69.436c-1.72-.015-3.03-1.71-4.01-3.22c-2.75-4.22-3.03-9.18-1.34-11.8c1.2-1.87 3.1-2.97 4.89-2.97c.952 0 1.72.276 2.45.539c.664.239 1.3.467 2.01.467c.662 0 1.21-.208 1.8-.435c.714-.273 1.5-.573 2.65-.573z"
               ></path>
            </IconWrapper>
         )}
         {type === 'centos' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path
                  fill="#932279"
                  d="m107.86 118.641l9.229 9.177l-9.229 9.175H42.901v30.571L3.286 127.818l39.615-39.08v29.903zm28.554-78.068h78.929v78.93h-78.929z"
               ></path>
               <path
                  fill="#efa724"
                  d="m137.275 107.86l-9.175 9.229l-9.175-9.229V42.901H88.352L128.1 3.286l39.077 39.615h-29.902zm-.86 28.554h78.928v78.93h-78.929z"
               ></path>
               <path
                  fill="#262577"
                  d="m148.057 137.275l-9.23-9.175l9.23-9.175h64.958V88.352l39.617 39.748l-39.617 39.077v-29.902zm-107.484-.86h78.929v78.93H40.573z"
               ></path>
               <path
                  fill="#9ccd2a"
                  d="m118.641 148.057l9.175-9.23l9.177 9.23v64.96h30.571l-39.748 39.615l-39.076-39.615h29.901zM40.573 40.573h78.929v78.93H40.573z"
               ></path>
               <path
                  fill="#fff"
                  d="M37.754 37.754h84.567v84.567H37.754zm5.637 78.93h73.291V43.393H43.391zm90.206-78.93h84.567v84.567h-84.567zm5.637 78.93h73.291V43.393h-73.291zm-5.637 16.913h84.567v84.569h-84.567zm5.637 78.928h73.291v-73.291h-73.291zm-101.48-78.928h84.567v84.569H37.754zm5.637 78.928h73.291v-73.291H43.391z"
               ></path>
               <path
                  fill="#fff"
                  d="m60.188 187.758l-59.8-59.8L60.187 68.16l59.8 59.798zm-51.826-59.8l51.826 51.826l51.824-51.826l-51.826-51.824zm119.596-7.972L68.16 60.188l59.798-59.8l59.798 59.8zM76.134 60.188l51.824 51.824l51.826-51.824l-51.826-51.826zm119.596 127.57l-59.798-59.8L195.73 68.16l59.798 59.798zm-51.826-59.8l51.826 51.826l51.824-51.826l-51.824-51.824zm-15.946 127.57L68.16 195.73l59.798-59.798l59.798 59.798zM76.134 195.73l51.824 51.824l51.826-51.824l-51.826-51.824z"
               ></path>
            </IconWrapper>
         )}
         {type === 'fedora' && (
            <IconWrapper size={size} viewBox="0 0 128 128">
               <path
                  fill="#294172"
                  d="M127.82 64.004C127.82 28.754 99.246.18 64 .18C28.766.18.203 28.73.18 63.957v49.39c.02 7.997 6.504 14.473 14.508 14.473h49.335c35.239-.015 63.797-28.578 63.797-63.816"
               ></path>
               <path
                  fill="none"
                  stroke="#3c6eb4"
                  strokeWidth={14.003}
                  d="M36.973 68.12H59.91v22.94c0 12.66-10.273 22.937-22.937 22.937c-12.66 0-22.934-10.277-22.934-22.937s10.274-22.938 22.934-22.938zm0 0"
               ></path>
               <path
                  fill="none"
                  stroke="#3c6eb4"
                  strokeWidth={14.003}
                  d="M82.738 68.164H59.801V45.231c0-12.66 10.277-22.938 22.937-22.938s22.938 10.274 22.938 22.938c0 12.66-10.278 22.933-22.938 22.933zm0 0"
               ></path>
               <path
                  fill="#fff"
                  d="M66.926 61.137v29.89c0 16.54-13.41 29.953-29.95 29.953c-2.511 0-4.296-.285-6.617-.89c-3.39-.887-6.156-3.664-6.16-6.895c0-3.906 2.836-6.746 7.074-6.746c2.016 0 2.747.387 5.704.387c8.718 0 15.793-7.063 15.808-15.785V77.312c0-1.23-1-2.23-2.234-2.226l-10.387-.004c-3.867 0-6.996-3.086-6.996-6.965c0-3.906 3.16-6.98 7.07-6.98"
               ></path>
               <path
                  fill="#fff"
                  d="M52.785 75.148V45.262c0-16.543 13.41-29.953 29.953-29.953c2.508 0 4.293.28 6.617.89c3.387.887 6.157 3.664 6.157 6.895c0 3.906-2.836 6.746-7.07 6.746c-2.02 0-2.75-.387-5.704-.387c-8.722 0-15.797 7.063-15.812 15.781v13.743a2.235 2.235 0 0 0 2.234 2.226l10.387.004c3.871 0 6.996 3.086 6.996 6.965c.004 3.906-3.16 6.98-7.07 6.98"
               ></path>
               <path
                  fill="#3c6eb4"
                  d="M116.809 116.773v-2.652l-1.211 2.781l-1.18-2.78v2.651h-.68v-4.187h.711l1.168 2.676l1.149-2.676h.722v4.187zm-4.954-3.484v3.484h-.71v-3.484h-1.192v-.703h3.09v.703"
               ></path>
            </IconWrapper>
         )}
         {type === 'debian' && (
            <IconWrapper size={size} viewBox="0 0 128 128">
               <path
                  fill="#a80030"
                  d="M73.776 67.531c-2.065.028.391 1.063 3.087 1.479a28 28 0 0 0 2.023-1.741c-1.679.41-3.387.419-5.11.262m11.086-2.763c1.229-1.697 2.127-3.556 2.442-5.478c-.276 1.369-1.019 2.553-1.72 3.801c-3.86 2.431-.363-1.443-.002-2.916c-4.15 5.225-.57 3.133-.72 4.593m4.093-10.648c.249-3.72-.733-2.544-1.063-1.125c.384.201.69 2.622 1.063 1.125M65.944 3.283c1.102.198 2.381.35 2.202.612c1.206-.263 1.48-.506-2.202-.612m2.202.613l-.779.161l.725-.064zm34.372 51.634c.123 3.34-.978 4.961-1.969 7.829l-1.786.892c-1.46 2.838.142 1.802-.903 4.059c-2.281 2.027-6.921 6.345-8.406 6.738c-1.084-.023.734-1.278.972-1.771c-3.052 2.098-2.449 3.147-7.118 4.422l-.136-.305c-11.516 5.417-27.51-5.318-27.299-19.966c-.123.931-.349.697-.605 1.074c-.594-7.537 3.481-15.107 10.353-18.196c6.722-3.329 14.602-1.963 19.417 2.524c-2.644-3.465-7.909-7.137-14.148-6.793c-6.111.097-11.828 3.98-13.735 8.196c-3.132 1.972-3.495 7.6-4.859 8.628c-1.835 13.491 3.453 19.318 12.398 26.175c1.407.949.396 1.093.587 1.815c-2.972-1.392-5.694-3.493-7.931-6.065c1.186 1.739 2.468 3.429 4.125 4.756c-2.803-.949-6.546-6.79-7.64-7.028c4.832 8.649 19.599 15.169 27.333 11.935c-3.579.131-8.124.073-12.145-1.413c-1.688-.869-3.984-2.669-3.574-3.007c10.553 3.944 21.456 2.988 30.586-4.333c2.323-1.81 4.861-4.887 5.594-4.93c-1.105 1.661.188.8-.66 2.266c2.316-3.733-1.005-1.521 2.394-6.448l1.256 1.729c-.467-3.098 3.848-6.861 3.41-11.762c.99-1.499 1.104 1.612.054 5.061c1.457-3.825.384-4.44.759-7.597c.404 1.062.935 2.188 1.208 3.308c-.95-3.696.975-6.226 1.45-8.373c-.467-.208-1.464 1.634-1.692-2.732c.034-1.896.528-.993.718-1.46c-.373-.215-1.349-1.668-1.944-4.456c.431-.655 1.151 1.698 1.739 1.795c-.378-2.217-1.028-3.907-1.053-5.609c-1.713-3.579-.606.478-1.996-1.536c-1.823-5.687 1.513-1.32 1.738-3.903c2.763 4.003 4.339 10.208 5.062 12.777c-.552-3.133-1.443-6.168-2.532-9.105c.839.354-1.352-6.446 1.091-1.943c-2.609-9.6-11.166-18.569-19.038-22.778c.962.881 2.179 1.989 1.743 2.162c-3.915-2.331-3.227-2.513-3.787-3.498c-3.19-1.297-3.399.104-5.511.003c-6.012-3.188-7.171-2.85-12.703-4.848l.252 1.177c-3.984-1.327-4.641.503-8.945.004c-.263-.205 1.379-.74 2.73-.937c-3.85.508-3.67-.759-7.438.14c.929-.651 1.909-1.082 2.9-1.637c-3.139.191-7.495 1.828-6.151.339c-5.121 2.286-14.218 5.493-19.322 10.28l-.161-1.073c-2.339 2.809-10.2 8.387-10.826 12.022l-.625.146c-1.218 2.06-2.004 4.396-2.97 6.517c-1.592 2.713-2.334 1.044-2.107 1.469c-3.132 6.349-4.687 11.683-6.03 16.057c.958 1.432.022 8.614.385 14.364c-1.572 28.394 19.928 55.962 43.43 62.329c3.445 1.23 8.567 1.184 12.924 1.311c-5.141-1.471-5.806-.778-10.813-2.525c-3.614-1.701-4.405-3.644-6.964-5.864l1.014 1.79c-5.019-1.775-2.918-2.198-7.002-3.491l1.083-1.412c-1.627-.123-4.309-2.74-5.042-4.191l-1.779.07c-2.138-2.638-3.277-4.538-3.194-6.011l-.575 1.024c-.652-1.119-7.865-9.893-4.123-7.85c-.696-.637-1.62-1.035-2.622-2.856l.762-.871c-1.802-2.316-3.315-5.287-3.2-6.276c.96 1.298 1.627 1.54 2.287 1.763c-4.548-11.285-4.803-.622-8.248-11.487l.729-.059c-.559-.842-.898-1.756-1.347-2.652l.316-3.161c-3.274-3.786-.916-16.098-.443-22.851c.328-2.746 2.733-5.669 4.563-10.252l-1.114-.192c2.131-3.717 12.167-14.928 16.815-14.351c2.251-2.829-.446-.011-.886-.723c4.945-5.119 6.5-3.617 9.838-4.537c3.6-2.137-3.089.833-1.383-.815c6.223-1.589 4.41-3.613 12.528-4.42c.857.487-1.987.752-2.701 1.385c5.185-2.536 16.408-1.959 23.697 1.408c8.458 3.952 17.961 15.638 18.336 26.631l.427.114c-.216 4.37.669 9.424-.865 14.066zM51.233 70.366l-.29 1.448c1.357 1.845 2.435 3.843 4.167 5.283c-1.246-2.434-2.173-3.44-3.877-6.731m3.208-.126c-.718-.795-1.144-1.751-1.62-2.704c.456 1.675 1.388 3.114 2.255 4.578zm56.785-12.343l-.304.762a36.7 36.7 0 0 1-3.599 11.487a36.1 36.1 0 0 0 3.903-12.249M66.353 2.293c1.396-.513 3.433-.281 4.914-.617c-1.93.162-3.852.259-5.75.503zM17.326 28.362c.322 2.979-2.242 4.135.567 2.171c1.506-3.39-.588-.935-.567-2.171M14.025 42.15c.646-1.986.764-3.18 1.011-4.328c-1.788 2.285-.823 2.773-1.011 4.328"
               ></path>
            </IconWrapper>
         )}
         {type === 'mint' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <circle cx={128} cy={128} r={118} fill="#69b53f"></circle>
               <path
                  fill="#fff"
                  d="M128 0C57.308 0 0 57.308 0 128s57.308 128 128 128s128-57.308 128-128S198.692 0 128 0m0 20c59.647 0 108 48.353 108 108s-48.353 108-108 108S20 187.647 20 128S68.353 20 128 20"
               ></path>
               <path
                  fill="#f8f8f8"
                  d="M78.5 62.5V153c0 10.772 8.43 19.317 19.153 19.497l.347.003h60c10.772 0 19.317-8.43 19.497-19.153l.003-.347v-50c0-5.365-4.135-9.5-9.5-9.5c-5.273 0-9.357 3.994-9.496 9.224l-.004.276v50.5h-21V103c0-5.365-4.135-9.5-9.5-9.5c-5.273 0-9.357 3.994-9.496 9.224l-.004.276v50.5h-21V103c0-16.726 13.774-30.5 30.5-30.5c7.038 0 13.734 2.515 19.179 6.997l.396.331l.425.368l.434-.376c5.25-4.46 11.71-7.064 18.538-7.302l.526-.014l.502-.004c16.559 0 30.224 13.5 30.496 30l.004.5v50c0 22.027-17.888 40.135-39.834 40.495l-.666.005H98c-22.027 0-40.135-17.888-40.495-39.834L57.5 153V62.5z"
               ></path>
            </IconWrapper>
         )}
         {type === 'popos' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="#46bac8"
                  d="M12 0C5.372 0 0 5.373 0 12c0 6.628 5.372 12 12 12c6.627 0 12-5.372 12-12c0-6.627-5.373-12-12-12M9.64 2.918c1.091-.026 1.548.229 2.182.635a4.46 4.46 0 0 1 1.902 2.764c.254 1.141.178 2.029-.127 2.664v.05c-.609 1.294-1.622 2.335-3.043 2.842l1.217 3.172c.228.583.432 1.192.254 1.75c-.177.558-.989.736-1.572.127c-1.116-1.192-4.871-8.702-5.15-9.26s-.584-1.016-.584-1.574c.026-.837 1.318-1.7 1.953-2.131c.634-.431 1.877-1.014 2.968-1.039m-.996 2.311c-.789.022-.358 1.669-.197 2.129c.178.507.661 1.572 1.193 2.105c.127.127.254.229.407.254c.152.027.457-.127.584-.33a.93.93 0 0 0 .15-.559a3.2 3.2 0 0 0-.049-1.216c-.228-.787-.711-1.548-1.346-2.055c-.127-.102-.279-.229-.457-.279a.9.9 0 0 0-.285-.049m8.414 2.027a2.28 2.28 0 0 1 1.588.636c.305.279.33.582.229.963c-.102.38-.457 1.194-.736 1.777l-.709 1.344c-1.37 2.435-1.649 2.689-2.03 2.537c-.456-.178-.304-2.614.127-5.582c.127-.812.329-1.217.557-1.42c.171-.152.6-.248.975-.254zm-1.859 8.332c.554.011.789.7.656 1.232a.86.86 0 0 1-.379.559c-.203.127-.685.127-.965-.102c-.278-.228-.33-.609-.254-.914c.076-.304.331-.635.686-.736a.8.8 0 0 1 .256-.039m-8.604 2.805h10.809c.52 0 .938.419.938.939v.074c0 .52-.418.94-.938.94H6.595a.936.936 0 0 1-.937-.94v-.074c0-.52.417-.939.937-.939"
               ></path>
            </IconWrapper>
         )}
         {type === 'ubuntu' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path
                  fill="#dd4814"
                  d="M255.637 127.683c0 70.514-57.165 127.68-127.683 127.68C57.434 255.363.27 198.197.27 127.683C.27 57.165 57.436 0 127.954 0c70.519 0 127.683 57.165 127.683 127.683"
               ></path>
               <path
                  fill="#fff"
                  d="M41.133 110.633c-9.419 0-17.05 7.631-17.05 17.05c0 9.414 7.631 17.046 17.05 17.046c9.415 0 17.046-7.632 17.046-17.046c0-9.419-7.631-17.05-17.046-17.05m121.715 77.478c-8.153 4.71-10.95 15.13-6.24 23.279c4.705 8.154 15.125 10.949 23.279 6.24c8.153-4.705 10.949-15.125 6.24-23.28c-4.705-8.148-15.131-10.943-23.279-6.239m-84.686-60.428c0-16.846 8.368-31.73 21.171-40.742L86.87 66.067c-14.914 9.97-26.012 25.204-30.624 43.047c5.382 4.39 8.826 11.075 8.826 18.568c0 7.489-3.444 14.174-8.826 18.565C60.852 164.094 71.95 179.33 86.87 189.3l12.463-20.88c-12.803-9.007-21.171-23.89-21.171-40.737m49.792-49.797c26.013 0 47.355 19.944 49.595 45.38l24.29-.358c-1.194-18.778-9.398-35.636-22.002-48.032c-6.482 2.449-13.97 2.074-20.44-1.656c-6.483-3.741-10.548-10.052-11.659-16.902a74.3 74.3 0 0 0-19.785-2.69a73.8 73.8 0 0 0-32.819 7.663l11.845 21.227a49.6 49.6 0 0 1 20.975-4.632m0 99.59a49.6 49.6 0 0 1-20.974-4.632l-11.845 21.225a73.7 73.7 0 0 0 32.82 7.671a74 74 0 0 0 19.784-2.697c1.111-6.85 5.177-13.155 11.658-16.902c6.476-3.737 13.959-4.105 20.44-1.656c12.605-12.396 20.808-29.254 22.004-48.032l-24.297-.358c-2.235 25.443-23.576 45.38-49.59 45.38m34.888-110.231c8.154 4.708 18.575 1.92 23.279-6.234c4.71-8.154 1.92-18.575-6.234-23.285c-8.154-4.704-18.574-1.91-23.285 6.244c-4.703 8.15-1.908 18.57 6.24 23.275"
               ></path>
            </IconWrapper>
         )}
         {type === 'kali' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill="#222"
                  d="M12.778 5.943s-1.97-.13-5.327.92c-3.42 1.07-5.36 2.587-5.36 2.587s5.098-2.847 10.852-3.008zm7.351 3.095l.257-.017s-1.468-1.78-4.278-2.648c1.58.642 2.954 1.493 4.021 2.665m.42.74c.039-.068.166.217.263.337c.004.024.01.039-.045.027c-.005-.025-.013-.032-.013-.032s-.135-.08-.177-.137s-.049-.157-.028-.195m3.448 8.479s.312-3.578-5.31-4.403a18 18 0 0 0-2.524-.187c-4.506.06-4.67-5.197-1.275-5.462c1.407-.116 3.087.643 4.73 1.408c-.007.204.002.385.136.552s.648.35.813.445c.164.094.691.43 1.014.85c.07-.131.654-.512.654-.512s-.14.003-.465-.119c-.326-.122-.713-.49-.722-.511s-.015-.055.06-.07c.059-.049-.072-.207-.13-.265s-.445-.716-.454-.73c-.009-.016-.012-.031-.04-.05c-.085-.027-.46.04-.46.04s-.575-.283-.774-.893c.003.107-.099.224 0 .469c-.3-.127-.558-.344-.762-.88c-.12.305 0 .499 0 .499s-.707-.198-.82-.85c-.124.293 0 .469 0 .469s-1.153-.602-3.069-.61c-1.283-.118-1.55-2.374-1.43-2.754c0 0-1.85-.975-5.493-1.406c-3.642-.43-6.628-.065-6.628-.065s6.45-.31 11.617 1.783c.176.785.704 2.094.989 2.723c-.815.563-1.733 1.092-1.876 2.97s1.472 3.53 3.474 3.58c1.9.102 3.214.116 4.806.942c1.52.84 2.766 3.4 2.89 5.703c.132-1.709-.509-5.383-3.5-6.498c4.181.732 4.549 3.832 4.549 3.832M12.68 5.663l-.15-.485s-2.484-.441-5.822-.204S0 6.38 0 6.38s6.896-1.735 12.68-.717"
               ></path>
            </IconWrapper>
         )}
         {type === 'arch' && (
            <IconWrapper size={size} viewBox="0 0 128 128">
               <g fill="#1791cf">
                  <path
                     fillRule="evenodd"
                     d="M61.113 4.886C55.82 17.79 52.63 26.23 46.738 38.75c3.614 3.804 8.047 8.242 15.246 13.25c-7.742-3.168-13.02-6.348-16.968-9.649c-7.54 15.645-19.352 37.934-43.325 80.77c18.844-10.817 33.45-17.485 47.059-20.031a34 34 0 0 1-.895-8.024l.024-.602c.297-12.003 6.578-21.238 14.016-20.609c7.437.625 13.222 10.871 12.921 22.875c-.054 2.262-.312 4.434-.761 6.45c13.465 2.62 27.914 9.273 46.5 19.94c-3.664-6.706-6.934-12.757-10.059-18.519c-4.922-3.793-10.055-8.726-20.523-14.074c7.195 1.863 12.347 4.008 16.363 6.406C74.578 38.121 72.004 30.308 61.113 4.886m0 0"
                  ></path>
                  <path d="M121.14 112.57v-3.242h-1.214v-.434h2.93v.434h-1.223v3.242zm2.223 0v-3.676h.735l.875 2.602c.082.242.14.426.175.543q.065-.2.2-.586l.882-2.559h.66v3.676h-.472v-3.078l-1.074 3.078h-.442l-1.066-3.129v3.129z"></path>
               </g>
            </IconWrapper>
         )}
         {type === 'zorin' && (
            <IconWrapper size={size} viewBox="0 0 256 227">
               <path
                  fill="#0af"
                  d="M125.928 0L64.159.034l-17.884 31.35h163.553L192.15.205zM24.143 70.28L0 112.91l22.493 39.964h8.684l122.746-82.593zm199.51 0L100.89 152.875h132.686L256 113.254l-24.178-42.973zM44.47 191.773l19.398 34.186l66.205.207l61.786-.035l19.604-34.358z"
               ></path>
            </IconWrapper>
         )}
         {type === 'manjaro' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path fill="#35bf5c" d="M256 0v256h-74.925V0zm-90.54 90.536V256H90.535V90.536zm0-90.536v74.925H74.67V256H0V0z"></path>
            </IconWrapper>
         )}
         {type === 'linux' && (
            <IconWrapper size={size} viewBox="0 0 128 128">
               <path
                  fill="currentColor"
                  fillRule="evenodd"
                  d="M113.823 104.595c-1.795-1.478-3.629-2.921-5.308-4.525c-1.87-1.785-3.045-3.944-2.789-6.678c.147-1.573-.216-2.926-2.113-3.452c.446-1.154.864-1.928 1.033-2.753c.188-.92.178-1.887.204-2.834c.264-9.96-3.334-18.691-8.663-26.835c-2.454-3.748-5.017-7.429-7.633-11.066c-4.092-5.688-5.559-12.078-5.633-18.981a47.6 47.6 0 0 0-1.081-9.475C80.527 11.956 77.291 7.233 71.422 4.7c-4.497-1.942-9.152-2.327-13.901-1.084c-6.901 1.805-11.074 6.934-10.996 14.088c.074 6.885.417 13.779.922 20.648c.288 3.893-.312 7.252-2.895 10.34c-2.484 2.969-4.706 6.172-6.858 9.397c-1.229 1.844-2.317 3.853-3.077 5.931c-2.07 5.663-3.973 11.373-7.276 16.5c-1.224 1.9-1.363 4.026-.494 6.199c.225.563.363 1.429.089 1.882c-2.354 3.907-5.011 7.345-10.066 8.095c-3.976.591-4.172 1.314-4.051 5.413c.1 3.337.061 6.705-.28 10.021c-.363 3.555.008 4.521 3.442 5.373c7.924 1.968 15.913 3.647 23.492 6.854c3.227 1.365 6.465.891 9.064-1.763c2.713-2.771 6.141-3.855 9.844-3.859c6.285-.005 12.572.298 18.86.369c1.702.02 2.679.653 3.364 2.199c.84 1.893 2.26 3.284 4.445 3.526c4.193.462 8.013-.16 11.19-3.359c3.918-3.948 8.436-7.066 13.615-9.227c1.482-.619 2.878-1.592 4.103-2.648c2.231-1.922 2.113-3.146-.135-5M62.426 24.12c.758-2.601 2.537-4.289 5.243-4.801c2.276-.43 4.203.688 5.639 3.246c1.546 2.758 2.054 5.64.734 8.658c-1.083 2.474-1.591 2.707-4.123 1.868c-.474-.157-.937-.343-1.777-.652c.708-.594 1.154-1.035 1.664-1.382c1.134-.772 1.452-1.858 1.346-3.148c-.139-1.694-1.471-3.194-2.837-3.175c-1.225.017-2.262 1.167-2.4 2.915c-.086 1.089.095 2.199.173 3.589c-3.446-1.023-4.711-3.525-3.662-7.118m-12.75-2.251c1.274-1.928 3.197-2.314 5.101-1.024c2.029 1.376 3.547 5.256 2.763 7.576c-.285.844-1.127 1.5-1.716 2.241l-.604-.374c-.23-1.253-.276-2.585-.757-3.733c-.304-.728-1.257-1.184-1.919-1.762c-.622.739-1.693 1.443-1.757 2.228c-.088 1.084.477 2.28.969 3.331c.311.661 1.001 1.145 1.713 1.916l-1.922 1.51c-3.018-2.7-3.915-8.82-1.871-11.909M87.34 86.075c-.203 2.604-.5 2.713-3.118 3.098c-1.859.272-2.359.756-2.453 2.964a102 102 0 0 0-.012 7.753c.061 1.77-.537 3.158-1.755 4.393c-6.764 6.856-14.845 10.105-24.512 8.926c-4.17-.509-6.896-3.047-9.097-6.639c.98-.363 1.705-.607 2.412-.894c3.122-1.27 3.706-3.955 1.213-6.277c-1.884-1.757-3.986-3.283-6.007-4.892c-1.954-1.555-3.934-3.078-5.891-4.629c-1.668-1.323-2.305-3.028-2.345-5.188c-.094-5.182.972-10.03 3.138-14.747c1.932-4.209 3.429-8.617 5.239-12.885c.935-2.202 1.906-4.455 3.278-6.388c1.319-1.854 2.134-3.669 1.988-5.94c-.084-1.276-.016-2.562-.016-3.843l.707-.352c1.141.985 2.302 1.949 3.423 2.959c4.045 3.646 7.892 3.813 12.319.67c1.888-1.341 3.93-2.47 5.927-3.652c.497-.294 1.092-.423 1.934-.738c2.151 5.066 4.262 10.033 6.375 15c1.072 2.524 1.932 5.167 3.264 7.547c2.671 4.775 4.092 9.813 4.07 15.272c-.012 2.83.137 5.67-.081 8.482"
                  clipRule="evenodd"
               ></path>
            </IconWrapper>
         )}
         {type === 'intel' && (
            <IconWrapper size={size} viewBox="0 0 512 512">
               <path
                  fill={color}
                  d="M150.848 230.395v82.68H124.53V209.15l54.337.054c23.078 0 30.94 16.275 30.94 31.058v72.813h-26.271v-72.677c0-6.192-3.206-10.003-10.938-10.003zm157.583 20.934h40.491c.631-30.563-40.534-28.566-40.49 0m66.763 17.913h-66.763c-.796 24.687 30.53 31.48 47.435 13.462l16.256 15.521c-10.409 10.276-21.33 16.516-40.574 16.516c-25.194 0-49.306-13.738-49.306-53.776c0-34.21 21.052-53.576 48.714-53.576c30.121.56 46.618 23.957 44.238 61.853m-115.17 43.703c-21.44 0-30.538-14.926-30.538-29.668V180.835h26.278v28.315h19.81v21.245h-19.81v51.235c0 6.038 2.851 9.389 9.12 9.389h10.69v21.926zM101.112 194.788h-26.5v-25.172h26.5zm.067 119.38c-19.845-1.907-26.595-13.944-26.595-27.834l.029-77.184h26.566zm315.84-2.22c-19.803-1.911-26.521-13.929-26.521-27.8V166.034h26.522zm92.718-128.845C485.701 65.92 258.23 58.501 111.61 147.76v9.854c146.471-75.274 354.203-74.83 373.129 33.101c6.332 35.689-13.779 72.898-49.696 94.286v27.982c43.231-15.816 87.567-67.102 74.694-129.88M243.215 388.13c-101.191 9.354-206.64-5.334-221.394-84.406c-7.222-38.98 10.536-80.3 34.093-105.968v-13.725C13.506 221.22-9.51 268.298 3.74 323.927c16.911 71.333 107.412 111.758 245.546 98.333c54.653-5.334 126.186-22.907 175.917-50.202V333.28c-45.125 26.87-119.797 49.09-181.99 54.849"
               ></path>
            </IconWrapper>
         )}
         {type === 'amd' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={'currentColor'}
                  d="m18.324 9.137l1.559 1.56h2.556v2.557L24 14.814V9.137zM2 9.52l-2 4.96h1.309l.37-.982H3.9l.408.982h1.338L3.432 9.52zm4.209 0v4.955h1.238v-3.092l1.338 1.562h.188l1.338-1.556v3.091h1.238V9.52H10.47l-1.592 1.845L7.287 9.52zm6.283 0v4.96h2.057c1.979 0 2.88-1.046 2.88-2.472c0-1.36-.937-2.488-2.747-2.488zm1.237.91h.792c1.17 0 1.63.711 1.63 1.57c0 .728-.372 1.572-1.616 1.572h-.806zm-10.985.273l.791 1.932H2.008zm17.137.307l-1.604 1.603v2.25h2.246l1.604-1.607h-2.246z"
               ></path>
            </IconWrapper>
         )}
         {type === 'sendgrid' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path fill="#9dd6e3" d="M256 0v170.667h-85.333v85.33H.002v-85.331H0V85.332h85.333V0z" strokeWidth={6.5} stroke="#9dd6e3"></path>
               <path fill="#3f72ab" d="M.002 255.996h85.333v-85.333H.002z" strokeWidth={6.5} stroke="#3f72ab"></path>
               <path fill="#00a9d1" d="M170.667 170.667H256V85.331h-85.333zM85.333 85.333h85.334V0H85.333z" strokeWidth={6.5} stroke="#00a9d1"></path>
               <path fill="#2191c4" d="M85.333 170.665h85.334V85.331H85.333z" strokeWidth={6.5} stroke="#2191c4"></path>
               <path fill="#3f72ab" d="M170.667 85.333H256V0h-85.333z" strokeWidth={6.5} stroke="#3f72ab"></path>
            </IconWrapper>
         )}
         {type === 'brevo' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={'#149c74'}
                  d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12a12 12 0 0 0 12-12A12 12 0 0 0 12 0M7.2 4.8h5.747c2.34 0 3.895 1.406 3.895 3.516c0 1.022-.348 1.862-1.09 2.588C17.189 11.812 18 13.22 18 14.785c0 2.86-2.64 5.016-6.164 5.016H7.199v-15zm2.085 1.952v5.537h.07c.233-.432.858-.796 2.249-1.226c2.039-.659 3.037-1.52 3.037-2.655c0-.998-.766-1.656-1.924-1.656zm4.87 5.266c-.766.385-1.67.748-2.76 1.11c-1.229.387-2.11 1.386-2.11 2.407v2.315h2.365c2.387 0 4.149-1.34 4.149-3.155c0-1.067-.625-2.087-1.645-2.677z"
               ></path>
            </IconWrapper>
         )}
         {type === 'resend' && (
            <IconWrapper size={size} viewBox="0 0 24 24">
               <path
                  fill={'#222222'}
                  d="M9 7v10h2v-4h.8l1.2 4h2l-1.24-4.15C14.5 12.55 15 11.84 15 11V9a2 2 0 0 0-2-2zm2 2h2v2h-2zM5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2"
               ></path>
            </IconWrapper>
         )}
         {type === 'aws-ses' && (
            <IconWrapper size={size} viewBox="0 0 256 153">
               <path
                  fill="#252f3e"
                  d="M72.392 55.438c0 3.137.34 5.68.933 7.545a45.4 45.4 0 0 0 2.712 6.103c.424.678.593 1.356.593 1.95c0 .847-.508 1.695-1.61 2.543l-5.34 3.56c-.763.509-1.526.763-2.205.763c-.847 0-1.695-.424-2.543-1.187a26 26 0 0 1-3.051-3.984c-.848-1.44-1.696-3.052-2.628-5.001q-9.919 11.697-24.922 11.698c-7.12 0-12.8-2.035-16.954-6.103c-4.153-4.07-6.272-9.495-6.272-16.276c0-7.205 2.543-13.054 7.714-17.462c5.17-4.408 12.037-6.612 20.768-6.612c2.882 0 5.849.254 8.985.678c3.137.424 6.358 1.102 9.749 1.865V29.33c0-6.443-1.357-10.935-3.985-13.563c-2.712-2.628-7.29-3.9-13.817-3.9c-2.967 0-6.018.34-9.155 1.103s-6.188 1.695-9.155 2.882c-1.356.593-2.373.932-2.967 1.102s-1.017.254-1.356.254c-1.187 0-1.78-.848-1.78-2.628v-4.154c0-1.356.17-2.373.593-2.966c.424-.594 1.187-1.187 2.374-1.78q4.45-2.29 10.68-3.815C33.908.763 38.316.255 42.978.255c10.088 0 17.463 2.288 22.21 6.866c4.662 4.577 7.036 11.528 7.036 20.853v27.464zM37.976 68.323c2.798 0 5.68-.508 8.731-1.526c3.052-1.017 5.765-2.882 8.053-5.425c1.357-1.61 2.374-3.39 2.882-5.425c.509-2.034.848-4.493.848-7.375v-3.56a71 71 0 0 0-7.799-1.441a64 64 0 0 0-7.968-.509c-5.68 0-9.833 1.102-12.63 3.391s-4.154 5.51-4.154 9.748c0 3.984 1.017 6.951 3.136 8.986c2.035 2.119 5.002 3.136 8.901 3.136m68.069 9.155c-1.526 0-2.543-.254-3.221-.848c-.678-.508-1.272-1.695-1.78-3.305L81.124 7.799c-.51-1.696-.764-2.798-.764-3.391c0-1.356.678-2.12 2.035-2.12h8.307c1.61 0 2.713.255 3.306.848c.678.509 1.187 1.696 1.695 3.306l14.241 56.117l13.224-56.117c.424-1.695.933-2.797 1.61-3.306c.679-.508 1.866-.847 3.392-.847h6.781c1.61 0 2.713.254 3.39.847c.679.509 1.272 1.696 1.611 3.306l13.394 56.795L168.01 6.442c.508-1.695 1.102-2.797 1.695-3.306c.678-.508 1.78-.847 3.306-.847h7.883c1.357 0 2.12.678 2.12 2.119c0 .424-.085.848-.17 1.356s-.254 1.187-.593 2.12l-20.43 65.525q-.762 2.544-1.78 3.306c-.678.509-1.78.848-3.22.848h-7.29c-1.611 0-2.713-.254-3.392-.848c-.678-.593-1.271-1.695-1.61-3.39l-13.14-54.676l-13.054 54.59c-.423 1.696-.932 2.798-1.61 3.391c-.678.594-1.865.848-3.39.848zm108.927 2.289c-4.408 0-8.816-.509-13.054-1.526c-4.239-1.017-7.544-2.12-9.748-3.39c-1.357-.764-2.29-1.611-2.628-2.374a6 6 0 0 1-.509-2.374V65.78c0-1.78.678-2.628 1.95-2.628a4.8 4.8 0 0 1 1.526.255c.508.17 1.271.508 2.119.847a46 46 0 0 0 9.324 2.967a51 51 0 0 0 10.088 1.017c5.34 0 9.494-.932 12.376-2.797s4.408-4.577 4.408-8.053c0-2.373-.763-4.323-2.289-5.934s-4.408-3.051-8.561-4.408l-12.292-3.814c-6.188-1.95-10.765-4.832-13.563-8.647c-2.797-3.73-4.238-7.883-4.238-12.291q0-5.34 2.289-9.41c1.525-2.712 3.56-5.085 6.103-6.95c2.543-1.95 5.425-3.391 8.816-4.408c3.39-1.017 6.95-1.441 10.68-1.441c1.865 0 3.815.085 5.68.339c1.95.254 3.73.593 5.51.932c1.695.424 3.306.848 4.832 1.357q2.288.762 3.56 1.525c1.187.679 2.034 1.357 2.543 2.12q.763 1.017.763 2.797v3.984c0 1.78-.678 2.713-1.95 2.713c-.678 0-1.78-.34-3.22-1.018q-7.25-3.306-16.276-3.306c-4.832 0-8.647.763-11.275 2.374c-2.627 1.61-3.984 4.069-3.984 7.544c0 2.374.848 4.408 2.543 6.019s4.832 3.221 9.325 4.662l12.037 3.815c6.103 1.95 10.511 4.662 13.139 8.137s3.9 7.46 3.9 11.868c0 3.645-.764 6.951-2.205 9.833c-1.525 2.882-3.56 5.425-6.188 7.46c-2.628 2.119-5.764 3.645-9.409 4.747c-3.815 1.187-7.799 1.78-12.122 1.78"
                  strokeWidth={4}
                  stroke="#252f3e"
               ></path>
               <path
                  fill="#f90"
                  d="M230.993 120.964c-27.888 20.599-68.408 31.534-103.247 31.534c-48.827 0-92.821-18.056-126.05-48.064c-2.628-2.373-.255-5.594 2.881-3.73c35.942 20.854 80.276 33.484 126.136 33.484c30.94 0 64.932-6.442 96.212-19.666c4.662-2.12 8.646 3.052 4.068 6.442m11.614-13.224c-3.56-4.577-23.566-2.204-32.636-1.102c-2.713.34-3.137-2.034-.678-3.814c15.936-11.19 42.13-7.968 45.181-4.239c3.052 3.815-.848 30.008-15.767 42.554c-2.288 1.95-4.492.933-3.475-1.61c3.39-8.393 10.935-27.296 7.375-31.789"
                  strokeWidth={4}
                  stroke="#f90"
               ></path>
            </IconWrapper>
         )}
         {type === 'mailgun' && (
            <IconWrapper size={size} viewBox="0 0 256 261">
               <path
                  fill="#f06b66"
                  d="M126.143.048C197.685.048 256 58.363 256 130.025a42.083 42.083 0 0 1-63.967 35.71l-.6-.36l-.241.601c-18.108 32.825-57.803 47.059-92.643 33.22c-34.84-13.837-53.951-51.428-44.602-87.731c9.349-36.304 44.24-59.988 81.43-55.276s65.073 36.348 65.073 73.836a13.707 13.707 0 0 0 27.294 0c0-56.132-45.469-101.655-101.601-101.721c-47.083-.085-88.07 32.152-99.083 77.93c-11.012 45.776 10.83 93.128 52.8 114.466s93.098 11.085 123.596-24.784l21.643 18.276a129.5 129.5 0 0 1-98.956 45.93C55.864 257.986 0 200.397 0 130.086S55.864 2.185 126.143.048m0 83.926a46.171 46.171 0 1 0 .12 92.223c24.551-1.286 43.789-21.584 43.757-46.169s-19.323-44.832-43.877-46.054m0 27.414c10.293 0 18.637 8.344 18.637 18.637s-8.344 18.637-18.637 18.637s-18.637-8.344-18.637-18.637s8.344-18.637 18.637-18.637"
                  strokeWidth={6.5}
                  stroke="#f06b66"
               ></path>
            </IconWrapper>
         )}
         {type === 'slack' && (
            <IconWrapper size={size} viewBox="0 0 256 256">
               <path
                  fill="#e01e5a"
                  d="M53.841 161.32c0 14.832-11.987 26.82-26.819 26.82S.203 176.152.203 161.32c0-14.831 11.987-26.818 26.82-26.818H53.84zm13.41 0c0-14.831 11.987-26.818 26.819-26.818s26.819 11.987 26.819 26.819v67.047c0 14.832-11.987 26.82-26.82 26.82c-14.83 0-26.818-11.988-26.818-26.82z"
                  strokeWidth={6.5}
                  stroke="#e01e5a"
               ></path>
               <path
                  fill="#36c5f0"
                  d="M94.07 53.638c-14.832 0-26.82-11.987-26.82-26.819S79.239 0 94.07 0s26.819 11.987 26.819 26.819v26.82zm0 13.613c14.832 0 26.819 11.987 26.819 26.819s-11.987 26.819-26.82 26.819H26.82C11.987 120.889 0 108.902 0 94.069c0-14.83 11.987-26.818 26.819-26.818z"
                  strokeWidth={6.5}
                  stroke="#36c5f0"
               ></path>
               <path
                  fill="#2eb67d"
                  d="M201.55 94.07c0-14.832 11.987-26.82 26.818-26.82s26.82 11.988 26.82 26.82s-11.988 26.819-26.82 26.819H201.55zm-13.41 0c0 14.832-11.988 26.819-26.82 26.819c-14.831 0-26.818-11.987-26.818-26.82V26.82C134.502 11.987 146.489 0 161.32 0s26.819 11.987 26.819 26.819z"
                  strokeWidth={6.5}
                  stroke="#2eb67d"
               ></path>
               <path
                  fill="#ecb22e"
                  d="M161.32 201.55c14.832 0 26.82 11.987 26.82 26.818s-11.988 26.82-26.82 26.82c-14.831 0-26.818-11.988-26.818-26.82V201.55zm0-13.41c-14.831 0-26.818-11.988-26.818-26.82c0-14.831 11.987-26.818 26.819-26.818h67.25c14.832 0 26.82 11.987 26.82 26.819s-11.988 26.819-26.82 26.819z"
                  strokeWidth={6.5}
                  stroke="#ecb22e"
               ></path>
            </IconWrapper>
         )}
         {type === 'ntfy' && (
            <IconWrapper size={size} viewBox="0 0 12 12">
               <path
                  fill="#338574"
                  d="M11 1H1c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V2c0-.55-.45-1-1-1M9.5 9h-4c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h4c.28 0 .5.22.5.5s-.22.5-.5.5m-7 .12a.62.62 0 0 1-.44-.18a.63.63 0 0 1 0-.88L4.12 6L2.06 3.94a.63.63 0 0 1 0-.88c.24-.24.64-.24.88 0L5.09 5.2c.44.44.44 1.15 0 1.59L2.94 8.94a.62.62 0 0 1-.44.18"
               ></path>
            </IconWrapper>
         )}
      </span>
   );
};

const IconWrapper = ({ children, viewBox, size }: PropsWithChildren<IconWrapperProps>) => {
   return (
      <svg
         data-testid="icon"
         xmlns="http://www.w3.org/2000/svg"
         xmlnsXlink="http://www.w3.org/1999/xlink"
         width={size || 16}
         preserveAspectRatio="xMidYMid meet"
         viewBox={viewBox}
         aria-hidden="true"
         role="img"
      >
         {children}
      </svg>
   );
};

export default Icon;
