/**
 * Every credential an org holds, as the credentials list contract shapes it
 * (docs/contributing/contracts/credential-mappings-api.md): Key and opt-in
 * stored kinds, OAuth connections, and MCP servers, plus the viewer's own
 * personal credentials granted to a team org. Vault bindings are listed
 * separately. Rows are metadata only; nothing here selects a value, token,
 * or client secret.
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
import { getIntegrationAllowedHosts } from '#mcp/execute-modules/integration-host-allowlist.ts'
import {
	type CredentialInjectView,
	type CredentialKind,
	type CredentialListItem,
	type CredentialScope,
} from '#universal/credential-contracts.ts'
import { type CredentialProviderBindingItem } from '#universal/credentials-list.ts'
import { credentialInjectSchema } from './credential-fields.ts'
import { listPersonalCredentialCandidates } from './personal-credentials.ts'

type SecretRow = {
	id: string
	name: string
	description: string
	kind: string
	provider: string | null
	allowed_hosts: string
	allowed_packages: string
	inject_json: string
	scope: 'user' | 'package'
	binding_key: string
	expires_at: string | null
	bucket_expires_at: string | null
	created_at: string
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
	inject_json: string
	usage_mode: string
	allowed_packages_json: string
	connected_at: string | null
	auth_failed_at: string | null
	created_at: string
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
	last_error: string | null
	created_at: string
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

function parseInject(json: string): CredentialInjectView | null {
	try {
		const parsed = credentialInjectSchema.safeParse(JSON.parse(json))
		return parsed.success ? parsed.data : null
	} catch {
		return null
	}
}

function idFilter(column: string, ids: ReadonlyArray<string> | null) {
	return ids ? ` AND ${column} IN (${ids.map(() => '?').join(', ')})` : ''
}

function storedKind(kind: string): CredentialKind {
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
				e.allowed_packages AS allowed_packages, e.inject_json AS inject_json,
				b.scope AS scope, b.binding_key AS binding_key,
				e.expires_at AS expires_at, b.expires_at AS bucket_expires_at,
				e.created_at AS created_at, e.updated_at AS updated_at
			FROM secret_entries e JOIN secret_buckets b ON b.id = e.bucket_id
			WHERE b.user_id = ? AND b.scope IN ('user', 'package')
				AND e.id IS NOT NULL AND e.deleted_at IS NULL AND b.deleted_at IS NULL
				${idFilter('e.id', ids)}`,
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
				i.inject_json AS inject_json,
				i.usage_mode AS usage_mode, i.allowed_packages_json AS allowed_packages_json,
				i.connected_at AS connected_at, i.auth_failed_at AS auth_failed_at,
				i.created_at AS created_at, i.updated_at AS updated_at
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
				allowed_packages_json, last_error, created_at, updated_at
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

type RowContext = { scope: CredentialScope; now: string }

function secretItem(row: SecretRow, context: RowContext): CredentialListItem {
	const kind = storedKind(row.kind)
	const packageId = row.scope === 'package' ? row.binding_key : null
	const expiresAt = row.expires_at ?? row.bucket_expires_at
	return {
		id: row.id,
		kind,
		name: row.name,
		scope: context.scope,
		provider: row.provider,
		description: row.description,
		hosts: parseStringList(row.allowed_hosts),
		// A `url` value is the whole request target and `signing` never leaves
		// the host, so neither has a placement.
		inject:
			kind === 'secret' || kind === 'login'
				? parseInject(row.inject_json)
				: null,
		packageId,
		lockedToPackageIds: packageId ? [] : parseStringList(row.allowed_packages),
		expiresAt,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		status: isPast(expiresAt, context.now) ? 'expired' : 'ok',
		statusMessage: null,
		mcp: null,
	}
}

function integrationStatus(
	row: IntegrationRow,
): Pick<CredentialListItem, 'status' | 'statusMessage'> {
	if (!row.connected_at) {
		return { status: 'needs_attention', statusMessage: 'Not connected yet.' }
	}
	if (row.auth_failed_at) {
		return {
			status: 'needs_attention',
			statusMessage: 'The provider rejected the token. Reconnect to fix it.',
		}
	}
	return { status: 'ok', statusMessage: null }
}

function integrationItem(
	row: IntegrationRow,
	context: RowContext,
): CredentialListItem {
	return {
		id: row.id,
		kind: 'oauth',
		name: row.name,
		scope: context.scope,
		provider: row.provider ?? row.app_provider,
		description: row.description,
		hosts: getIntegrationAllowedHosts({
			requiredHosts: [
				...parseStringList(row.required_hosts_json),
				...parseStringList(row.app_hosts_json),
			],
			apiBaseUrl: row.api_base_url,
		}),
		inject: parseInject(row.inject_json),
		packageId: null,
		lockedToPackageIds:
			row.usage_mode === 'packages'
				? parseStringList(row.allowed_packages_json)
				: [],
		expiresAt: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...integrationStatus(row),
		mcp: null,
	}
}

function mcpServerStatus(
	row: McpServerRow,
): Pick<CredentialListItem, 'status' | 'statusMessage'> {
	if (row.enabled !== 1) return { status: 'disabled', statusMessage: null }
	if (row.last_error) {
		return { status: 'needs_attention', statusMessage: row.last_error }
	}
	return { status: 'ok', statusMessage: null }
}

function mcpServerItem(
	row: McpServerRow,
	context: RowContext,
): CredentialListItem {
	return {
		id: row.id,
		kind: 'mcp',
		name: row.name,
		scope: context.scope,
		provider: row.provider,
		description: '',
		hosts: hostOf(row.url),
		inject: null,
		packageId: null,
		lockedToPackageIds:
			row.usage_mode === 'packages'
				? parseStringList(row.allowed_packages_json)
				: [],
		expiresAt: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...mcpServerStatus(row),
		mcp: { url: row.url, enabled: row.enabled === 1 },
	}
}

function vaultItem(row: VaultRow): CredentialProviderBindingItem {
	return {
		id: row.id,
		providerId: row.provider_id,
		provider: row.provider,
		packageId: row.package_id,
		doorSecretName: row.door_secret_name,
		updatedAt: row.updated_at,
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
	const items: Array<CredentialListItem> = []
	for (const ids of chunks) {
		if (ids?.length === 0) continue
		const [secrets, integrations, servers] = await Promise.all([
			listSecretRows(input.db, input.ownerId, ids),
			listIntegrationRows(input.db, input.ownerId, ids),
			listMcpServerRows(input.db, input.ownerId, ids),
		])
		items.push(
			...secrets.map((row) => secretItem(row, input.context)),
			...integrations.map((row) => integrationItem(row, input.context)),
			...servers.map((row) => mcpServerItem(row, input.context)),
		)
	}
	return items
}

/**
 * The org's credentials and, in a team org, the viewer's own personal
 * credentials granted to it (nobody else's), sorted by name, then kind. In a
 * personal org every credential is the owner's own, so its scope is
 * `personal`.
 */
export async function listOrgCredentials(input: {
	db: D1Database
	orgId: OwnerId
	viewerPersonId: PersonId | null
	now?: Date
}): Promise<{
	credentials: Array<CredentialListItem>
	providers: Array<CredentialProviderBindingItem>
}> {
	const now = (input.now ?? new Date()).toISOString()
	const viewer = input.viewerPersonId
	const teamOrg = !viewer || input.orgId !== personalOrgId(viewer)
	const [orgItems, vaults, granted] = await Promise.all([
		listOwnerCredentials({
			db: input.db,
			ownerId: input.orgId,
			ids: null,
			context: { scope: teamOrg ? 'org' : 'personal', now },
		}),
		listVaultRows(input.db, input.orgId),
		viewer && teamOrg
			? listPersonalCredentialCandidates({
					db: input.db,
					actorPersonId: viewer,
					orgId: input.orgId,
					now: input.now,
				})
			: [],
	])
	const personalItems =
		viewer && granted.length > 0
			? await listOwnerCredentials({
					db: input.db,
					ownerId: personalOrgId(viewer),
					ids: granted.map((credential) => credential.id),
					context: { scope: 'personal', now },
				})
			: []
	return {
		credentials: [...orgItems, ...personalItems].sort(
			(left, right) =>
				left.name.localeCompare(right.name) ||
				left.kind.localeCompare(right.kind) ||
				left.scope.localeCompare(right.scope),
		),
		providers: vaults
			.map(vaultItem)
			.sort((left, right) => left.providerId.localeCompare(right.providerId)),
	}
}
