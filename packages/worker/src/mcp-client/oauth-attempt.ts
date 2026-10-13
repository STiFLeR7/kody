import {
	authorizationServerOriginFromDiscovery,
	discoveryMatchesAttemptAuthorizationServerOrigin,
	mcpOAuthAttemptIdentityInvalidMessage,
	mcpOAuthServerOrigin,
	oauthAttemptIdentityMatches,
	sameMcpOAuthServerOrigin,
	sameMcpOAuthServerUrl,
} from './oauth-identity.ts'

export const mcpOAuthAttemptStoragePrefix = 'mcp-oauth-attempt/'

export function mcpOAuthAttemptStorageKey(serverId: string) {
	return `${mcpOAuthAttemptStoragePrefix}${serverId}`
}

/**
 * Identity recorded when an MCP OAuth authorization URL is minted. Bound to
 * the hub server row and client for this attempt only; cleared after a
 * successful grant save or when the attempt is refused.
 */
export type McpOAuthAttemptIdentity = {
	serverId: string
	serverUrl: string
	serverOrigin: string
	clientId: string
	/** AS origin from discovery at start; null when discovery had no issuer yet. */
	authorizationServerOrigin: string | null
	createdAt: number
}

export type McpOAuthLiveServerIdentity = {
	serverId: string
	serverUrl: string
	/** Pre-registered client id when set; otherwise the SQL / registered client id. */
	clientId: string | null
	name?: string | null
}

export class McpOAuthAttemptIdentityError extends Error {
	readonly code = 'mcp_oauth_state_invalid' as const

	constructor(message = mcpOAuthAttemptIdentityInvalidMessage()) {
		super(message)
		this.name = 'McpOAuthAttemptIdentityError'
	}
}

export function parseMcpOAuthAttemptIdentity(
	value: unknown,
): McpOAuthAttemptIdentity | null {
	if (!value || typeof value !== 'object') return null
	const record = value as Record<string, unknown>
	const serverId = record['serverId']
	const serverUrl = record['serverUrl']
	const serverOrigin = record['serverOrigin']
	const clientId = record['clientId']
	const createdAt = record['createdAt']
	const authorizationServerOrigin = record['authorizationServerOrigin']
	if (typeof serverId !== 'string' || !serverId) return null
	if (typeof serverUrl !== 'string' || !serverUrl) return null
	if (typeof serverOrigin !== 'string' || !serverOrigin) return null
	if (typeof clientId !== 'string' || !clientId) return null
	if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
	if (
		authorizationServerOrigin != null &&
		typeof authorizationServerOrigin !== 'string'
	) {
		return null
	}
	return {
		serverId,
		serverUrl,
		serverOrigin,
		clientId,
		authorizationServerOrigin: authorizationServerOrigin ?? null,
		createdAt,
	}
}

export function buildMcpOAuthAttemptIdentity(input: {
	serverId: string
	serverUrl: string
	clientId: string
	discovery?: unknown
	createdAt?: number
}): McpOAuthAttemptIdentity | null {
	const serverOrigin = mcpOAuthServerOrigin(input.serverUrl)
	if (!serverOrigin || !input.serverId || !input.clientId) return null
	return {
		serverId: input.serverId,
		serverUrl: input.serverUrl,
		serverOrigin,
		clientId: input.clientId,
		authorizationServerOrigin: authorizationServerOriginFromDiscovery(
			input.discovery,
		),
		createdAt: input.createdAt ?? Date.now(),
	}
}

/**
 * Full fence used at callback and again immediately before persisting tokens.
 * Requires a complete pending record (legacy attempts without ids fail closed).
 */
export function oauthAttemptMatchesLiveServer(input: {
	pending: McpOAuthAttemptIdentity | null | undefined
	live: McpOAuthLiveServerIdentity | null | undefined
	discovery?: unknown
}): boolean {
	const { pending, live } = input
	if (!pending || !live) return false
	if (
		!oauthAttemptIdentityMatches({
			pendingServerId: pending.serverId,
			pendingClientId: pending.clientId,
			serverId: live.serverId,
			clientId: live.clientId,
		})
	) {
		return false
	}
	if (!sameMcpOAuthServerUrl(pending.serverUrl, live.serverUrl)) return false
	if (!sameMcpOAuthServerOrigin(pending.serverOrigin, live.serverUrl)) {
		return false
	}
	if (
		!discoveryMatchesAttemptAuthorizationServerOrigin({
			pendingAuthorizationServerOrigin: pending.authorizationServerOrigin,
			discovery: input.discovery,
		})
	) {
		return false
	}
	return true
}

type McpOAuthAttemptStorage = {
	get(key: string): Promise<unknown>
	put(key: string, value: unknown): Promise<unknown>
	delete(key: string): Promise<unknown>
}

export async function readMcpOAuthAttemptIdentity(
	storage: McpOAuthAttemptStorage,
	serverId: string,
) {
	return parseMcpOAuthAttemptIdentity(
		await storage.get(mcpOAuthAttemptStorageKey(serverId)),
	)
}

export async function writeMcpOAuthAttemptIdentity(
	storage: McpOAuthAttemptStorage,
	identity: McpOAuthAttemptIdentity,
) {
	await storage.put(mcpOAuthAttemptStorageKey(identity.serverId), identity)
}

export async function clearMcpOAuthAttemptIdentity(
	storage: McpOAuthAttemptStorage,
	serverId: string,
) {
	await storage.delete(mcpOAuthAttemptStorageKey(serverId))
}

export function mcpOAuthAttemptCheckFailure(input?: {
	serverName?: string | null
}) {
	return {
		valid: false as const,
		error: mcpOAuthAttemptIdentityInvalidMessage(input?.serverName),
	}
}
