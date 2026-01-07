import { ArgumentsHost, Catch, WsExceptionFilter } from '@nestjs/common';

interface ExceptionResponse {
  message?: string;
  error?: string;
}

interface ExceptionLike {
  response?: ExceptionResponse;
  status?: number;
}

@Catch()
export class CustomWsExceptionFilter implements WsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();

    // Safely extract exception properties
    const exceptionObj = exception as ExceptionLike;
    const response = exceptionObj?.response;
    const statusCode = typeof exceptionObj?.status === 'number' ? exceptionObj.status : 500;
    const message = typeof response?.message === 'string' ? response.message : 'An unexpected error occurred.';
    const error = typeof response?.error === 'string' ? response.error : 'Unknown error';

    // Emit a structured error response to the client
    client.emit('error', {
      message,
      error,
      statusCode,
    });
  }
}
