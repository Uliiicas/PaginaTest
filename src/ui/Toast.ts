/** Typewriter status line at the bottom of the screen. */
export class Toast {
  private el = document.getElementById('toast')!;
  private timer = 0;
  private typing = 0;

  show(msg: string, ms = 3800) {
    clearTimeout(this.timer);
    clearInterval(this.typing);
    this.el.textContent = '';
    this.el.classList.add('is-on');
    let i = 0;
    this.typing = window.setInterval(() => {
      i++;
      this.el.textContent = msg.slice(0, i) + (i < msg.length ? '▌' : '');
      if (i >= msg.length) clearInterval(this.typing);
    }, 18);
    this.timer = window.setTimeout(() => this.el.classList.remove('is-on'), ms);
  }
}
