import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** A placeholder as `GET /templates/{id}` reports it. */
export interface PlaceholderInfo {
	label: string;
	key: string;
	type: string;
	format?: string;
	options?: string[];
	auto?: boolean;
	value?: string;
	description?: string;
}

/** A repeating section: its key takes a list of rows keyed by its fields. */
export interface GroupInfo {
	label: string;
	key: string;
	fields: PlaceholderInfo[];
}

export interface TemplateInfo extends IDataObject {
	id: string;
	title: string;
	placeholders: PlaceholderInfo[];
	groups: GroupInfo[];
}

export interface BuildOptions {
	/** Send empty values, which clears the template's default for them. */
	keepEmpty: boolean;
	/** Skip names that match no placeholder (automatic mapping of whole items). */
	dropUnknown: boolean;
}

type Slot =
	| { kind: 'placeholder'; key: string; label: string; placeholder: PlaceholderInfo }
	| { kind: 'group'; key: string; label: string; group: GroupInfo };

/**
 * PaperClerk's key rule: lowercase, letters and digits of any script,
 * everything else collapsed to one underscore, none at the ends.
 */
export function slugKey(name: string): string {
	return String(name ?? '')
		.normalize('NFC')
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
		.replace(/^_+|_+$/g, '');
}

/**
 * Finds the entry an incoming name means, the way the API resolves values:
 * the exact key first, then the label, then the name's own key form, so
 * "client_name", "Client name" and "Client Name" all land on one slot.
 */
class NameIndex<T extends { key: string; label: string }> {
	private readonly byName = new Map<string, T>();

	constructor(entries: T[]) {
		const passes: Array<(entry: T) => string> = [
			(entry) => entry.key,
			(entry) => entry.label,
			(entry) => entry.label.toLowerCase(),
			(entry) => slugKey(entry.label),
		];
		for (const nameOf of passes) {
			for (const entry of entries) {
				const name = nameOf(entry);
				if (name && !this.byName.has(name)) this.byName.set(name, entry);
			}
		}
	}

	find(name: string): T | undefined {
		return (
			this.byName.get(name) ?? this.byName.get(name.toLowerCase()) ?? this.byName.get(slugKey(name))
		);
	}
}

/**
 * The `values` object for a generate request, built from whatever the
 * person mapped or sent: keyed by placeholder key, automatic placeholders
 * left out (PaperClerk fills them), empty values left out unless
 * `keepEmpty`, dates written in the shape the template asks for, and each
 * repeating section turned into a list of rows.
 */
export function buildValues(
	input: IDataObject,
	template: TemplateInfo,
	options: BuildOptions,
	node: INode,
	itemIndex: number,
): IDataObject {
	const slots: Slot[] = [
		...template.placeholders.map(
			(placeholder): Slot => ({
				kind: 'placeholder',
				key: placeholder.key,
				label: placeholder.label,
				placeholder,
			}),
		),
		...template.groups.map(
			(group): Slot => ({ kind: 'group', key: group.key, label: group.label, group }),
		),
	];
	const index = new NameIndex(slots);
	const values: IDataObject = {};

	for (const [name, raw] of Object.entries(input ?? {})) {
		const slot = index.find(name);
		if (!slot) {
			// Unknown names go through as sent, so PaperClerk can answer with
			// the template's real keys; whole-item mapping skips them instead.
			if (!options.dropUnknown && raw !== undefined && raw !== null) values[name] = raw;
			continue;
		}
		if (slot.kind === 'group') {
			const rows = toRows(raw, slot.group, node, itemIndex);
			if (rows === undefined) continue;
			values[slot.key] = rows.map((row, rowIndex) =>
				buildRow(row, slot.group, options, node, itemIndex, rowIndex),
			);
			continue;
		}
		if (slot.placeholder.auto) continue;
		const value = toScalar(raw, slot.placeholder, options, node, itemIndex);
		if (value !== undefined) values[slot.key] = value;
	}
	return values;
}

function buildRow(
	row: IDataObject,
	group: GroupInfo,
	options: BuildOptions,
	node: INode,
	itemIndex: number,
	rowIndex: number,
): IDataObject {
	const index = new NameIndex(group.fields);
	const out: IDataObject = {};
	for (const [name, raw] of Object.entries(row)) {
		const field = index.find(name);
		if (!field) {
			if (!options.dropUnknown && raw !== undefined && raw !== null) out[name] = raw;
			continue;
		}
		if (field.auto) continue;
		const value = toScalar(raw, field, options, node, itemIndex, `${group.label} row ${rowIndex + 1}`);
		if (value !== undefined) out[field.key] = value;
	}
	return out;
}

function toRows(
	raw: unknown,
	group: GroupInfo,
	node: INode,
	itemIndex: number,
): IDataObject[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	let list: unknown = raw;
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (!text) return undefined;
		try {
			list = JSON.parse(text);
		} catch {
			list = undefined;
		}
	}
	if (!Array.isArray(list) || list.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
		throw new NodeOperationError(node, `'${group.label}' needs a list of rows`, {
			itemIndex,
			description: `Send an array of objects keyed by the section's fields, for example [{"${
				group.fields[0]?.key ?? 'field'
			}": "..."}]. Its fields are: ${group.fields.map((field) => field.key).join(', ')}.`,
		});
	}
	return list as IDataObject[];
}

function toScalar(
	raw: unknown,
	placeholder: PlaceholderInfo,
	options: BuildOptions,
	node: INode,
	itemIndex: number,
	where?: string,
): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === 'string' && raw.trim() === '') return options.keepEmpty ? '' : undefined;
	if (placeholder.type === 'date') return formatDateInput(raw, placeholder.format);
	if (typeof raw === 'object') {
		const iso = isoDay(raw);
		if (iso) return iso;
		throw new NodeOperationError(
			node,
			`'${placeholder.label}'${where ? ` in ${where}` : ''} needs a single value, not a list or an object`,
			{ itemIndex },
		);
	}
	return String(raw);
}

// ── dates ────────────────────────────────────────────────────────────
//
// A date placeholder carries its format as an example of the reference
// date 2026-08-27 written that way ('08/27/2026', '27.08.2026',
// 'August 27, 2026'; none means ISO). PaperClerk stores what it is sent,
// so the node writes a date in the template's own shape before sending
// it. These are PaperClerk's own rules: day 27 cannot be a month, so the
// digit order is unambiguous; the day pads when the month does; month and
// weekday names are English.

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type DateToken = 'y' | 'm2' | 'm1' | 'mn' | 'ma' | 'd' | 'do' | 'wn' | 'wa';
type PatternPart = { literal: string } | { token: DateToken };

const TOKEN_RULES: Array<{ test: RegExp; token: DateToken; length: number; part: 'y' | 'm' | 'd' | 'w' }> = [
	{ test: /^2026/, token: 'y', length: 4, part: 'y' },
	{ test: /^thursday/i, token: 'wn', length: 8, part: 'w' },
	{ test: /^thu/i, token: 'wa', length: 3, part: 'w' },
	{ test: /^august/i, token: 'mn', length: 6, part: 'm' },
	{ test: /^aug/i, token: 'ma', length: 3, part: 'm' },
	{ test: /^27(st|nd|rd|th)/i, token: 'do', length: 4, part: 'd' },
	{ test: /^27/, token: 'd', length: 2, part: 'd' },
	{ test: /^08/, token: 'm2', length: 2, part: 'm' },
	{ test: /^8/, token: 'm1', length: 1, part: 'm' },
];

/** A format example as tokens, or null when it is not a full date. */
function parseDatePattern(example: string | undefined): PatternPart[] | null {
	if (typeof example !== 'string' || !example.trim()) return null;
	const text = example.trim();
	const parts: PatternPart[] = [];
	const seen = { y: 0, m: 0, d: 0, w: 0 };
	let literal = '';
	let i = 0;
	while (i < text.length) {
		const rest = text.slice(i);
		const rule = TOKEN_RULES.find((candidate) => candidate.test.test(rest));
		if (rule) {
			if (literal) parts.push({ literal });
			literal = '';
			parts.push({ token: rule.token });
			seen[rule.part] += 1;
			i += rule.length;
		} else {
			literal += text[i];
			i += 1;
		}
	}
	if (literal) parts.push({ literal });
	if (seen.w > 1 || seen.y !== 1 || seen.m !== 1 || seen.d !== 1) return null;
	return parts;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const ordinal = (day: number) => {
	const tens = day % 100;
	if (tens >= 11 && tens <= 13) return 'th';
	const unit = day % 10;
	return unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th';
};

function isRealDate(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The calendar day a value names, as YYYY-MM-DD, or null. */
export function isoDay(value: unknown): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
	}
	if (value && typeof value === 'object') {
		const candidate = value as { toISODate?: () => string | null; toISO?: () => string | null };
		if (typeof candidate.toISODate === 'function') return isoDay(candidate.toISODate());
		if (typeof candidate.toISO === 'function') return isoDay(candidate.toISO());
		return null;
	}
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(value.trim());
	if (!match) return null;
	const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
	return isRealDate(y, m, d) ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** A YYYY-MM-DD day written the way the format example shows. */
export function formatDateValue(iso: string, example: string | undefined): string {
	const [y, m, d] = iso.split('-').map(Number);
	const pattern = parseDatePattern(example);
	if (!pattern) return iso;
	const padDay = pattern.some((part) => 'token' in part && part.token === 'm2');
	const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return pattern
		.map((part) => {
			if ('literal' in part) return part.literal;
			switch (part.token) {
				case 'y':
					return String(y);
				case 'm2':
					return pad2(m);
				case 'm1':
					return String(m);
				case 'mn':
					return MONTHS[m - 1];
				case 'ma':
					return MONTHS[m - 1].slice(0, 3);
				case 'wn':
					return weekday;
				case 'wa':
					return weekday.slice(0, 3);
				case 'do':
					return String(d) + ordinal(d);
				default:
					return padDay ? pad2(d) : String(d);
			}
		})
		.join('');
}

/**
 * A date placeholder's value: anything that names a calendar day (an ISO
 * date or date-time, an n8n date, a JavaScript date) is written in the
 * template's format; anything else is sent as typed, on the assumption it
 * is already in that format.
 */
export function formatDateInput(raw: unknown, format: string | undefined): string {
	const iso = isoDay(raw);
	if (iso) return formatDateValue(iso, format);
	return typeof raw === 'string' ? raw.trim() : String(raw);
}
