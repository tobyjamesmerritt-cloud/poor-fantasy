import { describe, expect, it } from 'vitest';
import { flagGroups, knownFlags, setQuestStage, toggleFlag } from '../src/rules/debugFlags';
import type { QuestData } from '../src/rules/quests';

const data = {
  quests: { troll: { name: 'The Troll', summary: '', level: '1', difficulty: 'easy', stages: { met: 'm', done: 'd' } } },
  dialogs: { a: { nodes: { x: { text: '', do: [{ set: 'troll:moved' }, { set: 'shack:searched' }], choices: [{ text: '', when: { flag: 'troll:gift' } }] } } } },
  hooks: [],
  sites: {},
  triggers: [],
} as unknown as QuestData;

describe('debug flag editor', () => {
  it('finds flags in content', () => {
    expect(knownFlags(data).sort()).toEqual(['shack:searched', 'troll:gift', 'troll:moved']);
  });
  it('groups flags under their quest and shows the stage', () => {
    const g = flagGroups(data, { 'quest:troll': 'met', 'troll:moved': true, 'found:bridge': true });
    expect(g[0].quest).toEqual({ id: 'troll', stage: 'met', stages: ['none', 'met', 'done'] });
    expect(g[0].flags.map((f) => [f.label, f.on])).toEqual([['gift', false], ['moved', true]]);
    expect(g.map((x) => x.id)).toEqual(['troll', 'found', 'shack']);
  });
  it('toggles flags and sets quest stages', () => {
    const f: Record<string, unknown> = {};
    expect(toggleFlag(f, 'a:b')).toBe(true);
    expect(toggleFlag(f, 'a:b')).toBe(false);
    setQuestStage(f, 'troll', 'done');
    expect(f['quest:troll']).toBe('done');
    setQuestStage(f, 'troll', 'none');
    expect('quest:troll' in f).toBe(false);
  });
});
