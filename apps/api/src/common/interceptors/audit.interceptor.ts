import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Inject,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
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

    // Set both user ID and role in the PostgreSQL session variables
    // These are read by audit triggers and RLS policies
    return from(
      this.sql`
        SELECT
          set_config('yannis.current_user_id', ${user.id}, true),
          set_config('yannis.current_user_role', ${user.role}, true)
      `,
    ).pipe(switchMap(() => next.handle()));
  }
}
