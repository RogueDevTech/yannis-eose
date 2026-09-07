import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { SessionUser } from '../decorators/current-user.decorator';
import { SessionStoreService } from '../../auth/session-store.service';
import { resolveSessionTtlSeconds } from '../../auth/auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionStore: SessionStoreService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth for routes marked @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const sessionToken = this.extractSessionToken(request);

    if (!sessionToken) {
      throw new UnauthorizedException('No session token provided');
    }

    const user = await this.sessionStore.getSession(sessionToken);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    (request as Request & { user: SessionUser }).user = user;

    // Refresh session TTL on each valid request (sliding expiry).
    // MUST use the same resolver as login and the `/auth/me` cookie re-stamp:
    // refreshing Redis to a flat 86400s while the browser cookie was minted to
    // expire at 23:59 local made the server think a session was alive long after
    // the browser had discarded its cookie.
    await this.sessionStore.touchSession(sessionToken, resolveSessionTtlSeconds());

    return true;
  }

  private extractSessionToken(request: Request): string | undefined {
    const cookies = request.headers.cookie;
    if (!cookies) return undefined;

    const match = cookies.split(';').find((c) => c.trim().startsWith('yannis_session='));
    if (!match) return undefined;

    return match.split('=')[1]?.trim();
  }
}
