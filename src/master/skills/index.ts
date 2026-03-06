import type { Skill } from '../../types/agent.js';
import { codeReviewSkill } from './code-review.js';
import { testRunnerSkill } from './test-runner.js';
import { dependencyAuditSkill } from './dependency-audit.js';
import { apiDocsGeneratorSkill } from './api-docs-generator.js';

/**
 * All built-in skills shipped with OpenBridge.
 * Loaded on Master AI startup and injected into the system prompt.
 */
export const BUILT_IN_SKILLS: Skill[] = [
  codeReviewSkill,
  testRunnerSkill,
  dependencyAuditSkill,
  apiDocsGeneratorSkill,
];
