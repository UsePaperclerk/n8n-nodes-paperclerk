import type { INodeProperties } from 'n8n-workflow';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const SITE = 'https?://(?:www\\.)?usepaperclerk\\.com/(?:[a-z]{2}/)?';

export const TEMPLATE_URL_REGEX = `${SITE}app/documents/(${UUID})`;
export const DOCUMENT_URL_REGEX = `${SITE}app/generated/(${UUID})`;
export const UUID_REGEX = `^${UUID}$`;

/** A saved template: from the list, by its PaperClerk URL, or by ID. */
export const templateLocator: INodeProperties = {
	displayName: 'Template',
	name: 'template',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'A saved template in the workspace the API key opens',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a template...',
			typeOptions: {
				searchListMethod: 'searchTemplates',
				searchable: true,
			},
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'e.g. https://usepaperclerk.com/app/documents/8c1ca73a-...',
			extractValue: {
				type: 'regex',
				regex: TEMPLATE_URL_REGEX,
			},
			validation: [
				{
					type: 'regex',
					properties: {
						regex: TEMPLATE_URL_REGEX,
						errorMessage: 'Paste the address of a template page in PaperClerk',
					},
				},
			],
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 8c1ca73a-2f4e-4b8a-9d7e-1f2a3b4c5d6e',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: UUID_REGEX,
						errorMessage: 'A template ID looks like 8c1ca73a-2f4e-4b8a-9d7e-1f2a3b4c5d6e',
					},
				},
			],
		},
	],
};

/** A generated document: from the list, by its PaperClerk URL, or by ID. */
export const documentLocator: INodeProperties = {
	displayName: 'Document',
	name: 'document',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'A document generated in PaperClerk',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a document...',
			typeOptions: {
				searchListMethod: 'searchDocuments',
				searchable: true,
			},
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'e.g. https://usepaperclerk.com/app/generated/3f1c7a52-...',
			extractValue: {
				type: 'regex',
				regex: DOCUMENT_URL_REGEX,
			},
			validation: [
				{
					type: 'regex',
					properties: {
						regex: DOCUMENT_URL_REGEX,
						errorMessage: 'Paste the address of a document page in PaperClerk',
					},
				},
			],
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3f1c7a52-9b0e-4c6d-8a1f-2e3d4c5b6a79',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: UUID_REGEX,
						errorMessage: 'A document ID looks like 3f1c7a52-9b0e-4c6d-8a1f-2e3d4c5b6a79',
					},
				},
			],
		},
	],
};

export const simplifyField = (show: Record<string, string[]>): INodeProperties => ({
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	displayOptions: { show },
	description: 'Whether to return a simplified version of the response instead of the raw data',
});
