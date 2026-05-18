import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { Request } from 'express';
import type { SessionUser } from '../decorators/current-user.decorator';
import { hasFinanceAccess, stripFinanceFields } from '../utils/strip-finance-fields';

/**
 * FinanceFieldsInterceptor — Column-Level Security for REST endpoints.
 *
 * Strips sensitive financial fields (costPrice, landedCost, margin, etc.)
 * from all REST API responses unless the authenticated user has
 * SUPER_ADMIN or FINANCE_OFFICER role.
 *
 * PRD Ref: Section 11.3 (Column-Level Security)
 *
 * Note: tRPC routes use their own middleware for this (in trpc.ts).
 * This interceptor covers REST controllers (auth, health, etc.).
 */
@Injectable()
export class FinanceFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: SessionUser }).user;

    // If no user or user has finance access, return response as-is
    if (!user || hasFinanceAccess(user)) {
      return next.handle();
    }

    // Strip financial fields from the response
    return next.handle().pipe(
      map((data) => stripFinanceFields(data)),
    );
  }
}
