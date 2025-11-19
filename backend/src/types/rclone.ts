export type RcloneLsJsonOutput = {
	Path: string;
	Name: string;
	Size: number;
	MimeType: string;
	ModTime: string;
	IsDir: boolean;
	changeType?: string;
};
