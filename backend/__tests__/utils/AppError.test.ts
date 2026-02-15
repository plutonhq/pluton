import {
	AppError,
	NotFoundError,
	BadRequestError,
	UnauthorizedError,
	ConflictError,
} from '../../src/utils/AppError';

describe('AppError', () => {
	describe('AppError (base)', () => {
		it('should create an instance of AppError', () => {
			const error = new AppError(500, 'something went wrong');
			expect(error).toBeInstanceOf(AppError);
			expect(error).toBeInstanceOf(Error);
		});

		it('should have the correct statusCode', () => {
			const error = new AppError(422, 'fail');
			expect(error.statusCode).toBe(422);
		});

		it('should have the correct message', () => {
			const error = new AppError(500, 'custom message');
			expect(error.message).toBe('custom message');
		});

		it('should have a stack trace', () => {
			const error = new AppError(500, 'trace test');
			expect(error.stack).toBeDefined();
		});
	});

	describe('NotFoundError', () => {
		it('should create an instance of NotFoundError and AppError', () => {
			const error = new NotFoundError();
			expect(error).toBeInstanceOf(AppError);
			expect(error).toBeInstanceOf(Error);
		});

		it('should have statusCode 404', () => {
			const error = new NotFoundError();
			expect(error.statusCode).toBe(404);
		});

		it('should use default message "Resource not found"', () => {
			const error = new NotFoundError();
			expect(error.message).toBe('Resource not found');
		});

		it('should allow a custom message', () => {
			const error = new NotFoundError('User not found');
			expect(error.message).toBe('User not found');
			expect(error.statusCode).toBe(404);
		});

		it('should have a stack trace', () => {
			const error = new NotFoundError();
			expect(error.stack).toBeDefined();
		});
	});

	describe('BadRequestError', () => {
		it('should create an instance of BadRequestError and AppError', () => {
			const error = new BadRequestError();
			expect(error).toBeInstanceOf(AppError);
			expect(error).toBeInstanceOf(Error);
		});

		it('should have statusCode 400', () => {
			const error = new BadRequestError();
			expect(error.statusCode).toBe(400);
		});

		it('should use default message "Bad request"', () => {
			const error = new BadRequestError();
			expect(error.message).toBe('Bad request');
		});

		it('should allow a custom message', () => {
			const error = new BadRequestError('Invalid input');
			expect(error.message).toBe('Invalid input');
			expect(error.statusCode).toBe(400);
		});

		it('should have a stack trace', () => {
			const error = new BadRequestError();
			expect(error.stack).toBeDefined();
		});
	});

	describe('UnauthorizedError', () => {
		it('should create an instance of UnauthorizedError and AppError', () => {
			const error = new UnauthorizedError();
			expect(error).toBeInstanceOf(AppError);
			expect(error).toBeInstanceOf(Error);
		});

		it('should have statusCode 401', () => {
			const error = new UnauthorizedError();
			expect(error.statusCode).toBe(401);
		});

		it('should use default message "Unauthorized"', () => {
			const error = new UnauthorizedError();
			expect(error.message).toBe('Unauthorized');
		});

		it('should allow a custom message', () => {
			const error = new UnauthorizedError('Token expired');
			expect(error.message).toBe('Token expired');
			expect(error.statusCode).toBe(401);
		});

		it('should have a stack trace', () => {
			const error = new UnauthorizedError();
			expect(error.stack).toBeDefined();
		});
	});

	describe('ConflictError', () => {
		it('should create an instance of ConflictError and AppError', () => {
			const error = new ConflictError();
			expect(error).toBeInstanceOf(AppError);
			expect(error).toBeInstanceOf(Error);
		});

		it('should have statusCode 409', () => {
			const error = new ConflictError();
			expect(error.statusCode).toBe(409);
		});

		it('should use default message "Conflict"', () => {
			const error = new ConflictError();
			expect(error.message).toBe('Conflict');
		});

		it('should allow a custom message', () => {
			const error = new ConflictError('Duplicate entry');
			expect(error.message).toBe('Duplicate entry');
			expect(error.statusCode).toBe(409);
		});

		it('should have a stack trace', () => {
			const error = new ConflictError();
			expect(error.stack).toBeDefined();
		});
	});
});
