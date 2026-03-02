#!/usr/bin/env node
// Patch a task status in TASKS.md: changes first ◻ Pending for a given task ID to ✅ Done
// Usage: node scripts/patch-task-status.mjs <TASK_ID> <TASKS_FILE>
import { readFileSync, writeFileSync } from 'fs';

const [taskId, tasksFile] = process.argv.slice(2);
if (!taskId || !tasksFile) {
  console.error('Usage: node patch-task-status.mjs <TASK_ID> <TASKS_FILE>');
  process.exit(1);
}

const content = readFileSync(tasksFile, 'utf8');
const lines = content.split('\n');
let patched = false;

const updated = lines.map((line) => {
  if (!patched && line.includes(taskId) && line.includes('◻ Pending')) {
    patched = true;
    return line.replace('◻ Pending', '✅ Done  ');
  }
  return line;
});

if (!patched) {
  console.error(`Task ${taskId} with ◻ Pending status not found`);
  process.exit(1);
}

writeFileSync(tasksFile, updated.join('\n'), 'utf8');
console.log(`Patched ${taskId}: ◻ Pending → ✅ Done`);
