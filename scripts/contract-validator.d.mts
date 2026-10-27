export interface RootReport {
  rootDir: string;
  fileCount: number;
  fileErrors: { file: string; errors: string[] }[];
  queueLines: number;
  queueErrors: string[];
  missingFiles: string[];
}

export declare function parseFrontMatter(content: string): { meta: Record<string, string>; body: string; error?: string };
export declare function validateClipContent(content: string): string[];
export declare function validateQueueLine(line: string, index: number): string[];
export declare function validateRoot(rootDir: string): RootReport;
export declare function formatReport(report: RootReport): string;
