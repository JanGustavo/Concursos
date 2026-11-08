// Motor independente de framework: React só fornece os passos e o adaptador de armazenamento.
export type TourStep = { selector: string; title: string; description: string };
export type TourStorage = { get: () => boolean | Promise<boolean>; set: (seen: boolean) => void | Promise<void> };
export type TourEvents = {
  onStart?: () => void;
  onStepChange?: (step: TourStep, index: number) => void;
  onComplete?: () => void;
  onSkip?: () => void;
};
export type TourOptions = TourEvents & { steps: TourStep[]; storage?: TourStorage };

export function placeTourPopover(
  target: DOMRect,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const gap = 12;
  const below = target.bottom + gap;
  const above = target.top - height - gap;
  const top =
    below + height <= viewportHeight - gap
      ? below
      : above >= gap
        ? above
        : Math.max(gap, Math.min(below, viewportHeight - height - gap));
  const left = Math.max(gap, Math.min(target.left + (target.width - width) / 2, viewportWidth - width - gap));
  return { top, left };
}

export class GuidedTour {
  private readonly options: TourOptions;
  private index = 0;
  private overlay: HTMLDivElement | null = null;
  private popover: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private previousFocus: HTMLElement | null = null;
  private frame = 0;
  private generation = 0;
  private active = false;

  constructor(options: TourOptions) {
    this.options = options;
  }

  async start({ force = false }: { force?: boolean } = {}): Promise<boolean> {
    const generation = ++this.generation;
    if (this.active || !this.options.steps.length) return false;
    try {
      if (!force && (await this.options.storage?.get())) return false;
    } catch {
      /* Tour continua acessível se o armazenamento falhar. */
    }
    if (this.generation !== generation || this.active) return false;
    this.active = true;
    this.index = 0;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'kb-tour-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    document.body.append(this.overlay);
    window.addEventListener('resize', this.schedulePosition);
    window.addEventListener('scroll', this.schedulePosition, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.options.onStart?.();
    this.showStep();
    return true;
  }

  private schedulePosition = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.target?.isConnected) {
        this.showStep(this.index + 1);
        return;
      }
      if (!this.popover) return;
      const rect = this.target.getBoundingClientRect();
      const pop = this.popover.getBoundingClientRect();
      const { top, left } = placeTourPopover(rect, pop.width, pop.height, window.innerWidth, window.innerHeight);
      this.popover.style.top = `${top}px`;
      this.popover.style.left = `${left}px`;
    });
  };

  private showStep(start = this.index) {
    this.target?.classList.remove('kb-tour-target');
    this.target = null;
    this.popover?.remove();
    this.popover = null;
    if (!this.active) return;
    let index = start;
    let target: HTMLElement | null = null;
    while (index < this.options.steps.length) {
      const found = document.querySelector<HTMLElement>(this.options.steps[index].selector);
      if (found && found.getClientRects().length && getComputedStyle(found).visibility !== 'hidden') {
        target = found;
        break;
      }
      index++;
    }
    if (!target) {
      void this.finish('complete');
      return;
    }
    this.index = index;
    this.target = target;
    target.classList.add('kb-tour-target');
    const step = this.options.steps[index];
    const popover = document.createElement('section');
    popover.className = 'kb-tour-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-label', `Tutorial: ${step.title}`);
    const progress = document.createElement('span');
    progress.className = 'kb-tour-progress';
    progress.textContent = `PASSO ${index + 1} DE ${this.options.steps.length}`;
    const heading = document.createElement('h2');
    heading.textContent = step.title;
    const description = document.createElement('p');
    description.textContent = step.description;
    const actions = document.createElement('div');
    actions.className = 'kb-tour-actions';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Pular';
    skip.addEventListener('click', () => void this.finish('skip'));
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = index === this.options.steps.length - 1 ? 'Concluir' : 'Próximo';
    next.addEventListener('click', () => this.showStep(this.index + 1));
    actions.append(skip, next);
    popover.append(progress, heading, description, actions);
    document.body.append(popover);
    this.popover = popover;
    this.options.onStepChange?.(step, index);
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    this.schedulePosition();
    next.focus();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void this.finish('skip');
      return;
    }
    if (event.key !== 'Tab' || !this.popover) return;
    const buttons = Array.from(this.popover.querySelectorAll('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private async finish(kind: 'complete' | 'skip') {
    if (!this.active) return;
    this.destroy();
    try {
      await this.options.storage?.set(true);
    } catch {
      /* O fluxo permanece utilizável. */
    }
    if (kind === 'skip') this.options.onSkip?.();
    else this.options.onComplete?.();
  }

  destroy() {
    ++this.generation;
    this.active = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.schedulePosition);
    window.removeEventListener('scroll', this.schedulePosition, true);
    this.target?.classList.remove('kb-tour-target');
    this.popover?.remove();
    this.overlay?.remove();
    this.target = null;
    this.popover = null;
    this.overlay = null;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  }
}
