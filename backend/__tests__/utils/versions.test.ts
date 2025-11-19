import { execSync } from 'child_process';
import { getResticVersion, getRcloneVersion } from '../../src/utils/versions';

jest.mock('child_process');

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('versions', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('getResticVersion', () => {
		it('should return version when restic is installed', () => {
			const mockOutput = JSON.stringify({ version: '0.16.0' });
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getResticVersion();

			expect(version).toBe('0.16.0');
			expect(mockedExecSync).toHaveBeenCalledWith('restic version --json');
		});

		it('should return "not_installed" when restic command fails', () => {
			mockedExecSync.mockImplementation(() => {
				throw new Error('Command not found');
			});

			const version = getResticVersion();

			expect(version).toBe('not_installed');
		});

		it('should return "not_installed" when output is empty', () => {
			mockedExecSync.mockReturnValue(Buffer.from(''));

			const version = getResticVersion();

			expect(version).toBe('not_installed');
		});

		it('should handle whitespace in output', () => {
			const mockOutput = `  ${JSON.stringify({ version: '0.15.2' })}  \n`;
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getResticVersion();

			expect(version).toBe('0.15.2');
		});

		it('should return "not_installed" when JSON parsing fails', () => {
			mockedExecSync.mockReturnValue(Buffer.from('invalid json'));

			const version = getResticVersion();

			expect(version).toBe('not_installed');
		});

		it('should handle different version formats', () => {
			const mockOutput = JSON.stringify({ version: '0.17.0-dev' });
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getResticVersion();

			expect(version).toBe('0.17.0-dev');
		});
	});

	describe('getRcloneVersion', () => {
		it('should return version when rclone is installed', () => {
			const mockOutput = 'rclone v1.65.0\n- os/version: ...\n- go/version: ...';
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getRcloneVersion();

			expect(version).toBe('1.65.0');
			expect(mockedExecSync).toHaveBeenCalledWith('rclone version');
		});

		it('should return "not_installed" when rclone command fails', () => {
			mockedExecSync.mockImplementation(() => {
				throw new Error('Command not found');
			});

			const version = getRcloneVersion();

			expect(version).toBe('not_installed');
		});

		it('should return "not_installed" when version pattern not found', () => {
			mockedExecSync.mockReturnValue(Buffer.from('some random output'));

			const version = getRcloneVersion();

			expect(version).toBe('not_installed');
		});

		it('should handle different rclone version formats', () => {
			const mockOutput = 'rclone v1.64.2\nSome other info';
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getRcloneVersion();

			expect(version).toBe('1.64.2');
		});

		it('should handle whitespace in output', () => {
			const mockOutput = '  rclone v1.66.0  \n\n';
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getRcloneVersion();

			expect(version).toBe('1.66.0');
		});

		it('should extract version from multiline output', () => {
			const mockOutput = `rclone v1.65.1
- os/arch: linux/amd64
- go version: go1.21.4`;
			mockedExecSync.mockReturnValue(Buffer.from(mockOutput));

			const version = getRcloneVersion();

			expect(version).toBe('1.65.1');
		});
	});
});
