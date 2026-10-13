import { personalOrgId } from '@kody-internal/shared/owner-person-ids.ts'
import { type AuthenticatedAppUser } from '#app/authenticated-user.ts'
import { listOrgCredentialsForPage } from '#worker/credentials/credential-list.ts'
import { loadOrgBindingForOrg } from '#worker/orgs/repo.ts'
import { listSavedPackagesByUserId } from '#worker/package-registry/repo.ts'
import { ownerIdFromCaller } from '#worker/request-context/owner-id.ts'
import { type AccountCredentialsLoaderData } from '#universal/credentials-list.ts'

/** The Credentials page payload for the org this request is bound to. */
export async function loadAccountCredentialsData(input: {
	env: Env
	user: AuthenticatedAppUser
}): Promise<AccountCredentialsLoaderData> {
	const orgId = ownerIdFromCaller({
		request: input.user.request,
		user: input.user.mcpUser,
	})
	const viewer = input.user.mcpUser.userId
	const personalId = personalOrgId(viewer)
	const teamOrg = orgId !== personalId
	const orgSlug = input.user.request.org.slug ?? input.user.username
	const personalSlug = teamOrg
		? ((await loadOrgBindingForOrg(input.env.APP_DB, viewer, personalId))?.org
				.slug ?? null)
		: orgSlug
	const [credentials, packages] = await Promise.all([
		listOrgCredentialsForPage({
			db: input.env.APP_DB,
			orgId,
			orgSlug,
			viewerPersonId: viewer,
			viewerPersonalOrgSlug: personalSlug,
		}),
		listSavedPackagesByUserId(input.env.APP_DB, { userId: orgId }),
	])
	return {
		ok: true,
		orgSlug,
		teamOrg,
		credentials,
		packages: packages.map((row) => ({
			id: row.id,
			kodyId: row.kodyId,
			name: row.name,
		})),
	}
}
