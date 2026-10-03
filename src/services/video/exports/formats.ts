import {z} from 'zod';
export const DurableExportFormatSchema=z.enum(['poster','source_zip','srt','treatment','credits','quality']);
export type DurableExportFormat=z.infer<typeof DurableExportFormatSchema>;
export const exportFiles={
 poster:{file:'poster.png',mime:'image/png',filename:'VideoBuddy-poster.png'},
 source_zip:{file:'source.zip',mime:'application/zip',filename:'VideoBuddy-source.zip'},
 srt:{file:'captions.srt',mime:'text/plain',filename:'VideoBuddy-captions.srt'},
 treatment:{file:'treatment.txt',mime:'text/plain',filename:'VideoBuddy-treatment.txt'},
 credits:{file:'credits.json',mime:'application/json',filename:'VideoBuddy-CREDITS.json'},
 quality:{file:'quality.json',mime:'application/json',filename:'VideoBuddy-quality.json'},
} as const;
