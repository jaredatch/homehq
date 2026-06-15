import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDeployVersion } from '@/lib/version';

const tmpFile = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'homehq-version-'));
  const path = join(dir, 'deploy-version');
  writeFileSync(path, contents, 'utf-8');
  return path;
};

describe('getDeployVersion', () => {
  it('returns the trimmed token from the file', () => {
    expect(getDeployVersion(tmpFile('a1b2c3d\n'))).toBe('a1b2c3d');
    expect(getDeployVersion(tmpFile('manual-1718400000'))).toBe('manual-1718400000');
  });

  it('falls back to "dev" when the file is missing', () => {
    expect(getDeployVersion(join(tmpdir(), 'homehq-no-such-file-xyz'))).toBe('dev');
  });

  it('falls back to "dev" for an empty file (never an empty token)', () => {
    expect(getDeployVersion(tmpFile('   \n'))).toBe('dev');
  });
});
