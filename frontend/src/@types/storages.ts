import { PlanChildItem } from './plans';

export interface Storage {
   id: string;
   name: string;
   type: string;
   defaultPath: string;
   storageTypeName: string;
   storageFields: storageOptionField[];
   plans?: PlanChildItem[];
   usedSize?: number;
   authType?: string;
   tags: string[];
   settings: Record<string, string | boolean | number>;
   credentials: Record<string, string | boolean | number>;
   createdAt: string;
}

export type storageOptionField = {
   label: string;
   value: string;
   fieldType: string;
   required: boolean;
   default: string;
   description: string;
   authFieldType?: string;
   allowCustom?: true;
   options?: { label: string; value: string; showInput?: true }[];
   condition?: Record<string, number | boolean | string>[];
};
