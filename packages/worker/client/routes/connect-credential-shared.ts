import { buildAccountSecretId } from '@kody-internal/shared/account-secret-route.ts'
import {
	type CredentialKind,
	type CredentialListItem,
	type ParsedCredentialCreateQuery,
} from '#universal/credential-contracts.ts'
import { credentialKindLabel } from '#universal/credentials-list.ts'
import { orgResourcePath } from '#universal/org-pages.ts'
import { routes } from '#universal/routes.ts'

/**
 * How the one-pager creates each kind: a Key form on the page, a hand-off to
 * the existing OAuth or MCP flow, or not on the website yet. The website save
 * does not take `kind`, `hosts`, or `login_exchange`, and `secretSet` only
 * changes a kind together with its value, so the opt-in kinds have no
 * website path that keeps the value out of an agent's hands.
 */
export type CredentialCreateMode = 'key-form' | 'handoff' | 'unavailable'

export function credentialCreateMode(
	kind: CredentialKind,
): CredentialCreateMode {
	switch (kind) {
		case 'secret':
			return 'key-form'
		case 'oauth':
		case 'mcp':
			return 'handoff'
		case 'url':
		case 'login':
		case 'signing':
			return 'unavailable'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

export function credentialCreateKindSummary(kind: CredentialKind) {
	switch (kind) {
		case 'secret':
			return 'An API key, token, or password Kody places on requests to the hosts you allow.'
		case 'oauth':
			return 'Sign in with a provider. Kody keeps the token fresh.'
		case 'mcp':
			return 'A remote MCP server Kody connects to for you.'
		case 'url':
			return 'A URL that carries its own secret, such as a webhook or bot URL.'
		case 'login':
			return 'A username and password Kody exchanges for a session token.'
		case 'signing':
			return 'A secret Kody signs requests or verifies webhooks with.'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

export function credentialCreateTitle(kind: CredentialKind) {
	switch (kind) {
		case 'secret':
			return 'Add a key'
		case 'oauth':
			return 'Connect an OAuth service'
		case 'mcp':
			return 'Add an MCP server'
		case 'url':
			return 'Add a URL credential'
		case 'login':
			return 'Add a login'
		case 'signing':
			return 'Add a signing secret'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

/** `href` with `kind` chosen, keeping every other param (including prefill). */
export function writeCredentialCreateKind(href: string, kind: CredentialKind) {
	const url = new URL(href, 'http://localhost')
	url.searchParams.set('kind', kind)
	return `${url.pathname}${url.search}`
}

/**
 * Where an OAuth or MCP link continues. OAuth keeps the whole query, which
 * `/connect/oauth` already reads (`provider` and its config params).
 */
export function credentialCreateHandoffHref(input: {
	kind: 'oauth' | 'mcp'
	search: URLSearchParams
	orgSlug: string
}) {
	switch (input.kind) {
		case 'oauth': {
			const query = input.search.toString()
			const path = routes.connectOauth.href()
			return query ? `${path}?${query}` : path
		}
		case 'mcp':
			return orgResourcePath(input.orgSlug, 'mcp-servers', 'new')
		default: {
			const exhaustive: never = input.kind
			return exhaustive
		}
	}
}

/** The org Key the form would replace: same name, not package-scoped. */
export function findExistingOrgKey(
	credentials: ReadonlyArray<CredentialListItem>,
	name: string,
) {
	const wanted = name.trim()
	if (!wanted) return null
	return (
		credentials.find(
			(credential) =>
				credential.scope === 'org' &&
				credential.packageId === null &&
				credential.name === wanted,
		) ?? null
	)
}

/**
 * Credentials that may already satisfy the link: the same kind (when the link
 * names one) and, when the link names a provider, the same provider.
 */
export function findMatchingCredentials(
	credentials: ReadonlyArray<CredentialListItem>,
	query: Pick<ParsedCredentialCreateQuery, 'kind' | 'provider'>,
) {
	return credentials.filter(
		(credential) =>
			(query.kind === null || credential.kind === query.kind) &&
			query.provider !== null &&
			credential.provider === query.provider,
	)
}

/** Hosts typed one per line or separated by commas or spaces. */
export function parseHostsInput(text: string) {
	return [
		...new Set(
			text
				.split(/[\s,]+/)
				.map((host) => host.trim().toLowerCase())
				.filter(Boolean),
		),
	]
}

export type KeyFormState = {
	name: string
	value: string
	description: string
	provider: string
	hosts: string
	expiresAt: string
	/** Replace the existing org Key with this name instead of failing. */
	replaceExisting: boolean
}

export function createKeyFormState(
	query: ParsedCredentialCreateQuery,
): KeyFormState {
	return {
		name: query.name ?? '',
		value: '',
		description: query.description ?? '',
		provider: query.provider ?? '',
		hosts: query.allowedHosts.join('\n'),
		expiresAt: '',
		replaceExisting: false,
	}
}

/**
 * The `/account/secrets.json` save for the Key form. Replacing keeps the
 * existing Key's hosts and adds the form's.
 */
export function buildKeySaveBody(input: {
	form: KeyFormState
	existing: CredentialListItem | null
}) {
	const name = input.form.name.trim()
	const replacing = input.form.replaceExisting && input.existing !== null
	const hosts = parseHostsInput(input.form.hosts)
	return {
		action: 'save',
		currentId: replacing ? buildAccountSecretId({ name, scope: 'user' }) : null,
		name,
		scope: 'user',
		value: input.form.value,
		description: input.form.description.trim(),
		provider: input.form.provider.trim() || null,
		expiresAt: input.form.expiresAt.trim() || null,
		allowedHosts: replacing
			? [...new Set([...(input.existing?.hosts ?? []), ...hosts])]
			: hosts,
		allowedPackages: replacing
			? (input.existing?.lockedToPackageIds ?? [])
			: [],
	}
}

/** A prompt the person can hand their agent when the website cannot help. */
export function credentialCreateAgentPrompt(input: {
	kind: CredentialKind
	query: ParsedCredentialCreateQuery
	pageUrl: string
}) {
	const label = credentialKindLabel(input.kind)
	const name = input.query.name ? ` named "${input.query.name}"` : ''
	const forPackage =
		input.query.packageKodyId && input.query.needKey
			? ` for the "${input.query.needKey}" need of package ${input.query.packageKodyId}`
			: ''
	return [
		`I opened a Kody credential link that asks for a ${label} credential${name}${forPackage}: ${input.pageUrl}`,
		`The website cannot create a ${label} credential yet.`,
		`Suggest another way to meet this need without me pasting the value into chat, or tell me which credential I already have that fits.`,
	].join('\n')
}
