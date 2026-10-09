import type { DisplayElement } from '@shared/model';
import { useStore } from '../../store';

/** Propiedades comunes cuando hay varios elementos seleccionados (alinear, distribuir, mover). */

export function MultiProps({ els }: { els: DisplayElement[] }) {
  const patchPage = useStore((s) => s.patchPage);
  const ids = els.map((e) => e.id);
  const align = (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') =>
    patchPage((pg) => {
      const sel = pg.elements.filter((e) => ids.includes(e.id) && !e.locked);
      const x0 = Math.min(...sel.map((e) => e.x));
      const x1 = Math.max(...sel.map((e) => e.x + e.width));
      const y0 = Math.min(...sel.map((e) => e.y));
      const y1 = Math.max(...sel.map((e) => e.y + e.height));
      for (const e of sel) {
        if (mode === 'left') e.x = x0;
        if (mode === 'right') e.x = x1 - e.width;
        if (mode === 'hcenter') e.x = Math.round((x0 + x1) / 2 - e.width / 2);
        if (mode === 'top') e.y = y0;
        if (mode === 'bottom') e.y = y1 - e.height;
        if (mode === 'vcenter') e.y = Math.round((y0 + y1) / 2 - e.height / 2);
      }
    });
  const distribute = (axis: 'x' | 'y') =>
    patchPage((pg) => {
      const sel = pg.elements.filter((e) => ids.includes(e.id) && !e.locked).sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
      if (sel.length < 3) return;
      const first = sel[0];
      const last = sel[sel.length - 1];
      const total = axis === 'x' ? last.x + last.width - first.x : last.y + last.height - first.y;
      const sizes = sel.reduce((s, e) => s + (axis === 'x' ? e.width : e.height), 0);
      const gap = (total - sizes) / (sel.length - 1);
      let cur = axis === 'x' ? first.x : first.y;
      for (const e of sel) {
        if (axis === 'x') e.x = Math.round(cur);
        else e.y = Math.round(cur);
        cur += (axis === 'x' ? e.width : e.height) + gap;
      }
    });
  return (
    <div>
      <h3>{els.length} elementos seleccionados</h3>
      <div className="prop-group">
        <h3>Alinear</h3>
        <div className="row gap4 wrap">
          <button className="small outline" onClick={() => align('left')}>
            Izquierda
          </button>
          <button className="small outline" onClick={() => align('hcenter')}>
            Centro
          </button>
          <button className="small outline" onClick={() => align('right')}>
            Derecha
          </button>
        </div>
        <div className="row gap4 wrap mt8">
          <button className="small outline" onClick={() => align('top')}>
            Arriba
          </button>
          <button className="small outline" onClick={() => align('vcenter')}>
            Medio
          </button>
          <button className="small outline" onClick={() => align('bottom')}>
            Abajo
          </button>
        </div>
      </div>
      <div className="prop-group">
        <h3>Distribuir</h3>
        <div className="row gap4">
          <button className="small outline" onClick={() => distribute('x')} disabled={els.length < 3}>
            Horizontal
          </button>
          <button className="small outline" onClick={() => distribute('y')} disabled={els.length < 3}>
            Vertical
          </button>
        </div>
      </div>
    </div>
  );
}
