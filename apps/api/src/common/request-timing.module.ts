import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { HttpRequestTimingMiddleware } from './http-request-timing.middleware';

/**
 * Registered first in `AppModule` so HTTP + DB timing ALS wraps every downstream middleware (incl. `/trpc`).
 */
@Module({
  providers: [HttpRequestTimingMiddleware],
})
export class RequestTimingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(HttpRequestTimingMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
