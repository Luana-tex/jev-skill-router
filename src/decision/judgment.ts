export interface Candidate {
  name: string;
  description: string;
}

export interface JudgmentCriteria {
  true: string;
  false: string;
}

export interface JudgmentBatch {
  task: string;
  candidates: readonly Candidate[];
  against?: Candidate;
  criteria: JudgmentCriteria;
}

export interface JudgmentProvider {
  judge(batch: JudgmentBatch): Promise<ReadonlyMap<string, number>>;
}

export const relevanceCriteria: JudgmentCriteria = {
  true: 'The described capability directly helps complete a concrete part of the task.',
  false: 'The capability addresses a different task or only shares incidental terminology.',
};

export const redundancyCriteria: JudgmentCriteria = {
  true: 'The reference skill already covers the candidate’s useful contribution to this task.',
  false: 'The candidate adds a distinct capability needed for this task.',
};
