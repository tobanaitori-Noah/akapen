import fs from 'node:fs';
import path from 'node:path';

export interface InstallSkillOptions {
  cwd: string;
  sourceDir: string;
  force?: boolean;
}

export interface InstallSkillResult {
  status: 'installed' | 'exists' | 'missing-source';
  targetDir: string;
  message: string;
}

export function installSkill(options: InstallSkillOptions): InstallSkillResult {
  const targetDir = path.join(options.cwd, '.claude', 'skills', 'akapen');
  if (!fs.existsSync(path.join(options.sourceDir, 'SKILL.md'))) {
    return {
      status: 'missing-source',
      targetDir,
      message: `同梱 skill が見つかりません: ${options.sourceDir}`,
    };
  }
  if (fs.existsSync(targetDir) && !options.force) {
    return {
      status: 'exists',
      targetDir,
      message: `すでに存在します: ${targetDir}（上書きするには --force を付けてください）`,
    };
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(options.sourceDir, targetDir, { recursive: true, force: true });
  return {
    status: 'installed',
    targetDir,
    message: `Claude Code 用 skill を導入しました: ${targetDir}`,
  };
}
