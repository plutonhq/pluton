import versionMiddleware from '../../src/middlewares/versionMiddleware';
import { getInstallType } from '../../src/utils/installHelpers';

jest.mock('../../src/utils/installHelpers', () => ({
	getInstallType: jest.fn().mockReturnValue('dev'),
}));

describe('versionMiddleware', () => {
	const req = {} as any;
	const res = { setHeader: jest.fn() } as any;
	const next = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('sets X-App-Version header', () => {
		versionMiddleware(req, res, next);
		expect(res.setHeader).toHaveBeenCalledWith('X-App-Version', expect.any(String));
	});

	it('sets X-Server-OS header to process.platform', () => {
		versionMiddleware(req, res, next);
		expect(res.setHeader).toHaveBeenCalledWith('X-Server-OS', process.platform);
	});

	it('sets X-Install-Type header using getInstallType()', () => {
		versionMiddleware(req, res, next);
		expect(res.setHeader).toHaveBeenCalledWith('X-Install-Type', 'dev');
		expect(getInstallType).toHaveBeenCalled();
	});

	it('calls next()', () => {
		versionMiddleware(req, res, next);
		expect(next).toHaveBeenCalled();
	});
});
