# PaperClerk for n8n

[PaperClerk](https://usepaperclerk.com) turns the documents you already send (invoices, quotes, contracts, letters) into templates with fillable placeholders, and fills them into pixel-identical PDFs. This package adds two nodes to n8n:

- **PaperClerk**: generate a document from a saved template, download its PDF, and read your templates and documents.
- **PaperClerk Trigger**: start a workflow whenever a document is generated, in PaperClerk, from ChatGPT or Claude, through the API, or by n8n.

A typical workflow: a new row in Google Sheets, a form submission or a closed deal fills your own invoice or contract template, and the PDF goes out by email or into Drive.

## Installation

**Self-hosted n8n:** open **Settings > Community Nodes**, select **Install**, enter `@paperclerk/n8n-nodes-paperclerk`, and confirm. See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for the other ways to install.

**n8n Cloud:** only verified community nodes install there, from the nodes panel. This package is not verified yet, so for now it installs on self-hosted n8n only.

## Credentials

The node signs in with a PaperClerk workspace API key.

1. In PaperClerk, open **Connections** (`https://usepaperclerk.com/app/connections`). Owners and admins of a workspace can create keys.
2. Create a key, name it after the workflow or "n8n", and copy it. It is shown once.
3. In n8n, create a **PaperClerk API** credential and paste the key.

A key opens exactly one workspace, and acts with the access of the person who created it. Revoking the key in PaperClerk stops it at once.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| Document | **Generate** | Fills a saved template with your values and creates a document. By default it waits for the PDF and attaches it to the output item. |
| Document | **Download PDF** | Attaches the PDF of a generated document. |
| Document | **Get** | Returns one generated document. |
| Document | **Get Many** | Lists generated documents, newest first, filtered by template, source, date or title. |
| Template | **Get** | Returns a saved template and the placeholders it fills, with their keys. |
| Template | **Get Many** | Lists saved templates. |

Templates and documents can be chosen from a list, by their PaperClerk URL, or by ID.

## Filling a template

Choose a template, then fill its placeholders in one of two ways.

**Map Placeholders** (the default) lists every placeholder of the template as a field:

- *Map Each Column Manually*: type values or drag fields from earlier nodes into each placeholder.
- *Map Automatically*: incoming fields are matched to placeholders by key (`client_name`) or by label (`Client name`). Fields that match nothing are left out.

**JSON** sends one object keyed by placeholder key, the keys **Get Template** lists:

```json
{
  "client_name": "Maple & Fern Ltd.",
  "due_date": "2026-11-15",
  "line_items": [
    { "item": "Brand identity system", "quantity": "1", "amount": "4800" },
    { "item": "Brand guidelines", "quantity": "1", "amount": "1200" }
  ]
}
```

What happens to the values:

- **Repeating sections** (a line-items table, for example) take a list of rows, each keyed by the section's field keys. The template's row is repeated once per entry.
- **Dates** can be given as ISO dates (`2026-11-15`), ISO date-times or n8n dates such as `{{ $now }}`. The node writes them in the format the template asks for, such as `11/15/2026` or `15 November 2026`. Text that is not an ISO date is sent as typed.
- **Numbers** are written by PaperClerk in the template's number format, so `1234.5` can become `1,234.50`.
- **Dropdowns** must match one of the template's options exactly.
- **Automatic placeholders** (today's date, running numbers such as invoice numbers) are filled by PaperClerk; values sent for them are ignored.
- **Empty values** keep the template's default for that placeholder. Turn on *Clear Empty Placeholders* under Options to send them as empty instead.

If a value cannot be used, the node stops with PaperClerk's explanation, which names the valid keys or options.

## PDFs

PaperClerk renders every document's PDF on its own servers right after the document is created, usually within a few seconds. **Generate** waits for it and puts the file in the `data` binary field by default; *Download PDF*, *Put Output File in Field* and *Wait Timeout (Seconds)* under Options change that. **Download PDF** does the same for any generated document.

## Retries and duplicates

Generating is safe to retry. A request identical to one sent in the last 10 minutes returns the document the first request made, with `replayed: true`, instead of creating a second one, so a timeout and retry never draw a second invoice number. To tie a document to a record for longer, set *Idempotency Key* under Options, for example to the ID of the order that started the workflow: the same key within 24 hours always returns the first document.

## Trigger

**PaperClerk Trigger** checks for newly generated documents on n8n's polling schedule. When it finds some, it starts the workflow with one item per new document, oldest first. It can be limited to one template and to documents generated in PaperClerk itself (*App*) or through the API, n8n, ChatGPT and Claude (*API*). It starts from the moment the workflow is activated; earlier documents are not replayed. *Test step* returns the newest matching document.

## Using it with an AI agent

The PaperClerk node can be used as a tool by n8n's AI Agent. On self-hosted n8n, community nodes need `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` to be used as tools.

PaperClerk also runs an MCP server that n8n's **MCP Client Tool** can use without this package: endpoint `https://usepaperclerk.com/api/mcp`, transport HTTP Streamable, and either *Bearer Auth* with a workspace API key or *MCP OAuth2*.

## What it does not do

The node reads templates and generates documents. It does not create, edit or delete templates, and it does not delete documents: those stay in PaperClerk.

## Resources

- [PaperClerk](https://usepaperclerk.com)
- [REST API reference](https://usepaperclerk.com/docs/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Compatibility

Tested with n8n 2.44.7.

## Support

Write to [hello@usepaperclerk.com](mailto:hello@usepaperclerk.com) or open an issue in this repository.

## License

[MIT](LICENSE)
