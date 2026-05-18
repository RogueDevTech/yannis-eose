import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { formatHttpRequestLogLine, httpRequestTimingAls, shouldLogHttpRequests } from './http-request-timing';

@Injectable()
export class HttpRequestTimingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpRequestTimingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    if (!shouldLogHttpRequests()) {
      next();
      return;
    }

    const store = { dbMs: 0 };
    httpRequestTimingAls.run(store, () => {
      const started = performance.now();
      res.on('finish', () => {
        const totalMs = performance.now() - started;
        const rawUrl = req.originalUrl ?? req.url ?? '';
        const line = formatHttpRequestLogLine({
          method: req.method,
          url: rawUrl,
          statusCode: res.statusCode,
          totalMs,
          dbMs: store.dbMs,
        });
        this.logger.log(line);
      });
      next();
    });
  }
}
