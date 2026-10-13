import { type Action } from 'remix/router'
import { loadAccountCredentialsData } from '#app/account-credentials-data.ts'
import { readAuthenticatedAppUser } from '#app/authenticated-user.ts'
import { requireAuthenticatedPageUser } from '#app/page-auth.ts'
import { renderAppPage } from '#app/ssr-render.tsx'
import { jsonResponse } from '#worker/json-response.ts'
import { readCredentialListFilters } from '#universal/credentials-list.ts'
import { type routes } from '#universal/routes.ts'

/** `/@slug/-/credentials`: every credential the org holds, in one list. */
export function createAccountCredentialsHandler(env: Env) {
	return {
		middleware: [],
		async handler({ request }: { request: Request }) {
			const user = await requireAuthenticatedPageUser(request, env)
			if (user instanceof Response) return user
			const accountCredentials = await loadAccountCredentialsData({
				env,
				user,
			})
			return renderAppPage({
				request,
				env,
				title: 'Credentials',
				loaderData: { accountCredentials },
			})
		},
	}
}

/**
 * `GET /account/credentials.json`: the request org's credentials list as
 * `CredentialListItem`s, plus what the website page needs. A fetch from an
 * `/@slug/-/…` page binds that org. Metadata only, never a value.
 */
export function createAccountCredentialsApiHandler(env: Env) {
	return {
		middleware: [],
		async handler({ request }) {
			if (request.method !== 'GET') {
				return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405)
			}
			const user = await readAuthenticatedAppUser(request, env)
			if (!user) {
				return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401)
			}
			return jsonResponse(
				await loadAccountCredentialsData({
					env,
					user,
					filters: readCredentialListFilters(new URL(request.url).searchParams),
				}),
			)
		},
	} satisfies Action<typeof routes.accountCredentialsApi>
}
