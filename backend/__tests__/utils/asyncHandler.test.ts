import asyncHandler from '../../src/utils/asyncHandler';

describe('asyncHandler', () => {
	let req: any;
	let res: any;
	let next: jest.Mock;

	beforeEach(() => {
		req = {};
		res = {};
		next = jest.fn();
	});

	it('calls the wrapped function with req, res, next', async () => {
		const fn = jest.fn().mockResolvedValue(undefined);
		const handler = asyncHandler(fn);

		await handler(req, res, next);

		expect(fn).toHaveBeenCalledWith(req, res, next);
	});

	it('resolves successfully when fn resolves', async () => {
		const fn = jest.fn().mockResolvedValue('ok');
		const handler = asyncHandler(fn);

		await handler(req, res, next);

		expect(next).not.toHaveBeenCalled();
	});

	it('calls next with error when fn rejects', async () => {
		const error = new Error('async failure');
		const fn = jest.fn().mockRejectedValue(error);
		const handler = asyncHandler(fn);

		await handler(req, res, next);

		expect(next).toHaveBeenCalledWith(error);
	});

	it('propagates synchronous throw', () => {
		const error = new Error('sync failure');
		const fn = jest.fn().mockImplementation(() => {
			throw error;
		});
		const handler = asyncHandler(fn);

		expect(() => handler(req, res, next)).toThrow('sync failure');
	});
});
