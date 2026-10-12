import { describe, it, expect } from 'vitest';
import type { CarSummary } from '../src/shared/types';
import { arrangeCars } from '../src/renderer/src/carList';

/** Lista de vehículos de la pantalla de inicio: buscador + modo de orden/filtro. */

const car = (id: string, hasProfile: boolean, hasAcdg: boolean): CarSummary => ({ id, path: id, name: id, brand: '', badge: null, hasProfile, hasAcdg });
// como llega de listCars: por nombre
const CARS = [car('abarth', false, false), car('bmw', true, false), car('ford', false, false), car('porsche', true, true), car('toyota', true, false)];
const ids = (l: CarSummary[]) => l.map((c) => c.id);

describe('lista de vehículos', () => {
  it('por defecto, todos por nombre', () => {
    expect(ids(arrangeCars(CARS, '', 'all'))).toEqual(['abarth', 'bmw', 'ford', 'porsche', 'toyota']);
  });

  it('con perfil primero, conservando el orden por nombre dentro de cada grupo', () => {
    expect(ids(arrangeCars(CARS, '', 'profile_first'))).toEqual(['bmw', 'porsche', 'toyota', 'abarth', 'ford']);
  });

  it('con display instalado primero, luego los que tienen perfil', () => {
    expect(ids(arrangeCars(CARS, '', 'installed_first'))).toEqual(['porsche', 'bmw', 'toyota', 'abarth', 'ford']);
  });

  it('los filtros dejan solo su grupo y se combinan con el buscador', () => {
    expect(ids(arrangeCars(CARS, '', 'only_profile'))).toEqual(['bmw', 'porsche', 'toyota']);
    expect(ids(arrangeCars(CARS, '', 'only_installed'))).toEqual(['porsche']);
    expect(ids(arrangeCars(CARS, '', 'only_none'))).toEqual(['abarth', 'ford']);
    expect(ids(arrangeCars(CARS, 'o', 'only_profile'))).toEqual(['porsche', 'toyota']);
  });

  it('no altera la lista original', () => {
    arrangeCars(CARS, '', 'profile_first');
    expect(ids(CARS)).toEqual(['abarth', 'bmw', 'ford', 'porsche', 'toyota']);
  });
});
