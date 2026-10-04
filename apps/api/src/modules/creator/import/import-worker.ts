import type { ScriptParts } from '@game/script/parts';
import type { MainAiClient } from './import-ai.js';
import { generateImportDraft, ImportGenerationError } from './import-generate.js';
import type { AiAttribution } from '../../../infrastructure/ai/ai-audit.js';

interface ImportJobWriter {
  updateProgress(owner: string, project: string, job: string, progress: string): Promise<unknown>;
  finish(owner: string, project: string, job: string, parts: ScriptParts, report: Record<string, unknown>): Promise<unknown>;
  fail(owner: string, project: string, job: string, message: string): Promise<unknown>;
}

export function createImportWorker(store: ImportJobWriter, ai: MainAiClient) {
  return {
    async run(ownerId: string, projectId: string, jobId: string, _fileName: string, sourceText: string,
      draftVersion = '1.0.0', attribution?: AiAttribution) {
      try {
        await store.updateProgress(ownerId, projectId, jobId, 'generating');
        const result = await generateImportDraft(projectId, sourceText, ai, draftVersion, attribution);
        await store.finish(ownerId, projectId, jobId, result.parts,
          { inferences: result.inferences, issues: result.issues });
      } catch (error) {
        // Provider errors may contain request fragments or credentials. Never persist them verbatim.
        const message = error instanceof ImportGenerationError
          ? `结构校验失败：${error.issues.slice(0, 12).map(issue => `${issue.path} ${issue.message}`).join('；')}`
          : '导入生成或结构校验失败，请检查素材和模型配置后重试';
        await store.fail(ownerId, projectId, jobId, message);
      }
    },
  };
}
