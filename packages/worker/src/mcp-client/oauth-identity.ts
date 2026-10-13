/**
 * Pending MCP OAuth attempts are bound to the server row id and OAuth client
 * id they started with (kody-celld #50, #55 / #57 / #65). One predicate is used
 * at callback start and again immediately before persisting the grant so those
 * two moments cannot drift apart.
 */
export function oauthAttemptIdentityMatches(input: {
	pendingServerId: string | null | undefined
	pendingClientId: string | null | undefined
	serverId: string | null | undefined
	clientId: string | null | undefined
}): boolean {
	return Boolean(
		input.pendingServerId &&
		input.serverId === input.pendingServerId &&
		input.pendingClientId &&
		input.clientId === input.pendingClientId,
	)
}

/** Origin of an MCP server URL, or null when the URL cannot be parsed. */
export function mcpOAuthServerOrigin(serverUrl: string): string | null {
	try {
		return new URL(serverUrl).origin
	} catch {
		return null
	}
}

export function sameMcpOAuthServerUrl(pendingUrl: string, liveUrl: string) {
	return pendingUrl === liveUrl
}

export function sameMcpOAuthServerOrigin(
	pendingOrigin: string,
	liveUrl: string,
) {
	return mcpOAuthServerOrigin(liveUrl) === pendingOrigin
}

/**
 * Mix-up defence (kody-celld #53 / #60): authorization and token endpoints must
 * sit on the authorization-server issuer's origin. Registration endpoints are
 * out of scope.
 */
export function assertEndpointsOnIssuerOrigin(discovery: unknown): void {
	if (!discovery || typeof discovery !== 'object') return
	const record = discovery as Record<string, unknown>
	const metadata =
		record['authorizationServerMetadata'] &&
		typeof record['authorizationServerMetadata'] === 'object'
			? (record['authorizationServerMetadata'] as Record<string, unknown>)
			: record
	const issuerValue = metadata['issuer']
	if (typeof issuerValue !== 'string' || !issuerValue) return
	let issuerOrigin: string
	try {
		issuerOrigin = new URL(issuerValue).origin
	} catch {
		throw new Error(
			`Authorization server issuer (${issuerValue.slice(0, 200)}) is not a valid URL.`,
		)
	}
	for (const field of ['authorization_endpoint', 'token_endpoint'] as const) {
		const value = metadata[field]
		if (typeof value !== 'string' || !value) continue
		let origin: string | null = null
		try {
			origin = new URL(value).origin
		} catch {
			/* refused below */
		}
		if (origin !== issuerOrigin) {
			throw new Error(
				`Authorization server ${field} (${origin ?? value.slice(0, 200)}) is on a different origin than its issuer (${issuerOrigin}).`,
			)
		}
	}
}

/** Issuer / AS origin from stored MCP OAuth discovery, when present. */
export function authorizationServerOriginFromDiscovery(
	discovery: unknown,
): string | null {
	if (!discovery || typeof discovery !== 'object') return null
	const record = discovery as Record<string, unknown>
	const metadata =
		record['authorizationServerMetadata'] &&
		typeof record['authorizationServerMetadata'] === 'object'
			? (record['authorizationServerMetadata'] as Record<string, unknown>)
			: null
	const issuer =
		(typeof metadata?.['issuer'] === 'string' && metadata['issuer']) ||
		(typeof record['authorizationServerUrl'] === 'string' &&
			record['authorizationServerUrl']) ||
		null
	if (!issuer) return null
	return mcpOAuthServerOrigin(issuer)
}

/**
 * Fail-closed copy when the server row, URL/origin, client, or discovered AS
 * origin no longer matches the attempt. Includes a reconnect link so agents
 * and UI can send the person back to start a fresh flow.
 */
export function mcpOAuthAttemptIdentityInvalidMessage(
	serverName?: string | null,
) {
	const label = serverName?.trim() ? ` "${serverName.trim()}"` : ''
	return `MCP server${label} was removed or changed while authorizing; nothing was saved. Reconnect at /account/mcp-servers.`
}

/**
 * True when authorization/token endpoints on discovery still target the AS
 * origin recorded when the attempt started. Missing endpoints are ignored;
 * a missing or unparsable live origin fails closed when a pending origin exists.
 */
export function discoveryMatchesAttemptAuthorizationServerOrigin(input: {
	pendingAuthorizationServerOrigin: string | null | undefined
	discovery: unknown
}): boolean {
	const pending = input.pendingAuthorizationServerOrigin
	if (!pending) return true
	const liveOrigin = authorizationServerOriginFromDiscovery(input.discovery)
	if (!liveOrigin || liveOrigin !== pending) return false
	try {
		assertEndpointsOnIssuerOrigin(input.discovery)
		return true
	} catch {
		return false
	}
}
