import { DatabaseSync } from 'node:sqlite'
import {
	ownerIdFromStored,
	personalOrgId,
	personIdFromStored,
} from '@kody-internal/shared/owner-person-ids.ts'
import { expect, test } from 'vitest'
import { createOrganization } from '#worker/orgs/create-organization.ts'
import { provisionPersonalOrg } from '#worker/orgs/provision.ts'
import { applyAllMigrations } from '#worker/test-support/apply-all-migrations.ts'
import { createTestOrgAuditWriter } from '#worker/test-support/create-audit-db.ts'
import { createD1FromSqlite } from '#worker/test-support/create-d1-from-sqlite.ts'
import { testStableUserIdFromEmail } from '#worker/test-support/stable-user-id.ts'
import { createInMemoryUserMeterEnv } from '#worker/test-support/user-meter.ts'
import { saveSecret } from '#mcp/secrets/service.ts'
import { findCredentialIdsByLegacyName } from './credential-ids.ts'
import { listOrgCredentialsForPage } from './credential-list.ts'
import { grantPersonalCredentialToOrg } from './personal-credentials.ts'

const now = new Date('2026-10-11T00:00:00.000Z')

async function setup() {
	const sqlite = new DatabaseSync(':memory:')
	applyAllMigrations(sqlite, new URL('../../migrations/', import.meta.url))
	const db = createD1FromSqlite(sqlite)
	const env = {
		APP_DB: db,
		...createInMemoryUserMeterEnv().env,
		SECRET_STORE_KEY: 'test-secret-store-key-32-chars-minimum',
	} as unknown as Env
	const people = Object.fromEntries(
		(['ann', 'bea'] as const).map((username) => {
			const stableUserId = testStableUserIdFromEmail(`${username}@example.com`)
			return [
				username,
				{ stableUserId, personId: personIdFromStored(stableUserId) },
			]
		}),
	) as Record<
		'ann' | 'bea',
		{ stableUserId: string; personId: ReturnType<typeof personIdFromStored> }
	>
	for (const [username, person] of Object.entries(people)) {
		await provisionPersonalOrg(db, {
			stableUserId: person.stableUserId,
			username,
			createdAt: now.toISOString(),
		})
	}
	const created = await createOrganization(
		db,
		{} as Pick<Env, 'BUNDLE_ARTIFACTS_KV'>,
		{
			personId: people.bea.personId,
			audit: createTestOrgAuditWriter(),
			slug: 'quillworks-co',
			displayName: 'Acme',
		},
	)
	if (!created.ok) throw new Error(created.error)
	const acme = await db
		.prepare(`SELECT id FROM orgs WHERE slug = 'quillworks-co'`)
		.first<{ id: string }>()
	const acmeId = ownerIdFromStored(acme!.id)
	await db
		.prepare(
			`INSERT INTO org_memberships (org_id, user_id, role, created_at)
			 VALUES (?, ?, 'member', ?)`,
		)
		.bind(acmeId, people.ann.stableUserId, now.toISOString())
		.run()
	const annOrgId = personalOrgId(people.ann.personId)
	return { db, env, people, acmeId, annOrgId }
}

async function secretId(db: D1Database, ownerId: string, name: string) {
	return (
		await findCredentialIdsByLegacyName(db, ownerId, { type: 'secret', name })
	)[0]!
}

test('a personal org lists every kind as personal metadata, never values', async () => {
	const t = await setup()
	await saveSecret({
		env: t.env,
		userId: t.annOrgId,
		scope: 'user',
		name: 'OPENAI_API_KEY',
		value: 'sk-live-never-shown',
		description: 'Model calls',
	})
	await saveSecret({
		env: t.env,
		userId: t.annOrgId,
		scope: 'user',
		name: 'STAGING_TOKEN',
		value: 'staging-never-shown',
		expiresAt: '2026-10-01T00:00:00.000Z',
	})
	await saveSecret({
		env: t.env,
		userId: t.annOrgId,
		scope: 'package',
		name: 'SLACK_WEBHOOK_TOKEN',
		value: 'slack-never-shown',
		storageContext: {
			sessionId: null,
			appId: null,
			packageId: 'pkg-digest',
			storageId: 'pkg-digest',
		},
	})
	const openAiId = await secretId(t.db, t.annOrgId, 'OPENAI_API_KEY')
	await t.db
		.prepare(
			`UPDATE secret_entries SET allowed_hosts = '["api.openai.com"]',
				allowed_packages = '["pkg-triage"]' WHERE id = ?`,
		)
		.bind(openAiId)
		.run()
	await t.db
		.prepare(
			`INSERT INTO mcp_server_settings
				(id, user_id, name, url, enabled, usage_mode, allowed_packages_json)
			 VALUES ('mcp-docs', ?, 'docs', 'https://docs.example.com/mcp', 0, 'packages', '["pkg-triage"]')`,
		)
		.bind(t.annOrgId)
		.run()
	await t.db
		.prepare(
			`INSERT INTO saved_packages (id, user_id, name, kody_id, description, source_id)
			 VALUES ('pkg-digest', ?, 'digest', 'digest', 'pkg', 'source-digest')`,
		)
		.bind(t.annOrgId)
		.run()
	await t.db
		.prepare(
			`INSERT INTO secret_provider_bindings
				(id, user_id, provider_id, package_id, door_secret_name)
			 VALUES ('vault-1', ?, '1password', 'pkg-digest', 'VAULT_DOOR')`,
		)
		.bind(t.annOrgId)
		.run()

	const items = await listOrgCredentialsForPage({
		db: t.db,
		orgId: t.annOrgId,
		orgSlug: 'ann',
		viewerPersonId: t.people.ann.personId,
		viewerPersonalOrgSlug: 'ann',
		now,
	})

	expect(JSON.stringify(items)).not.toMatch(/never-shown/)
	expect(
		items.map(({ kind, name, owner, status }) => ({
			kind,
			name,
			owner,
			status,
		})),
	).toEqual([
		{ kind: 'vault', name: '1password', owner: 'personal', status: 'ready' },
		{ kind: 'mcp', name: 'docs', owner: 'personal', status: 'disabled' },
		{
			kind: 'secret',
			name: 'OPENAI_API_KEY',
			owner: 'personal',
			status: 'ready',
		},
		{
			kind: 'secret',
			name: 'SLACK_WEBHOOK_TOKEN',
			owner: 'personal',
			status: 'ready',
		},
		{
			kind: 'secret',
			name: 'STAGING_TOKEN',
			owner: 'personal',
			status: 'expired',
		},
	])
	expect(items.find((item) => item.name === 'OPENAI_API_KEY')).toMatchObject({
		id: openAiId,
		description: 'Model calls',
		hosts: ['api.openai.com'],
		packageId: null,
		lockedPackageIds: ['pkg-triage'],
		manageHref: '/@ann/-/secrets/user/OPENAI_API_KEY',
	})
	expect(
		items.find((item) => item.name === 'SLACK_WEBHOOK_TOKEN'),
	).toMatchObject({ packageId: 'pkg-digest', lockedPackageIds: [] })
	expect(items.find((item) => item.kind === 'mcp')).toMatchObject({
		hosts: ['docs.example.com'],
		lockedPackageIds: ['pkg-triage'],
		manageHref: '/@ann/-/mcp-servers/mcp-docs',
	})
	expect(items.find((item) => item.kind === 'vault')).toMatchObject({
		packageId: 'pkg-digest',
		manageHref: '/@ann/-/secret-providers',
	})
})

test('a team org lists its own credentials plus only the viewer’s granted personal ones', async () => {
	const t = await setup()
	await saveSecret({
		env: t.env,
		userId: t.acmeId,
		scope: 'user',
		name: 'ACME_DEPLOY_KEY',
		value: 'acme-never-shown',
	})
	for (const name of ['annGranted', 'annPrivate']) {
		await saveSecret({
			env: t.env,
			userId: t.annOrgId,
			scope: 'user',
			name,
			value: `${name}-never-shown`,
		})
	}
	await grantPersonalCredentialToOrg({
		db: t.db,
		ownerPersonId: t.people.ann.personId,
		credentialId: await secretId(t.db, t.annOrgId, 'annGranted'),
		orgId: t.acmeId,
	})
	const list = (viewer: 'ann' | 'bea') =>
		listOrgCredentialsForPage({
			db: t.db,
			orgId: t.acmeId,
			orgSlug: 'quillworks-co',
			viewerPersonId: t.people[viewer].personId,
			viewerPersonalOrgSlug: viewer,
			now,
		})

	const annView = await list('ann')
	expect(JSON.stringify(annView)).not.toMatch(/never-shown/)
	expect(
		annView.map(({ name, owner, manageHref }) => ({ name, owner, manageHref })),
	).toEqual([
		{
			name: 'ACME_DEPLOY_KEY',
			owner: 'org',
			manageHref: '/@quillworks-co/-/secrets/user/ACME_DEPLOY_KEY',
		},
		{
			name: 'annGranted',
			owner: 'personal',
			manageHref: '/@ann/-/secrets/user/annGranted',
		},
	])
	// Another member never sees Ann's grant.
	expect((await list('bea')).map((item) => item.name)).toEqual([
		'ACME_DEPLOY_KEY',
	])
})
