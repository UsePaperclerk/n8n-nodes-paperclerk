import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { documentFields, documentOperations } from './descriptions/document';
import { templateFields, templateOperations } from './descriptions/template';
import {
	APP_URL,
	downloadPdf,
	paperClerkRequest,
	simplifyGeneration,
	simplifyTemplate,
} from './GenericFunctions';
import type { ApiResponse } from './GenericFunctions';
import type { TemplateInfo } from './values';
import { buildValues } from './values';

interface TemplateSummary extends IDataObject {
	id: string;
	title: string;
	folder_path?: string;
}

interface TemplateList extends IDataObject {
	templates: TemplateSummary[];
	total: number;
	truncated: boolean;
}

interface Generation extends IDataObject {
	id: string;
	title: string;
}

interface GenerationList extends IDataObject {
	generations: Generation[];
	has_more: boolean;
	next_cursor: string | null;
}

const PAGE_MAX = 200;

async function getTemplate(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	templateId: string,
	itemIndex?: number,
): Promise<TemplateInfo> {
	const { body } = (await paperClerkRequest.call(
		this,
		'GET',
		`/templates/${encodeURIComponent(templateId)}`,
		{ itemIndex },
	)) as ApiResponse<TemplateInfo>;
	return body;
}

export class PaperClerk implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PaperClerk',
		name: 'paperClerk',
		icon: { light: 'file:paperclerk.svg', dark: 'file:paperclerk.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Generate PDF documents from your own templates in PaperClerk',
		defaults: {
			name: 'PaperClerk',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'paperClerkApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Document',
						value: 'document',
					},
					{
						name: 'Template',
						value: 'template',
					},
				],
				default: 'document',
			},
			...documentOperations,
			...documentFields,
			...templateOperations,
			...templateFields,
		],
	};

	methods = {
		listSearch: {
			async searchTemplates(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const qs: IDataObject = { limit: PAGE_MAX };
				if (filter) qs.search = filter;
				const { body } = (await paperClerkRequest.call(this, 'GET', '/templates', {
					qs,
				})) as ApiResponse<TemplateList>;
				return {
					results: body.templates.map((template) => ({
						name: template.folder_path
							? `${template.title} (${template.folder_path})`
							: template.title,
						value: template.id,
						url: `${APP_URL}/app/documents/${template.id}`,
					})),
				};
			},

			async searchDocuments(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const qs: IDataObject = { limit: 50 };
				if (filter) qs.search = filter;
				if (paginationToken) qs.cursor = paginationToken;
				const { body } = (await paperClerkRequest.call(this, 'GET', '/generations', {
					qs,
				})) as ApiResponse<GenerationList>;
				return {
					results: body.generations.map((generation) => ({
						name: generation.title,
						value: generation.id,
						url: `${APP_URL}/app/generated/${generation.id}`,
					})),
					paginationToken: body.has_more && body.next_cursor ? body.next_cursor : undefined,
				};
			},
		},

		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const { body } = (await paperClerkRequest.call(this, 'GET', '/templates', {
					qs: { limit: PAGE_MAX },
				})) as ApiResponse<TemplateList>;
				return body.templates
					.map((template) => ({ name: template.title, value: template.id }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},

		resourceMapping: {
			async getPlaceholderColumns(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				let templateId = '';
				try {
					templateId = String(
						this.getNodeParameter('template', undefined, { extractValue: true }) ?? '',
					);
				} catch {
					templateId = '';
				}
				if (!templateId) {
					// The editor resolves expressions before asking, so a template set
					// by an expression that reads an earlier node arrives empty too.
					return {
						fields: [],
						emptyFieldsNotice:
							'Choose a template to see its placeholders. A template set by an expression is read when the workflow runs.',
					};
				}
				const template = await getTemplate.call(this, templateId);
				const fields: ResourceMapperField[] = [];
				for (const placeholder of template.placeholders) {
					// Automatic placeholders (today's date, a running number) are
					// filled by PaperClerk itself, so there is nothing to map.
					if (placeholder.auto) continue;
					const field: ResourceMapperField = {
						id: placeholder.key,
						displayName: placeholder.label,
						required: false,
						defaultMatch: false,
						canBeUsedToMatch: false,
						display: true,
						type: 'string',
					};
					if (placeholder.type === 'select' && placeholder.options?.length) {
						field.type = 'options';
						field.options = placeholder.options.map((option) => ({ name: option, value: option }));
					}
					fields.push(field);
				}
				for (const group of template.groups) {
					fields.push({
						id: group.key,
						displayName: `${group.label} (list of rows)`,
						required: false,
						defaultMatch: false,
						canBeUsedToMatch: false,
						display: true,
						type: 'array',
					});
				}
				// The editor shows emptyFieldsNotice whenever it is not drawing the
				// field list, Map Automatically included, so it is only sent when
				// the template really has nothing to fill.
				if (!fields.length) {
					return { fields, emptyFieldsNotice: 'This template has no placeholders to fill' };
				}
				return { fields };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const templates = new Map<string, TemplateInfo>();

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'template' && operation === 'getAll') {
					const limit = this.getNodeParameter('limit', i) as number;
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const qs: IDataObject = { limit: Math.min(Math.max(1, limit), PAGE_MAX) };
					if (filters.search) qs.search = filters.search;
					const { body } = (await paperClerkRequest.call(this, 'GET', '/templates', {
						qs,
						itemIndex: i,
					})) as ApiResponse<TemplateList>;
					for (const template of body.templates) {
						returnData.push({ json: template, pairedItem: { item: i } });
					}
				} else if (resource === 'template' && operation === 'get') {
					const templateId = this.getNodeParameter('template', i, '', {
						extractValue: true,
					}) as string;
					const simplify = this.getNodeParameter('simplify', i) as boolean;
					const template = await getTemplate.call(this, templateId, i);
					returnData.push({
						json: simplify ? simplifyTemplate(template) : template,
						pairedItem: { item: i },
					});
				} else if (resource === 'document' && operation === 'generate') {
					returnData.push(await generate.call(this, i, items[i].json, templates));
				} else if (resource === 'document' && operation === 'get') {
					const documentId = this.getNodeParameter('document', i, '', {
						extractValue: true,
					}) as string;
					const simplify = this.getNodeParameter('simplify', i) as boolean;
					const { body } = (await paperClerkRequest.call(
						this,
						'GET',
						`/generations/${encodeURIComponent(documentId)}`,
						{ itemIndex: i },
					)) as ApiResponse<Generation>;
					returnData.push({
						json: simplify ? simplifyGeneration(body) : body,
						pairedItem: { item: i },
					});
				} else if (resource === 'document' && operation === 'downloadPdf') {
					const documentId = this.getNodeParameter('document', i, '', {
						extractValue: true,
					}) as string;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const { body } = (await paperClerkRequest.call(
						this,
						'GET',
						`/generations/${encodeURIComponent(documentId)}`,
						{ itemIndex: i },
					)) as ApiResponse<Generation>;
					const pdf = await downloadPdf.call(
						this,
						body.id,
						body.title,
						Number(options.waitTimeout ?? 60),
						i,
					);
					returnData.push({
						json: { ...simplifyGeneration(body), pdf_status: 'ready', pdf_pages: pdf.pages },
						binary: { [String(options.binaryPropertyName || 'data')]: pdf.binary },
						pairedItem: { item: i },
					});
				} else if (resource === 'document' && operation === 'getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const simplify = this.getNodeParameter('simplify', i) as boolean;
					const qs: IDataObject = {};
					for (const name of ['from', 'to', 'search', 'source', 'template']) {
						if (filters[name]) qs[name] = filters[name];
					}
					const found: Generation[] = [];
					let cursor: string | null = null;
					do {
						const pageSize = Math.min(PAGE_MAX, limit - found.length);
						const { body } = (await paperClerkRequest.call(this, 'GET', '/generations', {
							qs: { ...qs, limit: pageSize, ...(cursor ? { cursor } : {}) },
							itemIndex: i,
						})) as ApiResponse<GenerationList>;
						found.push(...body.generations);
						cursor = body.has_more ? body.next_cursor : null;
					} while (cursor && found.length < limit);
					for (const generation of found.slice(0, limit)) {
						returnData.push({
							json: simplify ? simplifyGeneration(generation) : generation,
							pairedItem: { item: i },
						});
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation '${operation}' is not supported for '${resource}'`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Both constructors hand back an error that is already theirs, so
				// the message PaperClerk gave survives; anything else is wrapped.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/** Document > Generate for one input item. */
async function generate(
	this: IExecuteFunctions,
	itemIndex: number,
	itemJson: IDataObject,
	templates: Map<string, TemplateInfo>,
): Promise<INodeExecutionData> {
	const templateId = this.getNodeParameter('template', itemIndex, '', {
		extractValue: true,
	}) as string;
	let template = templates.get(templateId);
	if (!template) {
		template = await getTemplate.call(this, templateId, itemIndex);
		templates.set(templateId, template);
	}

	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const inputMode = this.getNodeParameter('inputMode', itemIndex) as string;
	let input: IDataObject;
	let dropUnknown = false;
	if (inputMode === 'json') {
		const raw = this.getNodeParameter('valuesJson', itemIndex, '{}');
		input = parseJsonObject.call(this, raw, itemIndex);
	} else {
		const mappingMode = this.getNodeParameter('placeholders.mappingMode', itemIndex) as string;
		if (mappingMode === 'autoMapInputData') {
			// The whole incoming item: fields that match a placeholder by key or
			// label are sent, the rest of the item is left out.
			input = itemJson;
			dropUnknown = true;
		} else {
			input = (this.getNodeParameter('placeholders.value', itemIndex, {}) ?? {}) as IDataObject;
		}
	}

	const values = buildValues(
		input,
		template,
		{ keepEmpty: options.clearEmpty === true, dropUnknown },
		this.getNode(),
		itemIndex,
	);
	const body: IDataObject = { values };
	const title = String(this.getNodeParameter('title', itemIndex, '') ?? '').trim();
	if (title) body.title = title;
	const headers: IDataObject = {};
	const idempotencyKey = String(options.idempotencyKey ?? '').trim();
	if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

	const { body: generation } = (await paperClerkRequest.call(
		this,
		'POST',
		`/templates/${encodeURIComponent(templateId)}/generations`,
		{ body, headers, itemIndex },
	)) as ApiResponse<Generation>;

	const simplify = this.getNodeParameter('simplify', itemIndex) as boolean;
	const item: INodeExecutionData = {
		json: simplify ? simplifyGeneration(generation) : generation,
		pairedItem: { item: itemIndex },
	};
	if (options.downloadPdf !== false) {
		const pdf = await downloadPdf.call(
			this,
			generation.id,
			generation.title,
			Number(options.waitTimeout ?? 60),
			itemIndex,
		);
		item.json.pdf_status = 'ready';
		item.json.pdf_pages = pdf.pages;
		item.binary = { [String(options.binaryPropertyName || 'data')]: pdf.binary };
	}
	return item;
}

function parseJsonObject(this: IExecuteFunctions, raw: unknown, itemIndex: number): IDataObject {
	let value = raw;
	if (typeof raw === 'string') {
		try {
			value = raw.trim() ? JSON.parse(raw) : {};
		} catch {
			throw new NodeOperationError(this.getNode(), "'Values (JSON)' is not valid JSON", {
				itemIndex,
				description: 'Check the brackets, commas and quotes, or switch Values Input to Map Placeholders.',
			});
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NodeOperationError(this.getNode(), "'Values (JSON)' must be an object", {
			itemIndex,
			description: 'Send one object keyed by placeholder key, for example {"client_name": "Maple & Fern"}.',
		});
	}
	return value as IDataObject;
}
