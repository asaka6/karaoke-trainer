// フリー：いまの音程を表示するだけ
import { icons } from '../ui/icons';
import { PitchGraph } from '../ui/graph';
import { Readout } from '../ui/readout';
import { h, stageHtml, type Mode } from './mode';

export function createFreeMode(): Mode {
  const el = h('section', { class: 'mode' }, `
    <div class="mode-head"><h2>フリー</h2><p>声を出すと音名とズレが出ます。±15¢以内で緑。</p></div>
    <div class="readout-slot"></div>
    ${stageHtml()}`);
  const readout = new Readout(el.querySelector('.readout-slot')!);
  const graph = new PitchGraph(el.querySelector('canvas')!);
  return {
    id: 'free',
    title: 'フリー',
    icon: icons.wave,
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
