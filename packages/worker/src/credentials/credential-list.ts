/**
 * Every credential an org holds, for the Credentials page (ADR 0068): Key and
 * opt-in stored kinds, OAuth connections, MCP servers, and vault bindings,
 * plus the viewer's own personal credentials granted to a team org. Rows are
 * metadata only; nothing here selects a value, token, or client secret.
 */
import {
	personalOrgId,
	type OwnerId,
	type PersonId,
} from '@kody-internal/shared/owner-person-ids.ts'
import {
	chunkArray,
	maxD1BoundParameters,
} from '@kody-internal/shared/chunk.ts'
import { buildAccountSecretPath } from '@kody-internal/shared/account-secret-route.ts'
import { getIntegrationAllowedHosts } from '#mcp/execute-modules/integration-host-allowlist.ts'
import {
	type AccountCredentialListItem,
	type CredentialListKind,
	type CredentialListStatus,
	type CredentialOwner,
} from '#universal/credentials-list.ts'
import { orgResourcePath } from '#universal/org-pages.ts'
import { listPersonalCredentialCandidates } from './personal-credentials.ts'

type SecretRow = {
	id: string
	name: string
	description: string
	kind: string
	provider: string | null
	allowed_hosts: string
	allowed_packages: string
	scope: 'user' | 'package'
	binding_key: string
	expires_at: string | null
	bucket_expires_at: string | null
	updated_at: string
}

type IntegrationRow = {
	id: string
	name: string
	description: string
	provider: string | null
	app_provider: string | null
	required_hosts_json: string
	app_hosts_json: string | null
	api_base_url: string | null
	usage_mode: string
	allowed_packages_json: string
	connected_at: string | null
	auth_failed_at: string | null
	updated_at: string
}

type McpServerRow = {
	id: string
	name: string
	url: string
	provider: string | null
	enabled: number
	usage_mode: string
	allowed_packages_json: string
	updated_at: string
}

type VaultRow = {
	id: string
	provider_id: string
	provider: string | null
	package_id: string
	door_secret_name: string
	updated_at: string
}

function parseStringList(json: string | null | undefined): Array<string> {
	if (!json) return []
	try {
		const parsed: unknown = JSON.parse(json)
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === 'string')
			: []
	} catch {
		return []
	}
}

function idFilter(column: string, ids: ReadonlyArray<string> | null) {
	return ids ? ` AND ${column} IN (${ids.map(() => '?').join(', ')})` : ''
}

function storedKind(kind: string): CredentialListKind {
	switch (kind) {
		case 'url':
		case 'login':
		case 'signing':
			return kind
		default:
			return 'secret'
	}
}

function isPast(iso: string | null, now: string) {
	return iso != null && iso <= now
}

async function listSecretRows(
	db: D1Database,
	ownerId: string,
	ids: ReadonlyArray<string> | null,
) {
	const result = await db
		.prepare(
			`SELECT e.id AS id, e.name AS name, e.description AS description,
				e.kind AS kind, e.provider AS provider, e.allowed_hosts AS allowed_hosts,
				e.allowed_packages AS allowed_packages, b.scope AS scope,
				b.binding_key AS binding_key, e.expires_at AS expires_at,
				b.expires_at AS bucket_expires_at, e.updated_at AS updated_at
			FROM secret_entries e JOIN secret_buckets b ON b.id = e.bucket_id
			WHERE b.user_id = ? AND b.scope IN ('user', 'package')
				AND e.id IS NOT NULL AND e.deleted_at IS NULL AND b.deleted_at IS NULL
				${ids ? idFilter('e.id', ids) : ''}`,
		)
		.bind(ownerId, ...(ids ?? []))
		.all<SecretRow>()
	return result.results ?? []
}

async function listIntegrationRows(
	db: D1Database,
	ownerId: string,
	ids: ReadonlyArray<string> | null,
) {
	const result = await db
		.prepare(
			`SELECT i.id AS id, i.name AS name, i.description AS description,
				i.provider AS provider,
				COALESCE(a.provider, p.provider) AS app_provider,
				i.required_hosts_json AS required_hosts_json,
				p.required_hosts_json AS app_hosts_json,
				CASE WHEN i.platform_app_slug IS NOT NULL THEN p.api_base_url
					ELSE a.api_base_url END AS api_base_url,
				i.usage_mode AS usage_mode, i.allowed_packages_json AS allowed_packages_json,
				i.connected_at AS connected_at, i.auth_failed_at AS auth_failed_at,
				i.updated_at AS updated_at
			FROM user_integrations i
			LEFT JOIN user_oauth_apps a
				ON a.user_id = i.user_id AND a.slug = i.app_slug AND a.deleted_at IS NULL
			LEFT JOIN platform_oauth_apps p ON p.slug = i.platform_app_slug
			WHERE i.user_id = ? AND i.id IS NOT NULL AND i.deleted_at IS NULL
				${idFilter('i.id', ids)}`,
		)
		.bind(ownerId, ...(ids ?? []))
		.all<IntegrationRow>()
	return result.results ?? []
}

async function listMcpServerRows(
	db: D1Database,
	ownerId: string,
	ids: ReadonlyArray<string> | null,
) {
	const result = await db
		.prepare(
			`SELECT id, name, url, provider, enabled, usage_mode,
				allowed_packages_json, updated_at
			FROM mcp_server_settings
			WHERE user_id = ? AND deleted_at IS NULL${idFilter('id', ids)}`,
		)
		.bind(ownerId, ...(ids ?? []))
		.all<McpServerRow>()
	return result.results ?? []
}

async function listVaultRows(db: D1Database, ownerId: string) {
	const result = await db
		.prepare(
			`SELECT id, provider_id, provider, package_id, door_secret_name, updated_at
			FROM secret_provider_bindings
			WHERE user_id = ? AND id IS NOT NULL AND deleted_at IS NULL`,
		)
		.bind(ownerId)
		.all<VaultRow>()
	return result.results ?? []
}

function hostOf(url: string) {
	try {
		return [new URL(url).hostname]
	} catch {
		return []
	}
}

type RowContext = {
	orgSlug: string
	owner: CredentialOwner
	now: string
}

function secretItem(
	row: SecretRow,
	context: RowContext,
): AccountCredentialListItem {
	const packageId = row.scope === 'package' ? row.binding_key : null
	const expiresAt = row.expires_at ?? row.bucket_expires_at
	return {
		id: row.id,
		kind: storedKind(row.kind),
		name: row.name,
		description: row.description,
		provider: row.provider,
		hosts: parseStringList(row.allowed_hosts),
		owner: context.owner,
		packageId,
		lockedPackageIds: packageId ? [] : parseStringList(row.allowed_packages),
		status: isPast(expiresAt, context.now) ? 'expired' : 'ready',
		expiresAt,
		updatedAt: row.updated_at,
		manageHref: orgResourcePath(
			context.orgSlug,
			'secrets',
			buildAccountSecretPath({
				name: row.name,
				scope: row.scope,
				packageId,
			}).replace(/^\/account\/secrets\/?/, ''),
		),
	}
}

function integrationStatus(row: IntegrationRow): CredentialListStatus {
	if (!row.connected_at) return 'not_connected'
	if (row.auth_failed_at) return 'auth_failed'
	return 'ready'
}

function integrationItem(
	row: IntegrationRow,
	context: RowContext,
): AccountCredentialListItem {
	return {
		id: row.id,
		kind: 'oauth',
		name: row.name,
		description: row.description,
		provider: row.provider ?? row.app_provider,
		hosts: getIntegrationAllowedHosts({
			requiredHosts: [
				...parseStringList(row.required_hosts_json),
				...parseStringList(row.app_hosts_json),
			],
			apiBaseUrl: row.api_base_url,
		}),
		owner: context.owner,
		packageId: null,
		lockedPackageIds:
			row.usage_mode === 'packages'
				? parseStringList(row.allowed_packages_json)
				: [],
		status: integrationStatus(row),
		expiresAt: null,
		updatedAt: row.updated_at,
		manageHref: orgResourcePath(
			context.orgSlug,
			'integrations',
			encodeURIComponent(row.name),
		),
	}
}

function mcpServerItem(
	row: McpServerRow,
	context: RowContext,
): AccountCredentialListItem {
	return {
		id: row.id,
		kind: 'mcp',
		name: row.name,
		description: row.url,
		provider: row.provider,
		hosts: hostOf(row.url),
		owner: context.owner,
		packageId: null,
		lockedPackageIds:
			row.usage_mode === 'packages'
				? parseStringList(row.allowed_packages_json)
				: [],
		status: row.enabled === 1 ? 'ready' : 'disabled',
		expiresAt: null,
		updatedAt: row.updated_at,
		manageHref: orgResourcePath(
			context.orgSlug,
			'mcp-servers',
			encodeURIComponent(row.id),
		),
	}
}

function vaultItem(
	row: VaultRow,
	context: RowContext,
): AccountCredentialListItem {
	return {
		id: row.id,
		kind: 'vault',
		name: row.provider_id,
		description: `Unlocked with ${row.door_secret_name}`,
		provider: row.provider ?? row.provider_id,
		hosts: [],
		owner: context.owner,
		packageId: row.package_id,
		lockedPackageIds: [],
		status: 'ready',
		expiresAt: null,
		updatedAt: row.updated_at,
		manageHref: orgResourcePath(context.orgSlug, 'secret-providers'),
	}
}

async function listOwnerCredentials(input: {
	db: D1Database
	ownerId: string
	ids: ReadonlyArray<string> | null
	context: RowContext
}) {
	const chunks =
		input.ids === null
			? [null]
			: chunkArray([...new Set(input.ids)], maxD1BoundParameters - 1)
	const items: Array<AccountCredentialListItem> = []
	for (const ids of chunks) {
		if (ids?.length === 0) continue
		const [secrets, integrations, servers, vaults] = await Promise.all([
			listSecretRows(input.db, input.ownerId, ids),
			listIntegrationRows(input.db, input.ownerId, ids),
			listMcpServerRows(input.db, input.ownerId, ids),
			// Vault bindings are org configuration and never personal.
			ids === null ? listVaultRows(input.db, input.ownerId) : [],
		])
		items.push(
			...secrets.map((row) => secretItem(row, input.context)),
			...integrations.map((row) => integrationItem(row, input.context)),
			...servers.map((row) => mcpServerItem(row, input.context)),
			...vaults.map((row) => vaultItem(row, input.context)),
		)
	}
	return items
}

/**
 * The org's credentials and, in a team org, the viewer's own personal
 * credentials granted to it (nobody else's). Sorted by name, then kind.
 */
export async function listOrgCredentialsForPage(input: {
	db: D1Database
	orgId: OwnerId
	orgSlug: string
	viewerPersonId: PersonId | null
	/** Where the viewer's personal credentials are managed. */
	viewerPersonalOrgSlug: string | null
	now?: Date
}): Promise<Array<AccountCredentialListItem>> {
	const now = (input.now ?? new Date()).toISOString()
	const viewer = input.viewerPersonId
	const teamOrg = !viewer || input.orgId !== personalOrgId(viewer)
	// A personal org's credentials are its owner's personal credentials.
	const orgItems = await listOwnerCredentials({
		db: input.db,
		ownerId: input.orgId,
		ids: null,
		context: {
			orgSlug: input.orgSlug,
			owner: teamOrg ? 'org' : 'personal',
			now,
		},
	})
	const personal =
		viewer && teamOrg
			? await listPersonalCredentialCandidates({
					db: input.db,
					actorPersonId: viewer,
					orgId: input.orgId,
					now: input.now,
				})
			: []
	const personalItems =
		viewer && input.viewerPersonalOrgSlug && personal.length > 0
			? await listOwnerCredentials({
					db: input.db,
					ownerId: personalOrgId(viewer),
					ids: personal.map((credential) => credential.id),
					context: {
						orgSlug: input.viewerPersonalOrgSlug,
						owner: 'personal',
						now,
					},
				})
			: []
	return [...orgItems, ...personalItems].sort(
		(left, right) =>
			left.name.localeCompare(right.name) ||
			left.kind.localeCompare(right.kind) ||
			left.owner.localeCompare(right.owner),
	)
}
