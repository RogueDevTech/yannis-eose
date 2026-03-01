import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';

    const { token, user } = await this.authService.login(
      body.email,
      body.password,
      clientIp,
    );

    // Set HTTP-only secure cookie
    const isProduction = process.env['NODE_ENV'] === 'production';
    res.cookie('yannis_session', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10) * 1000,
      path: '/',
    });

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionToken = this.extractSessionToken(req);

    if (sessionToken) {
      await this.authService.logout(sessionToken);
    }

    res.clearCookie('yannis_session', { path: '/' });
    return { message: 'Logged out successfully' };
  }

  /**
   * SuperAdmin-only: Kill all sessions for a specific user.
   * Forces immediate logout across all devices.
   */
  @Roles('SUPER_ADMIN')
  @Delete('sessions/:userId')
  @HttpCode(HttpStatus.OK)
  async killUserSessions(
    @Param('userId') userId: string,
    @CurrentUser() actor: SessionUser,
  ) {
    const killed = await this.authService.killUserSessions(userId);
    return {
      message: `Terminated ${killed} session(s) for user ${userId}`,
      killedBy: actor.id,
      sessionsKilled: killed,
    };
  }

  /**
   * Returns the current authenticated user's session data.
   */
  @Post('me')
  @HttpCode(HttpStatus.OK)
  me(@CurrentUser() user: SessionUser) {
    return { user };
  }

  private extractSessionToken(request: Request): string | undefined {
    const cookies = request.headers.cookie;
    if (!cookies) return undefined;

    const match = cookies.split(';').find((c) => c.trim().startsWith('yannis_session='));
    if (!match) return undefined;

    return match.split('=')[1]?.trim();
  }
}
