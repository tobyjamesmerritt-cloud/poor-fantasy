import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canTransition } from '../src/engine/modes';
import { makeSave, parseSave } from '../src/engine/save';
import { newGameState } from '../src/engine/state';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('architecture rules', () => {
  it('engine/ and rules/ never import Phaser or the DOM layer', () => {
    for (const f of [...files('src/engine'), ...files('src/rules')]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"]phaser['"]/);
      expect(src, f).not.toMatch(/from ['"]\.\.\/(game|ui)\//);
      expect(src, f).not.toMatch(/\bdocument\.|\bwindow\./);
    }
  });

  it('mode transitions follow the table', () => {
    expect(canTransition('explore', 'encounter')).toBe(true);
    expect(canTransition('combat', 'explore')).toBe(false); // must go through postCombat
  });

  it('game state round-trips through save/load', () => {
    const s = { ...newGameState(5), flags: { metMayor: true, gold: 12 } };
    expect(parseSave(JSON.stringify(makeSave(s, 7, 't', 'label'))).state).toEqual(s);
    expect(() => parseSave('{"version":999}')).toThrow();
  });
});
