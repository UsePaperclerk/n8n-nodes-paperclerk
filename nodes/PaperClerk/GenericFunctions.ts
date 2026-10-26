import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const APP_URL = 'https://usepaperclerk.com';
export const API_URL = `${APP_URL}/api/v1`;
const USER_AGENT = 'n8n-nodes-paperclerk';

export type PaperClerkContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

/** The one error shape every PaperClerk API route answers with. */
export interface ApiErrorBody {
	error?: { code?: string; message?: string; detail?: string };
}

export interface ApiResponse<T> {
	statusCode: number;
	body: T;
}

interface RequestOptions {
	qs?: IDataObject;
	body?: IDataObject;
	headers?: IDataObject;
	itemIndex?: number;
	/** Statuses the caller handles itself instead of having them thrown. */
	allowStatus?: number[];
}

/**
 * One call to the PaperClerk REST API with the workspace API key. Answers
 * of 400 and above become a NodeApiError worded for the person reading the
 * execution, unless the caller listed the status in `allowStatus`.
 */
export async function paperClerkRequest<T = IDataObject>(
	this: PaperClerkContext,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<ApiResponse<T>> {
	const request: IHttpRequestOptions = {
		method,
		url: `${API_URL}${path}`,
		headers: {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
			...(options.headers ?? {}),
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.qs) request.qs = options.qs;
	if (options.body) request.body = options.body;

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'paperClerkApi',
		request,
	)) as { statusCode: number; body: T };

	if (response.statusCode >= 400 && !(options.allowStatus ?? []).includes(response.statusCode)) {
		throw paperClerkError(
			this,
			response.statusCode,
			response.body as ApiErrorBody,
			options.itemIndex,
		);
	}
	return { statusCode: response.statusCode, body: response.body };
}

/** An API refusal, worded as what happened and what to do next. */
export function paperClerkError(
	context: PaperClerkContext,
	statusCode: number,
	body: ApiErrorBody | undefined,
	itemIndex?: number,
): NodeApiError {
	const code = body?.error?.code;
	const apiMessage = body?.error?.message;
	const detail = body?.error?.detail;
	let message: string;
	let description: string | undefined;

	if (statusCode === 401) {
		message = 'PaperClerk did not accept the API key';
		description =
			'Check the PaperClerk credential, or create a new key in PaperClerk under Connections. Owners and admins of a workspace can create keys.';
	} else if (statusCode === 402 || code === 'subscription_required') {
		message = 'This PaperClerk workspace has no active plan';
		description = `Choose a plan at ${APP_URL}/app/billing, then run the workflow again.`;
	} else if (statusCode === 404) {
		message = apiMessage ?? 'Not found in this PaperClerk workspace';
		description =
			'An API key opens exactly one workspace. Check that the template or document belongs to the workspace the key was created in.';
	} else {
		message = apiMessage ?? `PaperClerk answered with HTTP ${statusCode}`;
		description = detail ? `Field: ${detail}` : undefined;
	}

	return new NodeApiError(context.getNode(), (body ?? {}) as JsonObject, {
		message,
		description,
		httpCode: String(statusCode),
		itemIndex,
	});
}

/** A PDF ready for the output item, and its page count. */
export interface DownloadedPdf {
	binary: IBinaryData;
	pages: number | null;
}

interface PdfAnswer extends ApiErrorBody {
	status?: string;
	url?: string;
	pages?: number | null;
}

/**
 * Waits for a generated document's PDF and downloads it. PaperClerk renders
 * every PDF on its own servers right after the document is created, usually
 * within a few seconds; this asks again with a growing pause until the file
 * is ready or `waitSeconds` runs out. A failed render is retried once,
 * because asking again starts a new render.
 */
export async function downloadPdf(
	this: IExecuteFunctions,
	generationId: string,
	title: string,
	waitSeconds: number,
	itemIndex: number,
): Promise<DownloadedPdf> {
	const deadline = Date.now() + Math.max(1, waitSeconds) * 1000;
	let pause = 500;
	let retriedRender = false;

	for (;;) {
		const { statusCode, body } = (await paperClerkRequest.call(
			this,
			'GET',
			`/generations/${encodeURIComponent(generationId)}/pdf`,
			{ itemIndex, allowStatus: [202, 500] },
		)) as ApiResponse<PdfAnswer>;

		if (statusCode === 200 && body.url) {
			const file = (await this.helpers.httpRequest({
				method: 'GET',
				url: body.url,
				encoding: 'arraybuffer',
				json: false,
			})) as Buffer;
			const binary = await this.helpers.prepareBinaryData(
				Buffer.from(file),
				pdfFileName(title),
				'application/pdf',
			);
			return { binary, pages: body.pages ?? null };
		}

		if (statusCode === 500) {
			if (body?.error?.code === 'pdf_render_failed' && !retriedRender) {
				retriedRender = true;
				continue;
			}
			throw paperClerkError(this, statusCode, body, itemIndex);
		}

		if (Date.now() + pause > deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`The PDF was still being prepared after ${waitSeconds} seconds`,
				{
					itemIndex,
					description:
						"Raise 'Wait Timeout (Seconds)' under Options, or download it later with the Download PDF operation.",
				},
			);
		}
		await sleep(pause);
		pause = Math.min(pause * 2, 4000);
	}
}

/** A file name for the PDF from the document's title. */
export function pdfFileName(title: string): string {
	const cleaned = String(title ?? '')
		.replace(/\p{Cc}/gu, '')
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 150)
		.trim();
	return `${cleaned || 'document'}.pdf`;
}

const GENERATION_FIELDS = [
	'id',
	'title',
	'generation_number',
	'template_id',
	'template_title',
	'source',
	'created_at',
	'created_by_name',
	'url',
	'pdf_status',
	'replayed',
];

/** The fields people use in the next node; drops the Markdown and HTML. */
export function simplifyGeneration(generation: IDataObject): IDataObject {
	const simplified: IDataObject = {};
	for (const field of GENERATION_FIELDS) {
		if (generation[field] !== undefined) simplified[field] = generation[field];
	}
	return simplified;
}

const TEMPLATE_FIELDS = ['id', 'title', 'generation_count', 'updated_at', 'placeholders', 'groups'];

/** A template's inventory without the Markdown and HTML preview. */
export function simplifyTemplate(template: IDataObject): IDataObject {
	const simplified: IDataObject = {};
	for (const field of TEMPLATE_FIELDS) {
		if (template[field] !== undefined) simplified[field] = template[field];
	}
	return simplified;
}
