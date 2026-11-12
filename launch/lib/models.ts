// Free models, each 3B-16B active parameters, picked on 2026-11-12: they pass
// the build and extend tests from a careful prompt with reasoning turned off.
// Free models that cannot turn reasoning off (Flint, ERNIE 5.5 Flash) spent
// their whole budget thinking in round 2 and never answered; Gemma 4 was
// rate-limited at its host all day.
//
// ponytail: free models. The OpenRouter account gets 50 free requests a day
// (a play makes 8) until it has bought $10 of credits, then 1,000. Free models
// also disappear faster than paid ones. When traffic outgrows that, switch to
// paid models (the previous list is in git history) and set a key credit limit.
export const MODELS = [
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning', maker: 'NVIDIA' },
  { id: 'cohere/north-mini-code:free', name: 'North Mini Code', maker: 'Cohere' },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots3-Note Preview', maker: 'Dots Studio' },
  { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL', maker: 'NVIDIA' },
] as const;
