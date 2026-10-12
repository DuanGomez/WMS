import { ZodError } from 'zod';

/** Error de negocio con respuesta HTTP consistente: { code, message, details }. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Debes iniciar sesión.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'No tienes permiso para realizar esta acción.') =>
  new ApiError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Recurso') => new ApiError(404, 'NOT_FOUND', `${what} no encontrado.`);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'CONFLICT', message, details);
export const planLimit = (message: string, details?: unknown) =>
  new ApiError(402, 'PLAN_LIMIT', message, details);

export function toErrorBody(e: unknown): {
  status: number;
  body: { code: string; message: string; details?: unknown };
} {
  if (e instanceof ApiError)
    return { status: e.status, body: { code: e.code, message: e.message, details: e.details } };
  if (e instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos.',
        details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/UNIQUE constraint failed/i.test(msg)) {
    return {
      status: 409,
      body: { code: 'CONFLICT', message: 'Ya existe un registro con esos datos únicos.' },
    };
  }
  console.error('[api] error no controlado', e);
  return { status: 500, body: { code: 'INTERNAL', message: 'Ocurrió un error inesperado en el servidor.' } };
}
