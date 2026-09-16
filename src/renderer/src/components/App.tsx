import { useEffect } from 'react';
import { api } from '../api';
import { useStore, toast } from '../store';
import { StartScreen } from './StartScreen';
import { Wizard } from './Wizard';
import { Editor } from './Editor';

export function App() {
  const screen = useStore((s) => s.screen);
  const t = useStore((s) => s.toast);
  const setInfo = useStore((s) => s.setInfo);
  const setIcons = useStore((s) => s.setIcons);
  const setFonts = useStore((s) => s.setFonts);

  useEffect(() => {
    api
      .appInfo()
      .then(setInfo)
      .catch((e) => toast(`No se pudo inicializar: ${e.message}`, 'err'));
    api.listIcons().then(setIcons).catch(() => undefined);
    api.listFonts().then(setFonts).catch(() => undefined);
  }, [setInfo, setIcons, setFonts]);

  return (
    <>
      {screen === 'start' && <StartScreen />}
      {screen === 'wizard' && <Wizard />}
      {screen === 'editor' && <Editor />}
      {t && <div className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>}
    </>
  );
}
