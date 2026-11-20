/**
 * Conversations, drawn in the shared popup frame (popupFrame.ts): who speaks,
 * what they say, what just happened (dice rolls, items), and the choices. A
 * choice with a skill check first asks which character tries, showing each
 * one's bonus. Sends Commands only.
 */
import type { CommandBus } from '../engine/commands';
import { pictureUrl } from './localPictures';
import type { SpriteCss } from './hud';
import type { PopupChoice, PopupFrame } from './popupFrame';

export interface TalkView {
  speaker?: string;
  picture?: string; // local-only image id (localPictures.ts)
  sprite?: string; // sprite id for the portrait when there is no picture (monster encounters)
  text: string;
  results: string[]; // what the last choice did
  choices: { index: number; text: string; check?: { label: string; rollers: { id: string; name: string; bonus: number; note: string }[] } }[];
}

export class TalkDialog {
  private picking: number | null = null; // choice index waiting for "who tries?"
  private view: TalkView | null = null;

  constructor(
    private bus: CommandBus,
    private frame: PopupFrame,
    private spriteCss: (key: string) => SpriteCss | null,
  ) {}

  get open(): boolean {
    return this.view !== null;
  }

  show(view: TalkView): void {
    this.view = view;
    this.picking = null;
    this.render();
  }

  /** Back to whatever the frame showed before (a building's panel), or close it. */
  close(): void {
    this.view = null;
    this.frame.pop();
  }

  private render(): void {
    const v = this.view!;
    const choices: PopupChoice[] = [];
    let hint: string | undefined;
    if (this.picking !== null) {
      const c = v.choices.find((x) => x.index === this.picking)!;
      hint = `${c.check!.label} — who tries?`;
      for (const r of c.check!.rollers) {
        choices.push({
          label: `${r.name} (${r.bonus >= 0 ? '+' : '−'}${Math.abs(r.bonus)}${r.note ? `, ${r.note}` : ''})`,
          onClick: () => this.bus.dispatch({ type: 'talkChoice', index: c.index, characterId: r.id }),
        });
      }
      choices.push({
        label: '← Back',
        muted: true,
        onClick: () => {
          this.picking = null;
          this.render();
        },
      });
    } else if (v.choices.length) {
      for (const c of v.choices) {
        choices.push({
          label: `${c.text}${c.check ? ` [${c.check.label}]` : ''}`,
          onClick: () => {
            if (c.check) {
              this.picking = c.index;
              this.render();
            } else this.bus.dispatch({ type: 'talkChoice', index: c.index });
          },
        });
      }
    } else choices.push({ label: 'Farewell.', onClick: () => this.bus.dispatch({ type: 'talkClose' }) });
    this.frame.push({
      picture: pictureUrl(v.picture) ?? undefined,
      sprite: (v.sprite && this.spriteCss(v.sprite)) || undefined,
      scrollable: true,
      title: v.speaker ?? 'Conversation',
      notes: v.results,
      text: v.text,
      hint,
      choices,
      modal: true,
      onCancel: () => this.bus.dispatch({ type: 'talkClose' }), // Esc / ✕ ends the conversation the normal way
    });
  }
}
