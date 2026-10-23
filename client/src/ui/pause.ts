import { byId, type MenuCard } from './card';

// The pause menu, shown over a race that's been frozen. Resume is the main button, so Enter or A
// picks it when nothing else has focus.

export interface PauseActions {
  resume(): void;
  restart(): void;
  settings(): void;
  quit(): void;
}

export class PauseCard implements MenuCard {
  readonly root = byId('pause');
  private readonly resumeButton = byId<HTMLButtonElement>('pause-resume');
  private readonly restartButton = byId<HTMLButtonElement>('pause-restart');

  constructor(
    private readonly canRestart: () => boolean,
    actions: PauseActions,
  ) {
    this.resumeButton.addEventListener('click', () => actions.resume());
    this.restartButton.addEventListener('click', () => actions.restart());
    byId('pause-settings').addEventListener('click', () => actions.settings());
    byId('pause-quit').addEventListener('click', () => actions.quit());
  }

  refresh(): void {
    this.restartButton.hidden = !this.canRestart();
  }

  primary(): HTMLButtonElement {
    return this.resumeButton;
  }
}
