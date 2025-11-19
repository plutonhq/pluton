/**
 * A custom error class for handling application-specific errors with HTTP status codes.
 */
export class AppError extends Error {
	public readonly statusCode: number;

	/**
	 * @param statusCode The HTTP status code to be sent in the response.
	 * @param message The error message.
	 */
	constructor(statusCode: number, message: string) {
		// Pass the message to the base Error class
		super(message);

		// Assign the status code
		this.statusCode = statusCode;

		// Set the prototype explicitly to ensure 'instanceof' works correctly
		Object.setPrototypeOf(this, AppError.prototype);

		// Capturing the stack trace, excluding the constructor call from it.
		Error.captureStackTrace(this, this.constructor);
	}
}

/**
 * Represents a "Not Found" error (HTTP 404).
 */
export class NotFoundError extends AppError {
	constructor(message: string = 'Resource not found') {
		super(404, message);
	}
}

/**
 * Represents a "Bad Request" error (HTTP 400).
 */
export class BadRequestError extends AppError {
	constructor(message: string = 'Bad request') {
		super(400, message);
	}
}

/**
 * Represents an "Unauthorized" error (HTTP 401).
 */
export class UnauthorizedError extends AppError {
	constructor(message: string = 'Unauthorized') {
		super(401, message);
	}
}

/**
 * Represents a "Conflict" error (HTTP 409).
 * Useful for cases like "backup already in progress".
 */
export class ConflictError extends AppError {
	constructor(message: string = 'Conflict') {
		super(409, message);
	}
}
