import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PaperClerkApi implements ICredentialType {
	name = 'paperClerkApi';

	displayName = 'PaperClerk API';

	icon: Icon = {
		light: 'file:../nodes/PaperClerk/paperclerk.svg',
		dark: 'file:../nodes/PaperClerk/paperclerk.dark.svg',
	};

	documentationUrl = 'https://github.com/UsePaperclerk/n8n-nodes-paperclerk#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. pc_...',
			description:
				'A workspace API key from Connections in PaperClerk. Owners and admins of a workspace can create one; it opens that workspace only.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://usepaperclerk.com/api/v1',
			url: '/templates',
			qs: { limit: 1 },
		},
	};
}
