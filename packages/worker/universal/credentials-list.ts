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

function readBoolean(value: string | null) {
	if (value === 'true') return true
	if (value === 'false') return false
	return undefined
}

/** `?q=&kind=&scope=&packageScoped=&locked=`; unknown values are ignored. */
export function parseCredentialListQuery(
	params: URLSearchParams,
): CredentialListFilters {
	const q = params.get('q')?.trim() ?? ''
	const kinds = [
		...new Set(params.getAll('kind').filter((kind) => isCredentialKind(kind))),
	]
	const scope = params.get('scope')
	const packageScoped = readBoolean(params.get('packageScoped'))
	const locked = params.get('locked')?.trim() ?? ''
	return {
		...(q ? { q } : {}),
		...(kinds.length > 0 ? { kinds } : {}),
		...(scope === 'org' || scope === 'personal' ? { scope } : {}),
		...(packageScoped === undefined ? {} : { packageScoped }),
		...(locked ? { locked: locked === 'true' ? true : locked } : {}),
	}
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

/**
 * `locked: <package id>` keeps credentials locked to that package and its
 * package-scoped Keys, the same set as a package's Credentials tab.
 */
export function filterCredentialListItems(
	credentials: ReadonlyArray<CredentialListItem>,
	filters: CredentialListFilters,
) {
	const query = filters.q?.toLowerCase() ?? ''
	return credentials.filter((credential) => {
		if (filters.kinds?.length && !filters.kinds.includes(credential.kind)) {
			return false
		}
		if (filters.scope && credential.scope !== filters.scope) return false
		if (
			filters.packageScoped !== undefined &&
			(credential.packageId !== null) !== filters.packageScoped
		) {
			return false
		}
		if (filters.locked === true && credential.lockedToPackageIds.length === 0) {
			return false
		}
		if (
			typeof filters.locked === 'string' &&
			credential.packageId !== filters.locked &&
			!credential.lockedToPackageIds.includes(filters.locked)
		) {
			return false
		}
		if (!query) return true
		return [
			credential.name,
			credential.provider ?? '',
			credential.description,
			...credential.hosts,
		].some((text) => text.toLowerCase().includes(query))
	})
}
