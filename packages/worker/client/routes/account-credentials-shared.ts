import { orgAccountApiReferrer } from '#client/org-account-api.ts'
import { readJson } from '#client/routes/account-approval-shared.ts'
import {
	routeLoaderRedirect,
	type RouteLoaderResult,
} from '#client/route-loader.ts'
import { matchesSearchQuery } from '#client/search-filter.ts'
import {
	type AccountCredentialListItem,
	type AccountCredentialsLoaderData,
	type CredentialListKind,
	type CredentialOwner,
	credentialKindLabel,
	isCredentialListKind,
} from '#universal/credentials-list.ts'
import { routes } from '#universal/routes.ts'

type CredentialOwnerFilter = 'all' | CredentialOwner

/** `package`: package-scoped values; `locked`: locked to a package. */
type CredentialPackageFilter = 'all' | 'package' | 'locked'

export type CredentialListFilters = {
	search: string
	kind: CredentialListKind | 'all'
	owner: CredentialOwnerFilter
	packageFilter: CredentialPackageFilter
	/** Narrows to one package (its own values and credentials locked to it). */
	packageId: string
}

export function readCredentialListFilters(href: string): CredentialListFilters {
	const params = new URL(href, 'http://localhost').searchParams
	const kind = params.get('kind')?.trim() ?? ''
	const owner = params.get('owner')?.trim() ?? ''
	const packageFilter = params.get('packages')?.trim() ?? ''
	return {
		search: params.get('q')?.trim() ?? '',
		kind: isCredentialListKind(kind) ? kind : 'all',
		owner: owner === 'org' || owner === 'personal' ? owner : 'all',
		packageFilter:
			packageFilter === 'package' || packageFilter === 'locked'
				? packageFilter
				: 'all',
		packageId: params.get('package')?.trim() ?? '',
	}
}

/** Writes non-default filters into `href`'s query, dropping the defaults. */
export function writeCredentialListFilters(
	href: string,
	filters: CredentialListFilters,
) {
	const url = new URL(href, 'http://localhost')
	const entries: Array<[string, string, string]> = [
		['q', filters.search, ''],
		['kind', filters.kind, 'all'],
		['owner', filters.owner, 'all'],
		['packages', filters.packageFilter, 'all'],
		['package', filters.packageId, ''],
	]
	for (const [key, value, fallback] of entries) {
		if (value && value !== fallback) url.searchParams.set(key, value)
		else url.searchParams.delete(key)
	}
	return `${url.pathname}${url.search}`
}

export function filterCredentialList(
	credentials: ReadonlyArray<AccountCredentialListItem>,
	filters: CredentialListFilters,
	packagesById: ReadonlyMap<string, { kodyId: string; name: string }>,
) {
	return credentials.filter((credential) => {
		if (filters.kind !== 'all' && credential.kind !== filters.kind) {
			return false
		}
		if (filters.owner !== 'all' && credential.owner !== filters.owner) {
			return false
		}
		if (filters.packageFilter === 'package' && !credential.packageId) {
			return false
		}
		if (
			filters.packageFilter === 'locked' &&
			credential.lockedPackageIds.length === 0
		) {
			return false
		}
		if (
			filters.packageId &&
			credential.packageId !== filters.packageId &&
			!credential.lockedPackageIds.includes(filters.packageId)
		) {
			return false
		}
		const packageNames = [
			credential.packageId,
			...credential.lockedPackageIds,
		].flatMap((id) => {
			const meta = id ? packagesById.get(id) : null
			return meta ? [meta.kodyId, meta.name] : []
		})
		return matchesSearchQuery(filters.search, [
			credential.name,
			credential.description,
			credential.provider ?? '',
			credentialKindLabel(credential.kind),
			...credential.hosts,
			...packageNames,
		])
	})
}

const accountCredentialsApiPath = routes.accountCredentialsApi.href()

/** `/account/credentials.json` for the page at `href`, or null when signed out. */
export async function fetchAccountCredentials(
	href: string,
	signal: AbortSignal,
) {
	const response = await fetch(accountCredentialsApiPath, {
		headers: { Accept: 'application/json' },
		credentials: 'include',
		referrer: orgAccountApiReferrer(href),
		signal,
	})
	if (response.status === 401) return null
	const payload = await readJson<AccountCredentialsLoaderData>(response)
	if (!response.ok || !payload?.ok) {
		throw new Error('Unable to load credentials.')
	}
	return payload
}

export async function accountCredentialsRouteLoader(
	url: URL,
	signal: AbortSignal,
): Promise<RouteLoaderResult> {
	const payload = await fetchAccountCredentials(url.href, signal)
	if (!payload) return routeLoaderRedirect('/login')
	return { accountCredentials: payload }
}
