import type { INodeProperties } from 'n8n-workflow';
import { simplifyField, templateLocator } from './shared';

export const templateOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['template'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a saved template and the placeholders it fills',
				action: 'Get a template',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many saved templates',
				action: 'Get many templates',
			},
		],
		default: 'getAll',
	},
];

export const templateFields: INodeProperties[] = [
	{
		...templateLocator,
		displayOptions: { show: { resource: ['template'], operation: ['get'] } },
	},
	simplifyField({ resource: ['template'], operation: ['get'] }),
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		displayOptions: { show: { resource: ['template'], operation: ['getAll'] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['template'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice',
				description: 'Only templates whose title contains this text',
			},
		],
	},
];
