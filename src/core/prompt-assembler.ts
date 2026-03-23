import { createLogger } from './logger.js';

const logger = createLogger('prompt-assembler');

/** Priority constants for PromptAssembler sections (higher = kept first). */
export const PRIORITY_IDENTITY = 100; // role / rules
export const PRIORITY_WORKSPACE = 80; // workspace map
export const PRIORITY_MEMORY = 70; // memory.md
export const PRIORITY_RAG = 60; // RAG context
export const PRIORITY_HISTORY = 50; // conversation history
export const PRIORITY_LEARNINGS = 40; // learnings
export const PRIORITY_WORKER_NEXT = 30; // worker next steps
export const PRIORITY_ANALYSIS = 20; // analysis context

interface PromptSection {
  name: string;
  content: string;
  priority: number;
  maxChars?: number;
}

/**
 * Budget-aware prompt assembler that prioritizes sections by importance.
 *
 * Higher-priority sections are kept first; lower-priority sections are
 * truncated or dropped when the total budget is exceeded.
 */
export class PromptAssembler {
  private sections: PromptSection[] = [];

  /**
   * Add a named section to the prompt.
   * @param name - Human-readable section name (for logging)
   * @param content - The text content of this section
   * @param priority - Higher values = higher priority (kept first)
   * @param maxChars - Optional per-section cap (content truncated to this before budget check)
   */
  addSection(name: string, content: string, priority: number, maxChars?: number): void {
    if (!content || content.trim().length === 0) return;
    this.sections.push({ name, content, priority, maxChars });
  }

  /**
   * Assemble all sections into a single string within the given budget.
   *
   * Sections are sorted by priority (highest first). Each section is
   * included in full if it fits, truncated if partially fits, or dropped
   * if no budget remains. Warnings are logged for truncated/dropped sections.
   */
  assemble(totalBudget: number): string {
    if (this.sections.length === 0) return '';

    // Sort by priority descending (highest priority first)
    const sorted = [...this.sections].sort((a, b) => b.priority - a.priority);

    const included: string[] = [];
    let remaining = totalBudget;
    const dropped: string[] = [];
    const truncated: string[] = [];

    for (const section of sorted) {
      // Apply per-section cap first
      let content = section.content;
      if (section.maxChars && content.length > section.maxChars) {
        content = content.slice(0, section.maxChars);
        truncated.push(`${section.name} (capped: ${section.content.length} → ${section.maxChars})`);
      }

      if (remaining <= 0) {
        dropped.push(`${section.name} (${content.length} chars)`);
        continue;
      }

      if (content.length <= remaining) {
        // Fits entirely
        included.push(content);
        remaining -= content.length;
      } else {
        // Partial fit — truncate to remaining budget
        included.push(content.slice(0, remaining));
        truncated.push(`${section.name} (budget: ${content.length} → ${remaining})`);
        remaining = 0;
      }
    }

    if (truncated.length > 0) {
      logger.warn({ truncated }, 'Prompt sections truncated');
    }
    if (dropped.length > 0) {
      logger.warn({ dropped }, 'Prompt sections dropped — budget exceeded');
    }

    const result = included.join('\n\n');
    logger.debug(
      {
        assembledChars: result.length,
        totalBudget,
        sectionsIncluded: included.length,
        sectionsTruncated: truncated.length,
        sectionsDropped: dropped.length,
      },
      'Prompt assembled',
    );
    return result;
  }

  /** Reset all sections (for reuse). */
  clear(): void {
    this.sections = [];
  }

  /** Returns the number of sections currently added. */
  get sectionCount(): number {
    return this.sections.length;
  }
}
