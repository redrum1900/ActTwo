import type { GameScript } from '@game/contracts';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export interface ReviewSubmission {
  id: string;
  projectId: string;
  projectTitle: string;
  authorId: string;
  authorUsername: string;
  script: GameScript;
  contentHash: string;
  version: string;
  status: ReviewStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerId: string | null;
  rejectionReason: string | null;
}
export type ReviewSummary = Omit<ReviewSubmission, 'script'>;
