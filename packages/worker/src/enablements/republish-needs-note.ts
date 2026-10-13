import { loadPublishedCredentialNeeds } from '#worker/credentials/credential-needs-closure.ts'
import { type CredentialNeed } from '#worker/credentials/credential-needs.ts'
import { getSavedPackageByName } from '#worker/package-registry/repo.ts'

/**
 * A publish note (ADR 0068) when a republish adds credential needs while
 * enablements that stored their credentials are live: those runs resolve the
 * new needs on each run and pause if one has no single credential. Null when
 * nothing applies. Informational only; it never fails a publish.
 */
export async function republishedNeedsNote(input: {
	env: Env
	userId: string
	packageName: string
	needs: ReadonlyArray<CredentialNeed>
}): Promise<string | null> {
	if (input.needs.length === 0) return null
	const saved = await getSavedPackageByName(input.env.APP_DB, {
		userId: input.userId,
		name: input.packageName,
	})
	if (!saved) return null
	const row = await input.env.APP_DB.prepare(
		`SELECT COUNT(*) AS live FROM enablements
		 WHERE org_id = ? AND package_id = ? AND state <> 'off'
		   AND credential_mapping_json IS NOT NULL`,
	)
		.bind(saved.userId, saved.id)
		.first<{ live: number }>()
	const live = row?.live ?? 0
	if (live === 0) return null
	const before = new Set(
		(
			await loadPublishedCredentialNeeds({
				env: input.env,
				userId: saved.userId,
				sourceId: saved.sourceId,
			})
		).map((need) => need.key),
	)
	const added = input.needs
		.map((need) => need.key)
		.filter((key) => !before.has(key))
	if (added.length === 0) return null
	return `This publish adds credential needs ${added.join(', ')}. ${live} live enablement${
		live === 1 ? '' : 's'
	} of this package stored ${live === 1 ? 'its' : 'their'} credentials earlier: ${
		live === 1 ? 'it resolves' : 'they resolve'
	} the new needs on each run and pause${
		live === 1 ? 's' : ''
	} if one has no single credential. Enablers can pin them with enablementUpdate.`
}
