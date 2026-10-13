import { type Action } from 'remix/router'
import { requireAuthenticatedPageUser } from '#app/page-auth.ts'
import { credentialCreateInterimHref } from '#universal/credential-contracts.ts'
import { type routes } from '#universal/routes.ts'

/**
 * The credential creation link agents hand out. Until the one-pager ships it
 * sends the visit, query intact, to the existing page for the requested kind.
 */
export function createConnectCredentialHandler(env: Env) {
	return {
		middleware: [],
		async handler({ request }) {
			const user = await requireAuthenticatedPageUser(request, env)
			if (user instanceof Response) {
				return user
			}
			const requestUrl = new URL(request.url)
			const location = credentialCreateInterimHref({
				search: requestUrl.searchParams,
				orgSlug: user.request.org.slug ?? user.username,
			})
			return new Response(null, {
				status: 302,
				headers: {
					location: new URL(location, requestUrl).toString(),
					'cache-control': 'private, no-store',
				},
			})
		},
	} satisfies Action<typeof routes.connectCredential>
}
