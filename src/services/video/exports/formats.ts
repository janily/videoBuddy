import {z} from 'zod';
export const DurableExportFormatSchema=z.literal('poster');
export type DurableExportFormat=z.infer<typeof DurableExportFormatSchema>;
export const exportFiles={poster:{file:'poster.png',mime:'image/png',filename:'VideoBuddy-poster.png'}} as const;
