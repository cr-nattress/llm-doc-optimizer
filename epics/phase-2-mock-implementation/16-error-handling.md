# User Story: Add Error Handling Middleware

## Story
As a developer, I want centralized error handling so that all errors are caught, logged, and returned to clients in a consistent format.

## Acceptance Criteria
- [ ] All errors are caught globally
- [ ] Error responses follow consistent schema
- [ ] Sensitive information is not leaked
- [ ] Different error types map to correct status codes
- [ ] Stack traces only shown in development

## Technical Details
Create src/middleware/error-handler.ts:
```typescript
export class ApplicationError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode: string
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class AuthenticationError extends ApplicationError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
  }
}

export class OpenAIError extends ApplicationError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, 'OPENAI_ERROR');
  }
}

// Global error handler
app.setErrorHandler((error, request, reply) => {
  // Log error with context
  request.log.error({
    err: error,
    reqId: request.id,
    url: request.url,
    method: request.method
  });
  
  // Determine status code
  const statusCode = error.statusCode || 500;
  
  // Build error response
  const response = {
    error: {
      message: error.message || 'Internal Server Error',
      code: error.errorCode || 'INTERNAL_ERROR',
      statusCode
    }
  };
  
  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = error.stack;
  }
  
  // Send response
  reply.code(statusCode).send(response);
});

// Not found handler
app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND',
      statusCode: 404
    }
  });
});
```

## Definition of Done
- [ ] All errors are handled consistently
- [ ] Custom error classes are used
- [ ] Errors are logged with context
- [ ] Client receives helpful error messages