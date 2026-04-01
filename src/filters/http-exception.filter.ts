import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(HttpExceptionFilter.name);

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let code = 'INTERNAL_ERROR';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
                const res = exceptionResponse as any;
                if (res.code) {
                    code = res.code;
                    message = res.message || message;
                } else {
                    message = res.message || message;
                }
            }

            if (!((exception.getResponse() as any)?.code)) {
                code = this.getCodeFromStatus(status);
            }
        }

        // Log the error
        if (status >= 500) {
            this.logger.error(
                `[${request.method}] ${request.url} - Status: ${status} - Error: ${exception.message}`,
                exception.stack,
            );
        } else {
            this.logger.warn(
                `[${request.method}] ${request.url} - Status: ${status} - Error: ${message}`,
            );
        }

        response.status(status).send({
            code,
            message,
            timestamp: new Date().toISOString(),
        });
    }

    private getCodeFromStatus(status: number): string {
        const map: Record<number, string> = {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            422: 'UNPROCESSABLE_ENTITY',
            429: 'TOO_MANY_REQUESTS',
            500: 'INTERNAL_ERROR',
        };
        return map[status] || 'ERROR';
    }
}
