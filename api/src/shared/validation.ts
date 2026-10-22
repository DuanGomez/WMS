import { z } from 'zod';

/**
 * Mensajes de validación en español para todas las reglas que no traen uno propio
 * (las que sí lo traen, como 'Correo inválido', tienen prioridad). Lo que no cubre este mapa
 * cae en la traducción de zod.
 */
z.config({
  ...z.locales.es(),
  customError: (iss) => {
    const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : (v as number));
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined || iss.input === null ? 'Es obligatorio' : 'Valor inválido';
      case 'too_small': {
        const min = n(iss.minimum);
        if (iss.origin === 'string') return min <= 1 ? 'Es obligatorio' : `Debe tener al menos ${min} caracteres`;
        if (iss.origin === 'array' || iss.origin === 'set') return min <= 1 ? 'Elige al menos uno' : `Elige al menos ${min}`;
        if (iss.origin === 'number' || iss.origin === 'int') return iss.inclusive === false ? `Debe ser mayor que ${min}` : `Debe ser mayor o igual a ${min}`;
        return undefined;
      }
      case 'too_big': {
        const max = n(iss.maximum);
        if (iss.origin === 'string') return `Debe tener máximo ${max} caracteres`;
        if (iss.origin === 'array' || iss.origin === 'set') return `Máximo ${max} elementos`;
        if (iss.origin === 'number' || iss.origin === 'int') return iss.inclusive === false ? `Debe ser menor que ${max}` : `Debe ser menor o igual a ${max}`;
        return undefined;
      }
      case 'invalid_value':
        return 'Opción no válida';
      case 'invalid_format':
        return iss.format === 'email' ? 'Correo inválido' : 'Formato inválido';
      default:
        return undefined;
    }
  },
});

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
