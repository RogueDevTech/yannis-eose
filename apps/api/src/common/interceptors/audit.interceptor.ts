import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Inject,
  Logger,
} from '@nestjs/common';
import { Observable, from, of, switchMap, catchError } from 'rxjs';
import type { Request } from 'express';
import type postgres from 'postgres';
import { PG_CLIENT } from '../../database/database.module';
import type { SessionUser } from '../decorators/current-user.decorator';

/**
 * AuditInterceptor — Actor & Role Injection Pattern
 *
 * For every authenticated request, this interceptor sets:
 * - `yannis.current_user_id` — used by audit triggers (yannis_stamp_actor)
 * - `yannis.current_user_role` — used by RLS policies
 *
 * These are set via set_config with is_local=true, scoping them
 * to the current transaction.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: SessionUser }).user;

    if (!user) {
      // Unauthenticated requests (e.g. login, health) — skip injection
      return next.handle();
    }

    const method = request.method?.toUpperCase() ?? '';
    // Read-heavy routes don't need actor variable injection. Writes use withActor()/withActorAndBranch.
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    // Set both user ID and role in the PostgreSQL session variables
    // These are read by audit triggers and RLS policies
    return from(
      this.sql`
        SELECT
          set_config('yannis.current_user_id', ${user.id}, true),
          set_config('yannis.current_user_role', ${user.role}, true)
      `,
    ).pipe(
      catchError((error: unknown) => {
        // Never fail the request because actor injection couldn't get a DB slot.
        // Write paths still stamp actor via withActor/withActorAndBranch transactions.
        const reason = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(`audit_actor_injection_failed user=${user.id} method=${method} reason=${reason}`);
        return of(null);
      }),
      switchMap(() => next.handle()),
    );
  }
}
