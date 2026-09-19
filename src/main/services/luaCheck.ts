import luaparse from 'luaparse';

/** Comprobación sintáctica de un script Lua (5.1, como el de CSP). Devuelve el error o null. */
export function validateLua(code: string, name: string): string | null {
  try {
    luaparse.parse(code, { luaVersion: '5.1', comments: false });
    return null;
  } catch (e) {
    const err = e as { message?: string; line?: number };
    return `${name}: ${err.message ?? 'error de sintaxis'}${err.line ? ` (línea ${err.line})` : ''}`;
  }
}
