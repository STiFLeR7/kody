import { personIdFromStored } from '@kody-internal/shared/owner-person-ids.ts'
import { expect, test, vi } from 'vitest'
import { createMcpCallerContext } from '#mcp/context.ts'
import { type CredentialListItem } from '#universal/credential-contracts.ts'
import { credentialListCapability } from './credential-list.ts'

const listed = vi.hoisted(() => ({ items: [] as Array<unknown> }))

vi.mock('#worker/credentials/credential-list.ts', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listCredentialsForViewer: async () => listed.items,
}))

const item = (
	overrides: Partial<CredentialListItem> &
		Pick<CredentialListItem, 'id' | 'kind' | 'name'>,
): CredentialListItem => ({
	scope: 'org',
	provider: null,
	description: '',
	hosts: [],
	inject: null,
	packageId: null,
	lockedToPackageIds: [],
	expiresAt: null,
	createdAt: '2026-10-13T00:00:00.000Z',
	updatedAt: '2026-10-13T00:00:00.000Z',
	status: 'ok',
	statusMessage: null,
	mcp: null,
	...overrides,
})

const caller = (packageId: string | null) => ({
	env: { APP_DB: {} } as Env,
	callerContext: createMcpCallerContext({
		source: { kind: 'mcp-oauth' },
		baseUrl: 'https://example.com',
		user: {
			userId: personIdFromStored('user-1'),
			email: 'user@example.com',
			displayName: 'User',
		},
		...(packageId
			? {
					storageContext: {
						sessionId: null,
						appId: null,
						packageId,
						storageId: null,
					},
				}
			: {}),
	}),
})

test('credentialList returns MCP servers beside Keys and applies the filters', async () => {
	listed.items = [
		item({
			id: 'c-stripe',
			kind: 'secret',
			name: 'stripeKey',
			inject: { kind: 'header', name: 'X-Api-Key', format: '{value}' },
		}),
		item({
			id: 'mcp-linear',
			kind: 'mcp',
			name: 'linear',
			hosts: ['mcp.linear.app'],
			mcp: { url: 'https://mcp.linear.app/sse', enabled: true },
		}),
	]
	const all = await credentialListCapability.handler({}, caller(null))
	expect(all.credentials.map((credential) => credential.kind)).toEqual([
		'secret',
		'mcp',
	])
	const mcpOnly = await credentialListCapability.handler(
		{ kinds: ['mcp'] },
		caller(null),
	)
	expect(mcpOnly.credentials.map((credential) => credential.id)).toEqual([
		'mcp-linear',
	])
})

test('package code cannot list credentials', async () => {
	await expect(
		credentialListCapability.handler({}, caller('pkg-1')),
	).rejects.toThrow('Package code cannot list credentials')
})
