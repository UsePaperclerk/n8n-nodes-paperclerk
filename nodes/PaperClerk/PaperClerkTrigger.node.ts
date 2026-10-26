import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { paperClerkRequest } from './GenericFunctions';
import type { ApiResponse } from './GenericFunctions';

interface GenerationSummary extends IDataObject {
	id: string;
	created_at: string;
}

interface GenerationList {
	generations: GenerationSummary[];
	has_more: boolean;
	next_cursor: string | null;
}

interface PollState {
	/** The newest creation time seen so far. */
	since?: string;
	/** Documents already emitted inside the overlap window: id to created_at. */
	seen?: Record<string, string>;
}

// Each poll asks again for a short window before the newest document it
// has seen, so a document whose row became visible a moment late is still
// caught; the ids seen in that window keep it from firing twice.
const OVERLAP_MS = 2 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

const time = (iso: string) => Date.parse(iso);

export class PaperClerkTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PaperClerk Trigger',
		name: 'paperClerkTrigger',
		icon: { light: 'file:paperclerk.svg', dark: 'file:paperclerk.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'Document generated',
		description: 'Starts the workflow when a document is generated in PaperClerk',
		defaults: {
			name: 'PaperClerk Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'paperClerkApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Document Generated',
						value: 'documentGenerated',
						description:
							'A document is generated in PaperClerk, from ChatGPT or Claude, through the API or by n8n',
					},
				],
				default: 'documentGenerated',
			},
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTemplates' },
				default: '',
				description:
					'Only documents generated from this template. Leave it on All Templates to start for every document. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				options: [
					{
						name: 'All Sources',
						value: '',
					},
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
				default: '',
				description: 'Only documents generated this way',
			},
		],
	};

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const { body } = (await paperClerkRequest.call(this, 'GET', '/templates', {
					qs: { limit: PAGE_SIZE },
				})) as ApiResponse<{ templates: Array<{ id: string; title: string }> }>;
				const templates = body.templates
					.map((template) => ({ name: template.title, value: template.id }))
					.sort((a, b) => a.name.localeCompare(b.name));
				return [{ name: 'All Templates', value: '' }, ...templates];
			},
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const filters: IDataObject = {};
		const template = this.getNodeParameter('template', '') as string;
		const source = this.getNodeParameter('source', '') as string;
		if (template) filters.template = template;
		if (source) filters.source = source;

		if (this.getMode() === 'manual') {
			const { body } = (await paperClerkRequest.call(this, 'GET', '/generations', {
				qs: { ...filters, limit: 1 },
			})) as ApiResponse<GenerationList>;
			const latest = body.generations[0];
			if (!latest) {
				throw new NodeOperationError(this.getNode(), 'No generated documents match yet', {
					description:
						'Generate a document in PaperClerk, from ChatGPT or Claude, or through the API, then test this step again.',
				});
			}
			return [this.helpers.returnJsonArray([latest])];
		}

		const state = this.getWorkflowStaticData('node') as PollState;
		if (!state.since) {
			// First poll after activation: start from now, and count the
			// documents already inside the overlap window as seen, so turning
			// the workflow on never replays what came before it.
			const now = new Date().toISOString();
			const rows = await fetchSince.call(this, filters, time(now) - OVERLAP_MS);
			state.since = now;
			state.seen = Object.fromEntries(rows.map((row) => [row.id, row.created_at]));
			return null;
		}

		const rows = await fetchSince.call(this, filters, time(state.since) - OVERLAP_MS);
		const seen = state.seen ?? {};
		const fresh = rows.filter((row) => !seen[row.id]);

		let newest = state.since;
		for (const row of rows) {
			seen[row.id] = row.created_at;
			if (time(row.created_at) > time(newest)) newest = row.created_at;
		}
		const keepFrom = time(newest) - OVERLAP_MS;
		for (const [id, createdAt] of Object.entries(seen)) {
			if (time(createdAt) < keepFrom) delete seen[id];
		}
		state.since = newest;
		state.seen = seen;

		if (!fresh.length) return null;
		fresh.sort((a, b) => time(a.created_at) - time(b.created_at));
		return [this.helpers.returnJsonArray(fresh)];
	}
}

/** Every matching document created at or after `fromMs`, newest first. */
async function fetchSince(
	this: IPollFunctions,
	filters: IDataObject,
	fromMs: number,
): Promise<GenerationSummary[]> {
	const from = new Date(fromMs).toISOString();
	const rows: GenerationSummary[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const { body } = (await paperClerkRequest.call(this, 'GET', '/generations', {
			qs: { ...filters, from, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
		})) as ApiResponse<GenerationList>;
		rows.push(...body.generations);
		cursor = body.has_more ? body.next_cursor : null;
		pages += 1;
	} while (cursor && pages < MAX_PAGES);
	return rows;
}
