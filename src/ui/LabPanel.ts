import type { LabScene, LabParams } from '../scenes/LabScene';
import type { Bus } from '../core/Bus';
import type { AppEvents } from '../core/Ctx';

const fmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

const timeName = (t: number) => (t < 0.17 ? 'AMANECER' : t < 0.5 ? 'MEDIODÍA' : t < 0.83 ? 'ATARDECER' : 'NOCHE');

/** Binds the laboratory's DOM controls to the parametric tower. */
export function bindLab(scene: LabScene, bus: Bus<AppEvents>) {
  const root = document.getElementById('lab');
  if (!root) return;
  const ranges = [...root.querySelectorAll<HTMLInputElement>('input[type=range]')];

  const label = (input: HTMLInputElement) => {
    const out = root.querySelector<HTMLElement>(`output[for="${input.id}"]`);
    if (!out) return;
    const v = parseFloat(input.value);
    const name = input.name as keyof LabParams;
    out.textContent =
      name === 'twist' ? `${Math.round(v)}°` :
      name === 'time' ? timeName(v) :
      name === 'floors' ? `${Math.round(v)}` :
      v.toFixed(2);
    input.style.setProperty('--fill', `${((v - +input.min) / (+input.max - +input.min)) * 100}%`);
  };

  const sync = (p: LabParams) => {
    ranges.forEach((r) => {
      const v = p[r.name as keyof LabParams];
      if (typeof v === 'number') r.value = String(v);
      label(r);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-sides]').forEach((b) => b.classList.toggle('is-on', +b.dataset.sides! === p.sides));
  };

  ranges.forEach((r) => {
    r.addEventListener('input', () => {
      scene.set({ [r.name]: parseFloat(r.value) } as Partial<LabParams>);
      label(r);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-sides]').forEach((b) =>
    b.addEventListener('click', () => {
      scene.set({ sides: +b.dataset.sides! });
      sync(scene.target);
    }),
  );

  root.querySelectorAll<HTMLButtonElement>('[data-mat]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = +b.dataset.mat!;
      scene.setMaterial(i);
      root.querySelectorAll('[data-mat]').forEach((x) => x.classList.toggle('is-on', x === b));
      document.body.classList.toggle('lab-blueprint', i === 3);
    }),
  );

  root.querySelector('#mutate')?.addEventListener('click', () => sync(scene.mutate()));
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && scene.active && !(e.target instanceof HTMLInputElement)) sync(scene.mutate());
  });

  const stats = {
    height: document.getElementById('st-height'),
    floors: document.getElementById('st-floors'),
    area: document.getElementById('st-area'),
    twist: document.getElementById('st-twist'),
  };
  bus.on('labStats', (s) => {
    if (stats.height) stats.height.textContent = `${fmt.format(s.height)} m`;
    if (stats.floors) stats.floors.textContent = fmt.format(s.floors);
    if (stats.area) stats.area.textContent = `${fmt.format(s.area)} m²`;
    if (stats.twist) stats.twist.textContent = `${Math.round(s.twist)}°`;
  });

  sync(scene.target);
}
