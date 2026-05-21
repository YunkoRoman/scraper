import type { Monaco } from '@monaco-editor/react';
export interface CompletionItemSpec {
    label: string;
    insertText: string;
    detail: string;
    documentation?: string;
}
export declare function buildPlaywrightCompletionItems(): CompletionItemSpec[];
export declare function buildTaskCompletionItems(): CompletionItemSpec[];
export declare function registerPlaywrightCompletions(monaco: Monaco): void;
//# sourceMappingURL=monacoPlaywrightCompletions.d.ts.map