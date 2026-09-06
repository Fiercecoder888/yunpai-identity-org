import { z } from 'zod';

export const llmTextOutputSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export type LlmTextOutput = z.infer<typeof llmTextOutputSchema>;
