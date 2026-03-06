import type { SkillPack } from '../../types/agent.js';
import { securityAuditSkillPack } from './security-audit.js';
import { codeReviewSkillPack } from './code-review.js';
import { testWriterSkillPack } from './test-writer.js';
import { dataAnalysisSkillPack } from './data-analysis.js';
import { documentationSkillPack } from './documentation.js';
import { diagramMakerSkillPack } from './diagram-maker.js';
import { chartGeneratorSkillPack } from './chart-generator.js';
import { webDesignerSkillPack } from './web-designer.js';
import { slideDesignerSkillPack } from './slide-designer.js';

/**
 * All built-in skill packs shipped with OpenBridge.
 * Loaded on Master AI startup and injected into the system prompt summary.
 */
export const BUILT_IN_SKILL_PACKS: SkillPack[] = [
  securityAuditSkillPack,
  codeReviewSkillPack,
  testWriterSkillPack,
  dataAnalysisSkillPack,
  documentationSkillPack,
  diagramMakerSkillPack,
  chartGeneratorSkillPack,
  webDesignerSkillPack,
  slideDesignerSkillPack,
];
