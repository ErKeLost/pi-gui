import { createContext, useContext } from "react";

export type PromptOptions = { title: string; initial?: string; multiline?: boolean };
export const PromptContext = createContext<(options: PromptOptions) => Promise<string | null>>(() => Promise.resolve(null));
export function usePrompt() { return useContext(PromptContext); }
