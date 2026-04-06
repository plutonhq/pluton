import { configService } from '../../../../services/ConfigService';
import { INTEGRATIONS_AVAILABLE, IntegrationTypes } from '../../../../types/settings';
import { BaseNotification } from '../../../BaseNotification';

export class TestNtfyNotification extends BaseNotification {
	integrationName = '';
	constructor(data: { integrationType: IntegrationTypes; appTitle: string }) {
		super();
		const integrationType = data.integrationType;
		this.integrationName = INTEGRATIONS_AVAILABLE[integrationType].name;
		this.subject = `${this.integrationName} Integration Successful`;
		this.content = this.buildContent(data);
	}
	protected buildContent(data: { integrationType: IntegrationTypes; appTitle: string }): string {
		return `${configService.config.APP_TITLE || 'Pluton'} can successfully send push notifications using ${this.integrationName}.`;
	}
}
