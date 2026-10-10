/**
 * Genera la guía de usuario (resources/docs/guia.pdf) a partir de docs/guia/guia.html con el motor
 * de impresión de Chromium que ya trae Electron, así el PDF sale igual que la página.
 *
 *   npm run guide
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'docs', 'guia', 'guia.html');
const OUT = join(ROOT, 'resources', 'docs', 'guia.pdf');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400 });
  try {
    await win.loadFile(SOURCE);
    // las imágenes y las fuentes tienen que estar listas antes de imprimir
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))');
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true });
    mkdirSync(join(ROOT, 'resources', 'docs'), { recursive: true });
    writeFileSync(OUT, pdf);
    console.log(`Guía generada: ${OUT} (${(pdf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
