// Small models from four different labs, all listed on OpenRouter on 2026-11-12.
// OpenRouter retires models without notice (three of the four in the original
// design were gone within three months), so check this list when a run errors.
export const MODELS = [
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', maker: 'Meta' },
  { id: 'mistralai/ministral-8b-2512', name: 'Ministral 8B', maker: 'Mistral' },
  { id: 'google/gemma-3-12b-it', name: 'Gemma 3 12B', maker: 'Google' },
  { id: 'microsoft/phi-4', name: 'Phi-4', maker: 'Microsoft' },
] as const;
