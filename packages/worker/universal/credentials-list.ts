/**
 * The Credentials page on top of the credentials list contract
 * (docs/contributing/contracts/credential-mappings-api.md): labels, the
 * `/account/credentials.json` filters, and the extra fields the website page
 * reads. Nothing here carries a credential value.
 */
import {
	type CredentialKind,
	type CredentialListFilters,
	type CredentialListItem,
	type CredentialListItemStatus,
	type CredentialListResponse,
	isCredentialKind,
} from '#universal/credential-contracts.ts'

export function credentialKindLabel(kind: CredentialKind) {
	switch (kind) {
		case 'secret':
			return 'Key'
		case 'oauth':
			return 'OAuth'
		case 'mcp':
			return 'MCP server'
		case 'url':
			return 'URL'
		case 'login':
			return 'Login'
		case 'signing':
			return 'Signing'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

export function credentialStatusLabel(status: CredentialListItemStatus) {
	switch (status) {
		case 'ok':
			return 'Ready'
		case 'expired':
			return 'Expired'
		case 'needs_attention':
			return 'Needs attention'
		case 'disabled':
			return 'Disabled'
		default: {
			const exhaustive: never = status
			return exhaustive
		}
	}
}

/**
 * A custom secret provider (vault) binding: it resolves references at run
 * time and is org configuration, not a credential of its own.
 */
export type CredentialProviderBindingItem = {
	id: string
	providerId: string
	provider: string | null
	/** The package that holds the door secret unlocking the vault. */
	packageId: string
	doorSecretName: string
	updatedAt: string
}

/** The contract response plus what the website page needs to render it. */
export type AccountCredentialsResponse = CredentialListResponse & {
	orgSlug: string
	/** Where the viewer's personal credentials are managed. */
	personalOrgSlug: string | null
	/** True in a team org, where personal credentials can be granted in. */
	teamOrg: boolean
	providers: Array<CredentialProviderBindingItem>
	packages: Array<{ id: string; kodyId: string; name: string }>
}

/** Reads list filters from a query string (`kind` may repeat). */
export function readCredentialListFilters(
	search: URLSearchParams,
): CredentialListFilters {
	const filters: CredentialListFilters = {}
	const q = search.get('q')?.trim()
	if (q) filters.q = q
	const kinds = search.getAll('kind').filter(isCredentialKind)
	if (kinds.length > 0) filters.kinds = kinds
	const scope = search.get('scope')
	if (scope === 'org' || scope === 'personal') filters.scope = scope
	const packageScoped = search.get('packageScoped')
	if (packageScoped === 'true') filters.packageScoped = true
	if (packageScoped === 'false') filters.packageScoped = false
	const locked = search.get('locked')?.trim()
	if (locked === 'true') filters.locked = true
	else if (locked && locked !== 'false') filters.locked = locked
	return filters
}

/** Writes `filters` into `params`, replacing every filter key. */
export function writeCredentialListQuery(
	params: URLSearchParams,
	filters: CredentialListFilters,
) {
	for (const key of ['q', 'kind', 'scope', 'packageScoped', 'locked']) {
		params.delete(key)
	}
	if (filters.q) params.set('q', filters.q)
	for (const kind of filters.kinds ?? []) params.append('kind', kind)
	if (filters.scope) params.set('scope', filters.scope)
	if (filters.packageScoped !== undefined) {
		params.set('packageScoped', String(filters.packageScoped))
	}
	if (filters.locked !== undefined) params.set('locked', String(filters.locked))
}

function matchesQuery(item: CredentialListItem, query: string) {
	const needle = query.toLowerCase()
	return [item.name, item.provider ?? '', item.description, ...item.hosts].some(
		(field) => field.toLowerCase().includes(needle),
	)
}

/** Applies the list filters; the page filters live with the same rules. */
export function filterCredentialList(
	items: ReadonlyArray<CredentialListItem>,
	filters: CredentialListFilters,
): Array<CredentialListItem> {
	const query = filters.q?.trim() ?? ''
	return items.filter((item) => {
		if (query && !matchesQuery(item, query)) return false
		if (filters.kinds?.length && !filters.kinds.includes(item.kind)) {
			return false
		}
		if (filters.scope && item.scope !== filters.scope) return false
		if (
			filters.packageScoped !== undefined &&
			(item.packageId !== null) !== filters.packageScoped
		) {
			return false
		}
		if (filters.locked === true && item.lockedToPackageIds.length === 0) {
			return false
		}
		if (
			typeof filters.locked === 'string' &&
			!item.lockedToPackageIds.includes(filters.locked)
		) {
			return false
		}
		return true
	})
}
