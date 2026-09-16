import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, toast, activeDisplayOf, activePageOf } from '../store';
import { saveProjectFlow } from '../flows';
import { CanvasEditor, isTyping } from './CanvasEditor';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { PreviewPanel } from './PreviewPanel';
import { InstallDialog } from './InstallDialog';
import { Icon } from './icons';

export function Editor() {
  const project = useStore((s) => s.project);
  const dp = useStore(activeDisplayOf);
  const activeDisplay = useStore((s) => s.activeDisplay);
  const activePage = useStore((s) => s.activePage);
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  const setActivePage = useStore((s) => s.setActivePage);
  const dirty = useStore((s) => s.dirty);
  const projectFile = useStore((s) => s.projectFile);
  const showPreview = useStore((s) => s.showPreview);
  const previewMode = useStore((s) => s.previewMode);
  const physicalView = useStore((s) => s.physicalView);
  const zoom = useStore((s) => s.zoom);
  const hover = useStore((s) => s.hoverPos);
  const selection = useStore((s) => s.selection);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const profile = useStore((s) => s.profile);
  const [install, setInstall] = useState(false);
  const [help, setHelp] = useState(false);

  // cargar fuentes del proyecto en el documento
  useEffect(() => {
    if (!project) return;
    const assets = useStore.getState().assets;
    for (const [name, path] of Object.entries(Object.assign({}, ...project.displays.map((d) => d.fonts)) as Record<string, string>)) {
      const url = assets[path];
      if (!url) continue;
      const face = new FontFace(name, `url(${url})`);
      face.load().then((f) => document.fonts.add(f)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.displays]);

  // atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const page = activePageOf(s);
      if (!s.project || !page) return;
      if (isTyping(e)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const step = e.shiftKey ? 10 : 1;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectFlow(e.shiftKey);
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.duplicateSelected();
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.select(page.elements.filter((el) => el.visible).map((el) => el.id));
      } else if (ctrl && e.key.toLowerCase() === 'c') {
        const sel = page.elements.filter((el) => s.selection.includes(el.id));
        if (sel.length) localStorage.setItem('acdg:clipboard', JSON.stringify(sel));
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        const raw = localStorage.getItem('acdg:clipboard');
        if (!raw) return;
        const items = JSON.parse(raw) as typeof page.elements;
        const ids: string[] = [];
        s.patchPage((pg) => {
          for (const it of items) {
            const c = { ...it, id: `el_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, x: it.x + 20, y: it.y + 20 };
            pg.elements.push(c);
            ids.push(c.id);
          }
        });
        s.select(ids);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.removeSelected();
      } else if (e.key === 'Escape') {
        s.select([]);
        s.setPreviewMode(false);
      } else if (e.key.startsWith('Arrow')) {
        if (!s.selection.length) return;
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.moveSelected(dx, dy);
      } else if (e.key === '0' && ctrl) {
        e.preventDefault();
        window.dispatchEvent(new Event('acdg:fit'));
      } else if ((e.key === '+' || e.key === '=') && ctrl) {
        e.preventDefault();
        s.setZoom(Math.min(8, s.zoom * 1.2));
      } else if (e.key === '-' && ctrl) {
        e.preventDefault();
        s.setZoom(Math.max(0.05, s.zoom / 1.2));
      } else if (e.key === 'p' || e.key === 'P') {
        s.setPreviewMode(!s.previewMode);
      } else if (e.key === 'h' || e.key === 'H') {
        if (s.selection.length) s.patchPage((pg) => pg.elements.forEach((el) => s.selection.includes(el.id) && (el.visible = !el.visible)));
      } else if (e.key === 'l' || e.key === 'L') {
        if (s.selection.length) s.patchPage((pg) => pg.elements.forEach((el) => s.selection.includes(el.id) && (el.locked = !el.locked)));
      } else if (e.key === 'F1') {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // autoguardado de recuperación cada 60 s (en localStorage; el .acdisplay real se guarda con Ctrl+S)
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = useStore.getState();
      if (s.project && s.dirty) {
        try {
          localStorage.setItem('acdg:autosave', JSON.stringify({ project: s.project, file: s.projectFile, at: Date.now() }));
        } catch {
          /* sin espacio */
        }
      }
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  if (!project || !dp) return null;

  async function close() {
    const s = useStore.getState();
    if (s.dirty) {
      const idx = await api.confirm('El proyecto tiene cambios sin guardar.', '¿Quieres guardarlos antes de cerrar?', ['Guardar', 'Descartar', 'Cancelar']);
      if (idx === 2) return;
      if (idx === 0 && !(await saveProjectFlow())) return;
    }
    s.closeProject();
  }

  return (
    <div className={`editor ${showPreview ? 'with-preview' : ''}`}>
      <div className="topbar">
        <button className="icon" onClick={close} title="Volver al inicio">
          <Icon name="back" />
        </button>
        <span className="title">
          {project.name}
          {dirty && <span className="dot">•</span>}
        </span>
        {project.displays.length > 1 && (
          <select className="display-switch" value={activeDisplay} onChange={(e) => setActiveDisplay(Number(e.target.value))} title="Display del coche que se está editando">
            {project.displays.map((d, i) => (
              <option key={d.display_id} value={i}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <div className="pages">
          {dp.pages.map((pg, i) => (
            <button key={pg.id} className={`page-tab ${i === activePage ? 'active' : ''}`} onClick={() => setActivePage(i)} title={pg.when ? 'Página con condición automática' : 'Página'}>
              {pg.name}
              {pg.when && <span className="dot">•</span>}
            </button>
          ))}
          <button className="icon" title="Añadir página" onClick={() => useStore.getState().addPage()}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        <button className="icon" onClick={() => saveProjectFlow()} title="Guardar (Ctrl+S)">
          <Icon name="save" />
        </button>
        <button className="ghost small" onClick={() => saveProjectFlow(true)} title="Guardar como… (Ctrl+Shift+S)">
          Guardar como
        </button>
        <div className="sep" />
        <button className="icon" disabled={past.length === 0} onClick={() => useStore.getState().undo()} title="Deshacer (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button className="icon" disabled={future.length === 0} onClick={() => useStore.getState().redo()} title="Rehacer (Ctrl+Y)">
          <Icon name="redo" />
        </button>
        <div className="sep" />
        <button className="icon" onClick={() => useStore.getState().setZoom(Math.max(0.05, zoom / 1.2))} title="Alejar (Ctrl+-)">
          <Icon name="minus" />
        </button>
        <span className="zoom">{Math.round(zoom * 100)}%</span>
        <button className="icon" onClick={() => useStore.getState().setZoom(Math.min(8, zoom * 1.2))} title="Acercar (Ctrl++)">
          <Icon name="plus" />
        </button>
        <button className="icon" onClick={() => window.dispatchEvent(new Event('acdg:fit'))} title="Ajustar a la ventana (Ctrl+0)">
          <Icon name="fit" />
        </button>
        <div className="sep" />
        <button className={`ghost ${previewMode ? 'active' : ''}`} onClick={() => useStore.getState().setPreviewMode(!previewMode)} title="Modo previsualización: oculta tiradores y guías (P)">
          <Icon name="play" size={13} /> Previsualizar
        </button>
        <button className={`ghost ${showPreview ? 'active' : ''}`} onClick={() => useStore.getState().togglePreview()} title="Mostrar/ocultar panel de simulación">
          <Icon name="sliders" size={14} /> Simulación
        </button>
        <button
          className={`ghost ${physicalView ? 'active' : ''}`}
          onClick={() => useStore.getState().setPhysicalView(!physicalView)}
          title="Vista física: deforma el lienzo a la proporción real del display en el coche"
          disabled={!profile?.displays.find((d) => d.id === dp.display_id)?.physical_size_m}
        >
          <Icon name="monitor" size={14} /> Vista física
        </button>
        <span className="grow" />
        <button className="icon" onClick={() => setHelp(true)} title="Atajos (F1)">
          <Icon name="help" />
        </button>
        <button className="primary" onClick={() => setInstall(true)}>
          Generar e instalar
        </button>
      </div>
      <div className="leftpanel">
        <LayersPanel />
      </div>
      <CanvasEditor />
      <div className="rightpanel">
        <PropertiesPanel />
      </div>
      {showPreview && (
        <div className="previewpanel">
          <PreviewPanel />
        </div>
      )}
      <div className="statusbar">
        <span>
          {dp.canvas.width} × {dp.canvas.height} px
        </span>
        <span>{hover ? `X ${hover.x}  Y ${hover.y}` : ''}</span>
        <span>{selection.length ? `${selection.length} seleccionado${selection.length > 1 ? 's' : ''}` : ''}</span>
        <span className="grow" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectFile ?? 'sin guardar'}</span>
      </div>
      {install && <InstallDialog onClose={() => setInstall(false)} />}
      {help && (
        <div className="modal-bg" onClick={() => setHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Atajos de teclado</h2>
            <table className="info">
              <tbody>
                {[
                  ['Arrastrar / Shift+clic', 'Mover / seleccionar varios'],
                  ['Tiradores (Shift)', 'Redimensionar (mantener proporción)'],
                  ['Alt al arrastrar', 'Desactivar ajuste'],
                  ['Flechas / Shift+Flechas', 'Mover 1 px / 10 px'],
                  ['Rueda / Espacio+arrastrar / botón central', 'Zoom / desplazar lienzo'],
                  ['Ctrl+0, Ctrl++, Ctrl+-', 'Ajustar, acercar, alejar'],
                  ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'],
                  ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copiar / pegar / duplicar'],
                  ['Ctrl+A', 'Seleccionar todo'],
                  ['Supr', 'Eliminar'],
                  ['H / L', 'Ocultar / bloquear selección'],
                  ['P', 'Modo previsualización'],
                  ['Ctrl+S / Ctrl+Shift+S', 'Guardar / guardar como'],
                  ['Esc', 'Deseleccionar'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt8 outline" onClick={() => setHelp(false)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { toast };
