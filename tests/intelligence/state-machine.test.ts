import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../../src/intelligence/state-machine.js';

describe('evaluateCondition', () => {
  const record = {
    total: 150,
    status: 'draft',
    items_count: 3,
    discount: 0,
    label: 'pending review',
    active: true,
    archived: false,
  };

  // ---------------------------------------------------------------------------
  // Empty / blank expressions
  // ---------------------------------------------------------------------------

  it('returns true for empty expression', () => {
    expect(evaluateCondition('', record)).toBe(true);
    expect(evaluateCondition('   ', record)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Numeric comparisons
  // ---------------------------------------------------------------------------

  it('evaluates > with numeric field', () => {
    expect(evaluateCondition('total > 0', record)).toBe(true);
    expect(evaluateCondition('total > 200', record)).toBe(false);
  });

  it('evaluates < with numeric field', () => {
    expect(evaluateCondition('discount < 10', record)).toBe(true);
    expect(evaluateCondition('total < 100', record)).toBe(false);
  });

  it('evaluates >= with numeric field', () => {
    expect(evaluateCondition('total >= 150', record)).toBe(true);
    expect(evaluateCondition('total >= 151', record)).toBe(false);
  });

  it('evaluates <= with numeric field', () => {
    expect(evaluateCondition('total <= 150', record)).toBe(true);
    expect(evaluateCondition('total <= 149', record)).toBe(false);
  });

  it('evaluates == with numeric field', () => {
    expect(evaluateCondition('items_count == 3', record)).toBe(true);
    expect(evaluateCondition('items_count == 0', record)).toBe(false);
  });

  it('evaluates != with numeric field', () => {
    expect(evaluateCondition('items_count != 0', record)).toBe(true);
    expect(evaluateCondition('items_count != 3', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // String comparisons
  // ---------------------------------------------------------------------------

  it("evaluates == with string literal ('draft')", () => {
    expect(evaluateCondition("status == 'draft'", record)).toBe(true);
    expect(evaluateCondition("status == 'submitted'", record)).toBe(false);
  });

  it('evaluates != with string literal', () => {
    expect(evaluateCondition("status != 'submitted'", record)).toBe(true);
    expect(evaluateCondition("status != 'draft'", record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Logical AND
  // ---------------------------------------------------------------------------

  it('evaluates AND conjunction (both true)', () => {
    expect(evaluateCondition("total > 0 AND status == 'draft'", record)).toBe(true);
  });

  it('evaluates AND conjunction (first false)', () => {
    expect(evaluateCondition("total > 200 AND status == 'draft'", record)).toBe(false);
  });

  it('evaluates AND conjunction (second false)', () => {
    expect(evaluateCondition("total > 0 AND status == 'submitted'", record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Logical OR
  // ---------------------------------------------------------------------------

  it('evaluates OR disjunction (both true)', () => {
    expect(evaluateCondition('total > 0 OR items_count > 0', record)).toBe(true);
  });

  it('evaluates OR disjunction (first false, second true)', () => {
    expect(evaluateCondition('total > 200 OR items_count > 0', record)).toBe(true);
  });

  it('evaluates OR disjunction (both false)', () => {
    expect(evaluateCondition('total > 200 OR items_count > 10', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Boolean literals
  // ---------------------------------------------------------------------------

  it('evaluates == true literal', () => {
    expect(evaluateCondition('active == true', record)).toBe(true);
    expect(evaluateCondition('archived == true', record)).toBe(false);
  });

  it('evaluates == false literal', () => {
    expect(evaluateCondition('archived == false', record)).toBe(true);
    expect(evaluateCondition('active == false', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Bare field reference (truthy check)
  // ---------------------------------------------------------------------------

  it('returns truthy for a non-zero numeric field reference', () => {
    expect(evaluateCondition('total', record)).toBe(true);
    expect(evaluateCondition('discount', record)).toBe(false);
  });

  it('returns false for unknown field reference', () => {
    expect(evaluateCondition('nonexistent_field', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('handles numeric zero boundary correctly', () => {
    expect(evaluateCondition('discount > 0', record)).toBe(false);
    expect(evaluateCondition('discount == 0', record)).toBe(true);
  });

  it('is case-insensitive for AND / OR keywords', () => {
    expect(evaluateCondition('total > 0 and items_count > 0', record)).toBe(true);
    expect(evaluateCondition('total > 200 or items_count > 0', record)).toBe(true);
  });
});
