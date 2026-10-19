import versionMiddleware from '../../src/middlewares/versionMiddleware';
import { getInstallType } from '../../src/utils/installHelpers';
import { configService } from '../../src/services/ConfigService';

jest.mock('../../src/utils/installHelpers', () => ({
	getInstallType: jest.fn().mockReturnValue('dev'),
}));

// This middleware only reads setup status. Do not initialize persisted
// credentials through the real service with a middleware-only helper mock:
// Linux startup also requires isBinaryMode/isDockerMode from installHelpers.
jest.mock('../../src/services/ConfigService', () => ({
	configService: { isSetupPending: jest.fn() },
}));

describe('versionMiddleware', () => {
	const req = {} as any;
	const res = { setHeader: jest.fn() } as any;
	const next = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(configService.isSetupPending).mockReturnValue(false);
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

	it.each<[boolean, number]>([
		[false, 0],
		[true, 1],
	])('sets X-Setup-Pending for setup pending = %s', (pending, header) => {
		jest.mocked(configService.isSetupPending).mockReturnValue(pending);
		versionMiddleware(req, res, next);
		expect(configService.isSetupPending).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenCalledWith('X-Setup-Pending', header);
	});

	it('calls next()', () => {
		versionMiddleware(req, res, next);
		expect(next).toHaveBeenCalled();
	});
	it('only exposes a valid local build revision, never arbitrary metadata', () => {
		const previous = process.env.VCS_REF;
		try {
			process.env.VCS_REF = 'a'.repeat(40);
			versionMiddleware(req, res, next);
			expect(res.setHeader).toHaveBeenCalledWith('X-App-Revision', 'a'.repeat(40));
			res.setHeader.mockClear();
			process.env.VCS_REF = 'not-a-revision';
			versionMiddleware(req, res, next);
			expect(res.setHeader).not.toHaveBeenCalledWith('X-App-Revision', expect.anything());
		} finally {
			if (previous === undefined) delete process.env.VCS_REF;
			else process.env.VCS_REF = previous;
		}
	});
});
