// The steps a Jev-first job reports on GET /api/add/jobs/{id}, in order, with the labels a parent
// reads. Dependency-free so lib/add.js can write a fresh job's step list without loading the pipeline.
export const JEVFIRST_STEPS = [
  { id: 'subtitles', label: 'Finding the subtitles' },
  { id: 'sources', label: 'Reading the plot and the cast' },
  { id: 'segment', label: 'Sonnet reads the film' },
  { id: 'split_check', label: 'Jev checks the cut' },
  { id: 'claims', label: 'Jev checks what Sonnet wrote' },
  { id: 'classify', label: 'Jev answers the concrete questions' },
  { id: 'sonnetq', label: 'Sonnet answers the rest' },
  { id: 'moments', label: 'Jev finds the exact moments' },
  { id: 'describe', label: 'Sonnet describes, Jev checks' },
  { id: 'check_describe', label: 'Jev checks the descriptions' },
  { id: 'ingest', label: 'Saving the scene guide' },
];

export const freshJevfirstSteps = () => JEVFIRST_STEPS.map((s) => ({ ...s, status: 'pending', started_ms: null, ended_ms: null, detail: null }));
