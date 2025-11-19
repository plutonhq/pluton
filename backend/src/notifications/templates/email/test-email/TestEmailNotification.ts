import { configService } from '../../../../services/ConfigService';
import { INTEGRATIONS_AVAILABLE, IntegrationTypes } from '../../../../types/settings';
import { BaseNotification } from '../../../BaseNotification';

export class TestEmailNotification extends BaseNotification {
	integrationName = '';
	constructor(data: { integrationType: IntegrationTypes; appTitle: string }) {
		super();
		const integrationType = data.integrationType;
		this.integrationName = INTEGRATIONS_AVAILABLE[integrationType].name;
		this.subject = `${this.integrationName} Integration Successful`;
		this.content = this.buildContent(data);
	}
	protected buildContent(data: { integrationType: IntegrationTypes; appTitle: string }): string {
		// Generate the Email Body
		const content = `
        <div class="center">
          <h2>${this.integrationName} Integration Successful</h2>
          <p>${configService.config.APP_TITLE || 'Pluton'} can successfully send notifications using ${this.integrationName}</p>
        </div>
      `;
		return this.applyEmailTemplate(content, {
			appTitle: data.appTitle,
			preHeader: `${configService.config.APP_TITLE || 'Pluton'} can successfully send notifications using ${this.integrationName}`,
		});
	}
}
