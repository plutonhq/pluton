import { getIconNameForFile } from '../../../utils/getIconNameforFile';

interface FileIconProps {
   filename: string;
   customClass?: string;
   size?: 'sm' | 'md' | 'lg';
}

const FileIcon = ({ filename, size = 'md', customClass, ...props }: FileIconProps) => {
   const iconName = getIconNameForFile(filename);
   const cssClass = `pfi-icon pfi-${iconName}${customClass ? ` ${customClass}` : ''} ${size ? ` pfi-${size}` : ''}`;

   const actualExtension = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
   const title = `File: ${filename}${iconName !== 'file' ? ` (Type: ${iconName} / ${actualExtension})` : ''}`;
   // ^ Ensure 'file' matches your actual DEFAULT_ICON_NAME if it's different

   return <i className={cssClass} title={title} aria-label={title} {...props}></i>;
};

export default FileIcon;
