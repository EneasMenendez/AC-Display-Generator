import type { CarListMode, CarSummary } from '@shared/types';

/** Orden y filtro de la lista de vehículos de la pantalla de inicio. */

export const CAR_LIST_MODES: { value: CarListMode; label: string }[] = [
  { value: 'all', label: 'Todos (por nombre)' },
  { value: 'profile_first', label: 'Con perfil primero' },
  { value: 'installed_first', label: 'Con display instalado primero' },
  { value: 'only_profile', label: 'Solo con perfil' },
  { value: 'only_installed', label: 'Solo con display instalado' },
  { value: 'only_none', label: 'Solo sin perfil' },
];

/** Lista de vehículos tras el buscador y el modo elegido; dentro de cada grupo se mantiene el orden por nombre. */
export function arrangeCars(cars: CarSummary[], query: string, mode: CarListMode): CarSummary[] {
  const q = query.trim().toLowerCase();
  let list = q ? cars.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.brand.toLowerCase().includes(q)) : cars;
  if (mode === 'only_profile') list = list.filter((c) => c.hasProfile);
  else if (mode === 'only_installed') list = list.filter((c) => c.hasAcdg);
  else if (mode === 'only_none') list = list.filter((c) => !c.hasProfile && !c.hasAcdg);
  // sort es estable: el orden por nombre que trae la lista se conserva dentro de cada grupo
  else if (mode === 'profile_first') list = [...list].sort((a, b) => Number(b.hasProfile) - Number(a.hasProfile));
  else if (mode === 'installed_first') list = [...list].sort((a, b) => Number(b.hasAcdg) - Number(a.hasAcdg) || Number(b.hasProfile) - Number(a.hasProfile));
  return list;
}
