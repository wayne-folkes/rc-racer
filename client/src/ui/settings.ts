import type { Sound } from '../game/audio';
import { clearAllRecords } from '../game/records';
import { clearSeason } from '../game/seasonStorage';
import { TRACKS } from '../game/tracks';
import { byId, type MenuCard } from './card';

// Sound on or off, the volume, and resetting all progress. Opened from the title screen and from
// the pause menu; the game decides which, and whether Reset is offered.

export interface SettingsActions {
  back(): void;
  /** Sound was switched on or off, so the HUD's mute button can follow. */
  soundChanged(): void;
  /** Progress was wiped, so the season in memory starts over too. */
  progressReset(): void;
}

/** Shortest gap between the volume previews while dragging the slider (ms). */
const PREVIEW_GAP_MS = 150;

export class SettingsCard implements MenuCard {
  readonly root = byId('settings');
  /** Reset is only offered from the title screen: quitting a race would otherwise save the wiped season. */
  allowReset = true;
  private readonly main = byId('settings-main');
  private readonly confirmBox = byId('settings-confirm');
  private readonly soundButton = byId<HTMLButtonElement>('settings-sound');
  private readonly volume = byId<HTMLInputElement>('settings-volume');
  private readonly volumeValue = byId('settings-volume-value');
  private readonly resetButton = byId<HTMLButtonElement>('settings-reset');
  private readonly back = byId<HTMLButtonElement>('settings-back');
  private readonly cancelButton = byId<HTMLButtonElement>('settings-reset-no');
  private previewTimer = 0;
  private lastPreview = -Infinity;

  constructor(
    private readonly sound: Sound,
    private readonly actions: SettingsActions,
  ) {
    this.soundButton.addEventListener('click', () => {
      this.sound.setMuted(!this.sound.muted);
      this.refresh();
      actions.soundChanged();
    });
    this.volume.addEventListener('input', () => this.changeVolume());
    this.resetButton.addEventListener('click', () => this.askReset(true));
    byId('settings-reset-yes').addEventListener('click', () => this.reset());
    this.cancelButton.addEventListener('click', () => this.askReset(false));
    this.back.addEventListener('click', () => actions.back());
  }

  refresh(): void {
    this.soundButton.textContent = this.sound.muted ? 'Sound: Off' : 'Sound: On';
    this.soundButton.setAttribute('aria-pressed', String(!this.sound.muted));
    this.volume.value = String(Math.round(this.sound.volume * 100));
    this.volumeValue.textContent = `${this.volume.value}%`;
    this.resetButton.hidden = !this.allowReset;
    this.askReset(false);
  }

  primary(): HTMLButtonElement {
    return this.confirmBox.hidden ? this.back : this.cancelButton;
  }

  dismiss(): boolean {
    if (this.confirmBox.hidden) return false;
    this.askReset(false);
    return true;
  }

  private changeVolume(): void {
    this.sound.setVolume(Number(this.volume.value) / 100);
    this.volumeValue.textContent = `${this.volume.value}%`;
    // A short sound at the new level, so the player can hear it. While dragging, one per gap at most,
    // with a trailing one so the final level is always heard.
    window.clearTimeout(this.previewTimer);
    const wait = PREVIEW_GAP_MS - (performance.now() - this.lastPreview);
    if (wait <= 0) this.preview();
    else this.previewTimer = window.setTimeout(() => this.preview(), wait);
  }

  private preview(): void {
    this.lastPreview = performance.now();
    this.sound.play('pickup');
  }

  private askReset(on: boolean): void {
    this.main.hidden = on;
    this.confirmBox.hidden = !on;
  }

  /** Wipes the saved season and every track's records. Sound and volume are kept. */
  private reset(): void {
    clearSeason();
    clearAllRecords(TRACKS.map((def) => def.id));
    this.askReset(false);
    this.actions.progressReset();
  }
}
