import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../../database/database.module';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { SessionUser } from '../decorators/current-user.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
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

    const sessionData = await this.redis.get(`session:${sessionToken}`);
    if (!sessionData) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user: SessionUser = JSON.parse(sessionData);
    (request as Request & { user: SessionUser }).user = user;

    // Refresh session TTL on each valid request (sliding expiry)
    const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
    await this.redis.expire(`session:${sessionToken}`, ttl);

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
