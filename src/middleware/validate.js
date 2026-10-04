/**
 * Request validation (structure.md security §4, §5).
 *
 * Every route that accepts input declares a Zod schema for the parts it reads.
 * Two rules make this a security control rather than a convenience:
 *
 *   1. Validation runs on the server for body, query AND route params. React
 *      validation is a usability feature, never a control.
 *   2. Schemas are strict — unexpected fields are rejected, not ignored. That is
 *      what stops mass assignment: a client cannot smuggle `role`, `isAdmin` or
 *      `price` into a payload, because the schema does not declare them.
 *
 * The validated result replaces the raw input, so controllers only ever see
 * parsed, coerced, trusted values.
 */
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { formatZodIssues } from './errorHandler.js';

/** The request properties that can be validated. */
const TARGETS = ['body', 'query', 'params'];

/**
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return function validateRequest(req, _res, next) {
    try {
      for (const target of TARGETS) {
        const schema = schemas[target];
        if (!schema) continue;

        const parsed = schema.parse(req[target] ?? {});

        if (target === 'query' || target === 'params') {
          // Clear and re-fill rather than reassigning. In Express 4.22 both are
          // ordinary properties — `req.query` is assigned by the query middleware
          // and `req.params` by the router — so either approach works today;
          // mutating in place keeps the existing object identity and stays
          // correct if a future version installs them as getters again.
          for (const key of Object.keys(req[target])) delete req[target][key];
          Object.assign(req[target], parsed);
        } else {
          req[target] = parsed;
        }
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(AppError.validation(formatZodIssues(error)));
        return;
      }
      next(error);
    }
  };
}
