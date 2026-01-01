import { ArgumentsHost, Catch, WsExceptionFilter } from '@nestjs/common';

@Catch()
export class CustomWsExceptionFilter implements WsExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();

    // Log the exception for debugging
    console.error('WebSocket Exception:', exception);

    // Emit a structured error response to the client
    client.emit('error', {
      message: exception?.response?.message || 'An unexpected error occurred.',
      error: exception?.response?.error || 'Unknown error',
      statusCode: exception?.status || 500,
    });
  }
}
