/**
 * Every credential kind the Credentials page lists (ADR 0068). `secret` is
 * the Key kind: today's secrets and their placeholders. `vault` is a secret
 * provider binding (for example 1Password) that resolves references at run
 * time.
 */
export const credentialListKinds = [
	'secret',
	'oauth',
	'mcp',
	'url',
	'login',
	'signing',
	'vault',
] as const

export type CredentialListKind = (typeof credentialListKinds)[number]

export function isCredentialListKind(
	value: unknown,
): value is CredentialListKind {
	return (credentialListKinds as ReadonlyArray<unknown>).includes(value)
}

export function credentialKindLabel(kind: CredentialListKind) {
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
		case 'vault':
			return 'Vault'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

export type CredentialOwner = 'org' | 'personal'

export type CredentialListStatus =
	| 'ready'
	| 'expired'
	| 'not_connected'
	| 'auth_failed'
	| 'disabled'

export function credentialStatusLabel(status: CredentialListStatus) {
	switch (status) {
		case 'ready':
			return 'Ready'
		case 'expired':
			return 'Expired'
		case 'not_connected':
			return 'Not connected'
		case 'auth_failed':
			return 'Sign-in failed'
		case 'disabled':
			return 'Disabled'
		default: {
			const exhaustive: never = status
			return exhaustive
		}
	}
}

/**
 * One credential row. Metadata only: no value, token, or client secret is
 * ever part of this shape.
 */
export type AccountCredentialListItem = {
	/** Stable credential id (grants and enablements key on it). */
	id: string
	kind: CredentialListKind
	name: string
	description: string
	provider: string | null
	hosts: Array<string>
	owner: CredentialOwner
	/**
	 * The package whose own value this is (a package-scope secret or a vault
	 * binding). Null for credentials that belong to the org or person.
	 */
	packageId: string | null
	/** Packages this credential is locked to. Empty means no package lock. */
	lockedPackageIds: Array<string>
	status: CredentialListStatus
	expiresAt: string | null
	updatedAt: string
	/** The page that edits this credential today. */
	manageHref: string
}

export type AccountCredentialsLoaderData = {
	ok: true
	orgSlug: string
	/** True in a team org, where personal credentials can be granted in. */
	teamOrg: boolean
	credentials: Array<AccountCredentialListItem>
	packages: Array<{ id: string; kodyId: string; name: string }>
}
