import type { Request, Response } from 'express';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/**
 * tRPC context — created for every request.
 * Contains the authenticated user (if any) and raw req/res.
 */
export interface TrpcContext {
  user: SessionUser | null;
  req: Request;
  res: Response;
}

export function createContext(req: Request, res: Response): TrpcContext {
  const user = (req as Request & { user?: SessionUser }).user ?? null;
  return { user, req, res };
}
