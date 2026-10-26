import type { INodeProperties } from 'n8n-workflow';
import { documentLocator, simplifyField, templateLocator } from './shared';

export const documentOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['document'] } },
		options: [
			{
				name: 'Download PDF',
				value: 'downloadPdf',
				description: 'Download the PDF of a generated document',
				action: 'Download the PDF of a document',
			},
			{
				name: 'Generate',
				value: 'generate',
				description: 'Fill a saved template and generate a document with its PDF',
				action: 'Generate a document',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a generated document',
				action: 'Get a document',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many generated documents',
				action: 'Get many documents',
			},
		],
		default: 'generate',
	},
];

const generate = { resource: ['document'], operation: ['generate'] };

const generateFields: INodeProperties[] = [
	{
		...templateLocator,
		displayOptions: { show: generate },
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		placeholder: 'e.g. Invoice for Maple & Fern, October',
		description:
			"Name for the generated document. Leave it empty to use the template's title and number, such as 'Invoice #12'.",
		displayOptions: { show: generate },
	},
	{
		displayName: 'Values Input',
		name: 'inputMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Map Placeholders',
				value: 'map',
				description: "Fill each of the template's placeholders from a field or a typed value",
			},
			{
				name: 'JSON',
				value: 'json',
				description: 'Send one object keyed by placeholder key',
			},
		],
		default: 'map',
		displayOptions: { show: generate },
	},
	{
		displayName: 'Placeholders',
		name: 'placeholders',
		type: 'resourceMapper',
		noDataExpression: true,
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['template.value'],
			resourceMapper: {
				resourceMapperMethod: 'getPlaceholderColumns',
				mode: 'add',
				fieldWords: {
					singular: 'placeholder',
					plural: 'placeholders',
				},
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: true,
				noFieldsError: 'This template has no placeholders to fill',
			},
		},
		displayOptions: { show: { ...generate, inputMode: ['map'] } },
	},
	{
		displayName: 'Values (JSON)',
		name: 'valuesJson',
		type: 'json',
		default: '{\n  "client_name": "Maple & Fern Ltd.",\n  "line_items": [\n    { "item": "Brand identity", "quantity": "1", "amount": "4800" }\n  ]\n}',
		description:
			'An object keyed by placeholder key, as Get Template lists them. A repeating section takes a list of rows keyed by its field keys. Keys you leave out keep the template\'s defaults.',
		displayOptions: { show: { ...generate, inputMode: ['json'] } },
	},
	simplifyField(generate),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: generate },
		options: [
			{
				displayName: 'Clear Empty Placeholders',
				name: 'clearEmpty',
				type: 'boolean',
				default: false,
				description:
					"Whether a placeholder left empty clears the template's default value. When off, an empty placeholder keeps the default.",
			},
			{
				displayName: 'Download PDF',
				name: 'downloadPdf',
				type: 'boolean',
				default: true,
				description: 'Whether to wait for the PDF and attach it to the output item',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice-for-order-1042',
				description:
					'A repeat of this key within 24 hours returns the document the first request made instead of generating another. Without one, an identical request within 10 minutes is already treated as a retry.',
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'The name of the output binary field to put the PDF in',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeout',
				type: 'number',
				typeOptions: { minValue: 5, maxValue: 300 },
				default: 60,
				description: 'How long to wait for the PDF. It is usually ready within a few seconds.',
			},
		],
	},
];

const single = (operation: string) => ({ resource: ['document'], operation: [operation] });

const getFields: INodeProperties[] = [
	{
		...documentLocator,
		displayOptions: { show: single('get') },
	},
	simplifyField(single('get')),
];

const downloadFields: INodeProperties[] = [
	{
		...documentLocator,
		displayOptions: { show: single('downloadPdf') },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: single('downloadPdf') },
		options: [
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'The name of the output binary field to put the PDF in',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeout',
				type: 'number',
				typeOptions: { minValue: 5, maxValue: 300 },
				default: 60,
				description: 'How long to wait if the PDF is still being prepared',
			},
		],
	},
];

const getAllFields: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: single('getAll') },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...single('getAll'), returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: single('getAll') },
		options: [
			{
				displayName: 'Created After',
				name: 'from',
				type: 'dateTime',
				default: '',
				description: 'Only documents created at or after this moment',
			},
			{
				displayName: 'Created Before',
				name: 'to',
				type: 'dateTime',
				default: '',
				description: 'Only documents created before this moment',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				placeholder: 'e.g. Maple',
				description: 'Only documents whose title contains this text',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				options: [
					{
						name: 'API',
						value: 'api',
						description: 'Generated through the API, n8n, ChatGPT or Claude',
					},
					{
						name: 'App',
						value: 'app',
						description: 'Generated in PaperClerk itself',
					},
				],
				default: 'api',
				description: 'Only documents generated this way',
			},
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTemplates' },
				default: '',
				description:
					'Only documents generated from this template. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
	simplifyField(single('getAll')),
];

export const documentFields: INodeProperties[] = [
	...generateFields,
	...getFields,
	...downloadFields,
	...getAllFields,
];
