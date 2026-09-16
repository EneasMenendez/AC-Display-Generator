import type { AcdgApi } from '@shared/types';

declare global {
  interface Window {
    acdg: AcdgApi;
  }
}

export const api: AcdgApi = window.acdg;
