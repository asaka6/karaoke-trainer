// フリー：いまの音程を表示するだけ
import { PitchGraph } from '../ui/graph';
import { Readout } from '../ui/readout';
import { h, type Mode } from './mode';

export function createFreeMode(): Mode {
  const el = h('section', { class: 'mode' }, `
    <div class="readout-slot"></div>
    <canvas class="graph"></canvas>
    <p class="hint">声を出すと音名とズレ（セント）が表示されます。±15セント以内なら緑になります。</p>`);
  const readout = new Readout(el.querySelector('.readout-slot')!);
  const graph = new PitchGraph(el.querySelector('canvas')!);
  return {
    id: 'free',
    title: 'フリー',
    el,
    onPitch(p) {
      readout.update(p.midi, p.t);
      graph.push(p);
    },
    frame(now) {
      graph.render(now);
    },
  };
}
