import { z } from 'zod';

export { z };

/** Valida y tipa la entrada; un ZodError se traduce a 400 VALIDATION_ERROR en http.ts. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data ?? {});
}

export const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
export const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida');
export const uuid = z.string().min(8).max(64);
export const email = z.string().trim().toLowerCase().email('Correo inválido');
export const password = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .regex(/[A-Za-z]/, 'Debe tener al menos una letra')
  .regex(/[0-9]/, 'Debe tener al menos un número');
