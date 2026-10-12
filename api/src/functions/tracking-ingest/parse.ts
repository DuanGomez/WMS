import { ingestSchema } from '../../shared/ingest';
import { parse } from '../../shared/validation';

export const ingestPayloadOrThrow = (body: unknown) => parse(ingestSchema, body);
