import { expect, test, vi } from 'vitest'
import { deleteSecret } from '#mcp/secrets/service.ts'
import { openCredentialClient } from '#worker/credentials/credential-client.ts'
import { buildPackageJobId } from '#worker/jobs/package-job-id.ts'
import { softDeleteGrant, upsertGrant } from '#worker/orgs/access-writes.ts'
import { deriveRequestContext } from '#worker/request-context/request-context.ts'
import { createTestOrgAuditWriter } from '#worker/test-support/create-audit-db.ts'
import {
	mockNeeds,
	now,
	rejection,
	setupCredentialClientFixture,
} from '#worker/test-support/credential-client-fixture.ts'
import { checkEnablementCredentials } from './credential-mapping.ts'
import { getEnablementById } from './repo.ts'
import { republishedNeedsNote } from './republish-needs-note.ts'
import { planEnablementRuns } from './run-gate.ts'
import {
	enableTriggerForCaller,
	updateEnablementCredentialsForCaller,
} from './service.ts'
import { type EnablementRecord } from './types.ts'

const scheduledAudits = vi.hoisted(() => [] as Array<Promise<unknown>>)
const mocks = vi.hoisted(() => ({ loadPackageManifestBySourceId: vi.fn() }))

vi.mock('cloudflare:workers', async (importOriginal) => ({
	...(await importOriginal<typeof import('cloudflare:workers')>()),
	waitUntil: (promise: Promise<unknown>) => {
		scheduledAudits.push(promise)
	},
}))

vi.mock('#worker/package-registry/source.ts', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('#worker/package-registry/source.ts')
	>()),
	loadPackageManifestBySourceId: mocks.loadPackageManifestBySourceId,
}))

const jobs = ['nightly', 'weekly', 'monthly'] as const

async function setup() {
	const t = await setupCredentialClientFixture(scheduledAudits)
	for (const [username, person] of Object.entries(t.people)) {
		await t.db
			.prepare(
				`INSERT INTO users (username, email, password_hash, email_verified_at, stable_user_id)
				 VALUES (?, ?, 'test-password-hash', ?, ?)`,
			)
			.bind(username, `${username}@example.com`, now, person.stableUserId)
			.run()
	}
	const packageId = await t.savePackage({
		ownerId: t.acmeId,
		name: '@acme/digest',
	})
	mocks.loadPackageManifestBySourceId.mockResolvedValue({
		manifest: {
			name: '@acme/digest',
			kody: {
				id: 'digest',
				description: 'digest',
				jobs: Object.fromEntries(
					jobs.map((job) => [
						job,
						{
							entry: './src/job.ts',
							schedule: { type: 'interval', every: '1h' },
						},
					]),
				),
			},
		},
	})
	mockNeeds([{ key: 'MAIL', provider: 'resend' }])
	// Ann (a member) may run the package.
	await upsertGrant({
		db: t.db,
		orgId: t.acmeId,
		resourceType: 'package',
		resourceId: packageId,
		subject: { type: 'user', id: t.people.ann.stableUserId },
		preset: 'use',
		permissions: null,
		createdByUserId: t.people.bea.stableUserId,
		audit: createTestOrgAuditWriter(),
	})
	const enable = async (
		person: 'ann' | 'bea',
		job: (typeof jobs)[number],
		credentials?: Record<string, Array<{ name: string; scope: null }>>,
	) =>
		await enableTriggerForCaller({
			env: t.env,
			baseUrl: 'https://example.com',
			request: t.requestAs(person, person === 'bea' ? 'owner' : 'member'),
			packageIdOrKodyId: packageId,
			kind: 'cron',
			name: job,
			credentials: credentials ? new Map(Object.entries(credentials)) : null,
		})
	const plan = async (job: (typeof jobs)[number]) =>
		await planEnablementRuns({
			env: t.env,
			orgId: t.acmeId,
			packageId,
			trigger: { kind: 'cron', instanceId: buildPackageJobId(packageId, job) },
		})
	const reload = async (enablement: EnablementRecord) =>
		(await getEnablementById({
			db: t.db,
			orgId: t.acmeId,
			id: enablement.id,
		}))!
	const runRequest = (person: 'ann' | 'bea', enablement: EnablementRecord) =>
		deriveRequestContext({
			user: { userId: t.people[person].personId, username: person },
			source: {
				kind: 'schedule',
				jobId: enablement.instanceId,
				enablement: {
					id: enablement.id,
					enabler: { userId: t.people[person].personId, username: person },
					role: person === 'bea' ? 'owner' : 'member',
				},
			},
			orgBinding: {
				org: { id: t.acmeId, slug: 'acme-clients' },
				role: person === 'bea' ? 'owner' : 'member',
			},
		})
	return { ...t, packageId, enable, plan, reload, runRequest }
}

const pick = (name: string) => [{ name, scope: null }]

test('enabling stores the needs that resolve, or nothing when one has no single credential', async () => {
	const t = await setup()
	const prodId = await t.storeKey({ name: 'resend-prod' })
	const first = await t.enable('bea', 'nightly')
	expect(first.warnings).toEqual([])
	expect(first.enablement.credentialMapping).toEqual({
		MAIL: [{ id: prodId, scope: 'org' }],
	})

	const backupId = await t.storeKey({ name: 'resend-backup' })
	await t.grantUse(prodId, 'ann')
	await t.grantUse(backupId, 'ann')
	const ambiguous = await t.enable('ann', 'nightly')
	expect(ambiguous.enablement.credentialMapping).toBeNull()
	expect(ambiguous.warnings).toEqual([
		expect.stringContaining('MAIL has no single credential you can use'),
	])
	// Without a snapshot the run gate checks nothing new.
	await expect(
		checkEnablementCredentials({
			env: t.env,
			request: t.runRequest('ann', ambiguous.enablement),
			enablement: ambiguous.enablement,
		}),
	).resolves.toBeNull()

	const picked = await t.enable('ann', 'weekly', {
		MAIL: pick('resend-backup'),
	})
	expect(picked.enablement.credentialMapping).toEqual({
		MAIL: [{ id: backupId, scope: 'org' }],
	})
	await expect(
		rejection(t.enable('ann', 'weekly', { MAIL: pick('resend-prod') })),
	).resolves.toMatchObject({
		message: expect.stringContaining('already on for you'),
	})
	await expect(
		rejection(t.enable('ann', 'monthly', { OTHER: pick('resend-prod') })),
	).resolves.toMatchObject({
		body: { code: 'credential_need_unknown' },
	})
	await expect(
		rejection(
			t.enable('ann', 'monthly', {
				MAIL: [...pick('resend-prod'), ...pick('resend-backup')],
			}),
		),
	).resolves.toMatchObject({ body: { code: 'invalid_request' } })
})

test('runs use the stored credential, and lost Use pauses the enablement until it is back', async () => {
	const t = await setup()
	const prodId = await t.storeKey({ name: 'resend-prod' })
	const backupId = await t.storeKey({ name: 'resend-backup' })
	await t.grantUse(prodId, 'ann')
	const backupGrant = await t.grantUse(backupId, 'ann')
	const { enablement } = await t.enable('ann', 'weekly', {
		MAIL: pick('resend-backup'),
	})

	// Two candidates match, yet the run gets the stored one with no pick.
	const opened = await openCredentialClient(
		t.contextFor({
			request: t.runRequest('ann', enablement),
			packageId: t.packageId,
		}),
		{ key: 'MAIL' },
	)
	expect(opened.name).toBe('resend-backup')
	expect((await t.plan('weekly')).runs.map((run) => run.id)).toEqual([
		enablement.id,
	])

	await softDeleteGrant({
		db: t.db,
		orgId: t.acmeId,
		grantId: backupGrant.id,
		audit: createTestOrgAuditWriter(),
	})
	const paused = await t.plan('weekly')
	expect(paused.runs).toEqual([])
	expect(paused.skipped).toEqual([
		expect.objectContaining({ enablementId: enablement.id, reason: 'paused' }),
	])
	expect((await t.reload(enablement)).pause).toMatchObject({
		reason: 'credential_access',
		permission: 'secret:use',
		credentialId: backupId,
	})
	// Mid-run, a lost credential never falls back to the other candidate.
	await expect(
		rejection(
			openCredentialClient(
				t.contextFor({
					request: t.runRequest('ann', enablement),
					packageId: t.packageId,
				}),
				{ key: 'MAIL' },
			),
		),
	).resolves.toMatchObject({ body: { code: 'credential_denied' } })

	await t.grantUse(backupId, 'ann')
	expect((await t.plan('weekly')).runs.map((run) => run.id)).toEqual([
		enablement.id,
	])
	expect((await t.reload(enablement)).state).toBe('on')
})

test('only the enabler changes the stored credentials, audited, and it lifts a pause on the old ones', async () => {
	const t = await setup()
	const prodId = await t.storeKey({ name: 'resend-prod' })
	const backupId = await t.storeKey({ name: 'resend-backup' })
	await t.grantUse(prodId, 'ann')
	await t.grantUse(backupId, 'ann')
	const { enablement } = await t.enable('ann', 'weekly', {
		MAIL: pick('resend-backup'),
	})
	const update = (person: 'ann' | 'bea', name: string) =>
		updateEnablementCredentialsForCaller({
			env: t.env,
			request: t.requestAs(person, person === 'bea' ? 'owner' : 'member'),
			enablementId: enablement.id,
			credentials: new Map([['MAIL', pick(name)]]),
		})

	await expect(rejection(update('bea', 'resend-prod'))).resolves.toMatchObject({
		message: expect.stringContaining('Only the enabler'),
	})

	await deleteSecret({
		env: t.env,
		userId: t.acmeId,
		scope: 'user',
		name: 'resend-backup',
	})
	await t.plan('weekly')
	expect((await t.reload(enablement)).state).toBe('paused')

	const updated = await update('ann', 'resend-prod')
	expect(updated.state).toBe('on')
	expect(updated.credentialMapping).toEqual({
		MAIL: [{ id: prodId, scope: 'org' }],
	})
	const audit = await t.env.AUDIT_DB.prepare(
		`SELECT resource_id, details_json FROM org_audit_events
		 WHERE action = 'enablement.credentials_updated'`,
	).all<{ resource_id: string; details_json: string }>()
	expect(audit.results).toHaveLength(1)
	expect(audit.results[0]!.resource_id).toBe(enablement.id)
	expect(JSON.parse(audit.results[0]!.details_json)).toMatchObject({
		credentials: {
			before: { MAIL: [{ id: backupId }] },
			after: { MAIL: [{ id: prodId }] },
		},
	})
	expect((await t.plan('weekly')).runs.map((run) => run.id)).toEqual([
		enablement.id,
	])
})

test('a republish that adds a need with no single credential pauses stored enablements and says so on publish', async () => {
	const t = await setup()
	await t.storeKey({ name: 'resend-prod' })
	const { enablement } = await t.enable('bea', 'nightly')
	const needs = [
		{ key: 'MAIL', provider: 'resend' },
		{ key: 'SMS', provider: 'twilio' },
	]
	mockNeeds(needs)
	expect((await t.plan('nightly')).runs).toEqual([])
	expect((await t.reload(enablement)).pause).toMatchObject({
		reason: 'credential_access',
		resourceType: 'credential-need',
		resourceId: 'SMS',
	})

	await t.storeKey({ name: 'twilio-main', provider: 'twilio' })
	expect((await t.plan('nightly')).runs.map((run) => run.id)).toEqual([
		enablement.id,
	])

	mockNeeds([{ key: 'MAIL', provider: 'resend' }])
	const note = await republishedNeedsNote({
		env: t.env,
		userId: t.acmeId,
		packageName: '@acme/digest',
		needs: needs.map((need) => ({
			...need,
			kind: 'secret' as const,
			description: '',
			multiple: false,
		})),
	})
	expect(note).toContain('adds credential needs SMS')
	expect(note).toContain('1 live enablement')
	await expect(
		republishedNeedsNote({
			env: t.env,
			userId: t.acmeId,
			packageName: '@acme/unknown',
			needs: [],
		}),
	).resolves.toBeNull()
})
