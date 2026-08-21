/**
 * Health routes.
 *
 * Classification (security §7): PUBLIC.
 */
import { Router } from 'express';
import { getHealth, getReadiness } from './health.controller.js';

export const healthRoutes = Router();

healthRoutes.get('/health', getHealth);
healthRoutes.get('/ready', getReadiness);
