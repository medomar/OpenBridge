import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAllSkillPacks } from '../master/skill-pack-loader.js';

function getWorkspacePath(): string {
  const configPath = resolve('config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}. Run this command from your OpenBridge directory.`,
    );
  }
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as { workspacePath?: string };
  if (!config.workspacePath) {
    throw new Error('workspacePath not found in config.json');
  }
  return config.workspacePath;
}

export async function runSkillPacks(): Promise<void> {
  const workspacePath = getWorkspacePath();
  const { packs, userDefinedCount } = await loadAllSkillPacks(workspacePath);

  if (packs.length === 0) {
    console.log('No skill packs available.');
    return;
  }

  const builtIn = packs.filter((p) => !p.isUserDefined);
  const userDefined = packs.filter((p) => p.isUserDefined);

  console.log('Available Skill Packs');
  console.log('');

  if (builtIn.length > 0) {
    console.log('Built-in:');
    for (const pack of builtIn) {
      console.log(`  ${pack.name} [${pack.toolProfile}]`);
      console.log(`    ${pack.description}`);
    }
  }

  if (userDefined.length > 0) {
    if (builtIn.length > 0) console.log('');
    console.log('Workspace (custom):');
    for (const pack of userDefined) {
      console.log(`  ${pack.name} [${pack.toolProfile}]`);
      console.log(`    ${pack.description}`);
    }
  }

  console.log('');
  console.log(
    `Total: ${packs.length} pack${packs.length !== 1 ? 's' : ''} (${builtIn.length} built-in, ${userDefinedCount} custom)`,
  );
}
