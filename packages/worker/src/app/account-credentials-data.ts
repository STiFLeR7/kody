import { personalOrgId } from '@kody-internal/shared/owner-person-ids.ts'
import { type AuthenticatedAppUser } from '#app/authenticated-user.ts'
import { listCredentialsForViewer } from '#worker/credentials/credential-list.ts'
import { listCredentialProviderBindings } from '#worker/credentials/credential-provider-bindings.ts'
import { loadOrgBindingForOrg } from '#worker/orgs/repo.ts'
import { listSavedPackagesByUserId } from '#worker/package-registry/repo.ts'
import { ownerIdFromCaller } from '#worker/request-context/owner-id.ts'
import { type CredentialListFilters } from '#universal/credential-contracts.ts'
import { type AccountCredentialsResponse } from '#universal/credentials-list.ts'

/** The Credentials list for the org this request is bound to. */
export async function loadAccountCredentialsData(input: {
	env: Env
	user: AuthenticatedAppUser
	filters?: CredentialListFilters
}): Promise<AccountCredentialsResponse> {
	const orgId = ownerIdFromCaller({
		request: input.user.request,
		user: input.user.mcpUser,
	})
	const viewer = input.user.mcpUser.userId
	const personalId = personalOrgId(viewer)
	const teamOrg = orgId !== personalId
	const orgSlug = input.user.request.org.slug ?? input.user.username
	const [personalOrgSlug, credentials, providers, packages] = await Promise.all(
		[
			teamOrg
				? loadOrgBindingForOrg(input.env.APP_DB, viewer, personalId).then(
						(binding) => binding?.org.slug ?? null,
					)
				: orgSlug,
			listCredentialsForViewer({
				env: input.env,
				request: input.user.request,
				filters: input.filters,
			}),
			listCredentialProviderBindings(input.env.APP_DB, orgId),
			listSavedPackagesByUserId(input.env.APP_DB, { userId: orgId }),
		],
	)
	return {
		ok: true,
		credentials,
		orgSlug,
		personalOrgSlug,
		teamOrg,
		providers,
		packages: packages.map((row) => ({
			id: row.id,
			kodyId: row.kodyId,
			name: row.name,
		})),
	}
}
