import { isExecutedDirectly } from '../node-runtime.ts'
import {
	assertPreviewResourceName,
	cleanupPreviewResources,
	previewResourceNamePattern,
} from './preview-resources.ts'
import { cloudflareApiRequest, fail } from './resource-utils.ts'

/**
 * Scheduled sweep for PR previews whose close-time cleanup never ran or
 * failed (#3396). Leftover preview Workers keep their Durable Object
 * namespaces, and the account cap (500) then fails every new preview deploy.
 * `kody-pr-<number>*` names whose pull request is closed are swept this way.
 * Every delete goes through `cleanupPreviewResources`, which applies the
 * preview naming guard (#2024).
 *
 * Branch previews (`kody-branch-<slug>*`) have no pull request to check, so
 * they are swept on worker liveness instead: once the bare `kody-branch-<slug>`
 * script is gone, its D1/KV/R2 leftovers are orphaned and swept the same way
 * (#3563).
 */

const prPreviewNamePattern = /^kody-pr-(\d+)(?:-|$)/
const branchWorkerNamePattern = /^kody-branch-[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Fixed suffixes `buildPreviewResourceNames`/`listPreviewWorkerNames`
 * (`preview-resources.ts`) append to a preview worker's base name, longest
 * first so "-audit-db"/"-jobs-db" strip before the shorter "-db". A branch
 * slug that happens to end in one of these words (e.g. a branch literally
 * named `.../my-runtime`) is misread as a suffixed resource of a shorter
 * base; accepted as a known edge case of free-form slugs, same as
 * `buildPreviewResourceNames`'s own truncation note.
 *
 * Preview queues are excluded: `previewQueueName` (preview-queue-plan.ts) can
 * hash and truncate the suffix, so it cannot be reversed from the name
 * alone. A queue-only leftover with no other trace is not detected by this
 * sweep; #3563 asks for D1/KV/R2, not queues. Mock-server workers
 * (`-mock-<service>`) are excluded for the same reason (dynamic suffix).
 */
const previewDerivedNameSuffixes = [
	'-audit-db',
	'-jobs-db',
	'-bundle-artifacts-kv',
	'-community-assets',
	'-repo-session-blobs',
	'-operator-backups',
	'-email-blobs',
	'-highlight',
	'-platform',
	'-runtime',
	'-vectors',
	'-oauth-kv',
	'-db',
	'-api',
	'-jobs',
].sort((left, right) => right.length - left.length)

export const previewSweepMaxPerRunDefault = 10

export type PullRequestState = 'open' | 'closed' | 'unknown'

export function previewPullRequestNumber(name: string): number | null {
	if (!previewResourceNamePattern.test(name)) return null
	const match = prPreviewNamePattern.exec(name)
	if (!match?.[1]) return null
	const number = Number.parseInt(match[1], 10)
	return Number.isSafeInteger(number) && number > 0 ? number : null
}

export function collectPreviewPullRequestNumbers(
	names: Iterable<string>,
): Array<number> {
	const numbers = new Set<number>()
	for (const name of names) {
		const number = previewPullRequestNumber(name)
		if (number !== null) numbers.add(number)
	}
	return [...numbers].sort((left, right) => left - right)
}

/**
 * Branch previews (`kody-branch-<slug>`) have no pull request to check, so
 * they are swept on worker liveness instead: the bare `kody-branch-<slug>`
 * script is the one `listPreviewWorkerNames` deploys as the public entry
 * (what `.../health` answers), so its absence from the current
 * `/workers/scripts` listing means the preview is gone and only its D1/KV/R2
 * leftovers remain (#3563).
 */
export function previewBranchWorkerName(name: string): string | null {
	if (!previewResourceNamePattern.test(name)) return null
	if (!name.startsWith('kody-branch-')) return null
	const suffix = previewDerivedNameSuffixes.find((candidate) =>
		name.endsWith(candidate),
	)
	const base = suffix ? name.slice(0, -suffix.length) : name
	return branchWorkerNamePattern.test(base) ? base : null
}

export function collectPreviewBranchWorkerNames(
	names: Iterable<string>,
): Array<string> {
	const workerNames = new Set<string>()
	for (const name of names) {
		const workerName = previewBranchWorkerName(name)
		if (workerName !== null) workerNames.add(workerName)
	}
	return [...workerNames].sort()
}

export function planPreviewSweep(input: {
	pullRequestNumbers: ReadonlyArray<number>
	states: ReadonlyMap<number, PullRequestState>
	maxPerRun: number
}) {
	const closed = input.pullRequestNumbers.filter(
		(number) => input.states.get(number) === 'closed',
	)
	return {
		sweep: closed.slice(0, Math.max(0, input.maxPerRun)),
		deferred: closed.slice(Math.max(0, input.maxPerRun)),
		open: input.pullRequestNumbers.filter(
			(number) => input.states.get(number) === 'open',
		),
		unknown: input.pullRequestNumbers.filter(
			(number) => (input.states.get(number) ?? 'unknown') === 'unknown',
		),
	}
}

export function planBranchPreviewSweep(input: {
	branchWorkerNames: ReadonlyArray<string>
	liveNames: ReadonlySet<string>
	maxPerRun: number
}) {
	const orphaned = input.branchWorkerNames.filter(
		(name) => !input.liveNames.has(name),
	)
	return {
		sweep: orphaned.slice(0, Math.max(0, input.maxPerRun)),
		deferred: orphaned.slice(Math.max(0, input.maxPerRun)),
		live: input.branchWorkerNames.filter((name) => input.liveNames.has(name)),
	}
}

type CloudflareClient = {
	accountId: string
	apiToken: string
	fetcher?: typeof fetch
}

/**
 * The Durable Object namespace listing has answered both `[...]` and
 * `{ namespaces: [...] }` (see `origin-production-deploy-state.ts`).
 */
function readListedItems<T>(result: unknown, pathname: string): Array<T> {
	if (result === undefined || result === null) return []
	if (Array.isArray(result)) return result as Array<T>
	const namespaces = (result as { namespaces?: unknown }).namespaces
	if (Array.isArray(namespaces)) return namespaces as Array<T>
	throw new Error(`Cloudflare listing ${pathname} returned a malformed result.`)
}

async function listPaged<T>(
	client: CloudflareClient,
	pathname: string,
	perPage: number,
) {
	const items: Array<T> = []
	for (let page = 1; page <= 100; page += 1) {
		const separator = pathname.includes('?') ? '&' : '?'
		const payload = await cloudflareApiRequest<unknown>({
			...client,
			pathname: `${pathname}${separator}page=${String(page)}&per_page=${String(perPage)}`,
		})
		const result = readListedItems<T>(payload.result, pathname)
		items.push(...result)
		const totalPages = payload.result_info?.total_pages
		const lastPage =
			typeof totalPages === 'number'
				? page >= totalPages
				: result.length < perPage
		if (lastPage) break
	}
	return items
}

/**
 * Worker scripts, Durable Object namespaces (by owning script), and D1
 * databases. A preview whose Workers are gone but whose D1 cleanup failed is
 * still found through its `kody-pr-<n>-db` names. The scripts listing is one
 * unpaged response; every Worker holding a namespace is also found through
 * the paged namespace owners.
 */
export async function listPreviewCandidateNames(client: CloudflareClient) {
	const scripts = await cloudflareApiRequest<Array<{ id?: string }>>({
		...client,
		pathname: '/workers/scripts',
	})
	const namespaces = await listPaged<{ script?: string; name?: string }>(
		client,
		'/workers/durable_objects/namespaces',
		100,
	)
	const databases = await listPaged<{ name?: string }>(
		client,
		'/d1/database',
		100,
	)
	const names = [
		...(scripts.result ?? []).map((script) => script.id),
		...namespaces.flatMap((namespace) => [namespace.script, namespace.name]),
		...databases.map((database) => database.name),
	]
	return names.filter((name): name is string => typeof name === 'string')
}

export async function readPullRequestState(input: {
	repository: string
	number: number
	githubToken: string
	fetcher?: typeof fetch
}): Promise<PullRequestState> {
	const response = await (input.fetcher ?? fetch)(
		`https://api.github.com/repos/${input.repository}/pulls/${String(input.number)}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${input.githubToken}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
			signal: AbortSignal.timeout(15_000),
		},
	)
	if (response.status === 404) {
		await response.body?.cancel()
		return 'unknown'
	}
	if (!response.ok) {
		throw new Error(
			`GitHub API GET pulls/${String(input.number)} failed (${String(response.status)}).`,
		)
	}
	const json = (await response.json()) as { state?: unknown }
	if (json.state === 'open' || json.state === 'closed') return json.state
	return 'unknown'
}

function parseArgs(argv: ReadonlyArray<string>) {
	let maxPerRun = previewSweepMaxPerRunDefault
	let dryRun = false
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === '--dry-run') {
			dryRun = true
		} else if (arg === '--max') {
			const value = Number.parseInt(argv[index + 1] ?? '', 10)
			if (!Number.isSafeInteger(value) || value < 0) {
				fail('--max requires a non-negative integer.')
			}
			maxPerRun = value
			index += 1
		} else if (arg) {
			fail(
				`Unknown argument: ${arg}. Usage: node tools/ci/preview-sweep.ts [--max <n>] [--dry-run]`,
			)
		}
	}
	return { maxPerRun, dryRun }
}

function requireEnv(name: string) {
	const value = process.env[name]?.trim()
	if (!value) fail(`Missing ${name} for the preview sweep.`)
	return value
}

async function main() {
	const { maxPerRun, dryRun } = parseArgs(process.argv.slice(2))
	const client = {
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		apiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
	}
	const repository = requireEnv('GITHUB_REPOSITORY')
	const githubToken = requireEnv('GITHUB_TOKEN')
	const readState = (number: number) =>
		readPullRequestState({ repository, number, githubToken })

	const names = await listPreviewCandidateNames(client)
	const liveNames = new Set(names)
	const pullRequestNumbers = collectPreviewPullRequestNumbers(names)
	const states = new Map<number, PullRequestState>()
	for (const number of pullRequestNumbers) {
		states.set(number, await readState(number))
	}
	const plan = planPreviewSweep({ pullRequestNumbers, states, maxPerRun })
	console.log(
		[
			`Preview sweep: ${String(pullRequestNumbers.length)} PR preview(s) on the account.`,
			`  open: ${plan.open.join(', ') || 'none'}`,
			`  closed, sweeping now: ${plan.sweep.join(', ') || 'none'}`,
			`  closed, next run: ${plan.deferred.join(', ') || 'none'}`,
			`  no matching PR (left alone): ${plan.unknown.join(', ') || 'none'}`,
		].join('\n'),
	)

	const failed: Array<number> = []
	for (const number of plan.sweep) {
		// A PR reopened since the listing redeploys its preview; leave it.
		if ((await readState(number)) !== 'closed') {
			console.log(`Skipping kody-pr-${String(number)}: PR is no longer closed.`)
			continue
		}
		const workerName = `kody-pr-${String(number)}`
		assertPreviewResourceName(workerName, 'worker')
		console.log(`Cleaning up ${workerName}${dryRun ? ' (dry run)' : ''}.`)
		try {
			await cleanupPreviewResources({ workerName, dryRun, ...client })
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error))
			failed.push(number)
		}
	}
	const branchWorkerNames = collectPreviewBranchWorkerNames(names)
	const branchPlan = planBranchPreviewSweep({
		branchWorkerNames,
		liveNames,
		maxPerRun,
	})
	console.log(
		[
			`Branch preview sweep: ${String(branchWorkerNames.length)} branch preview(s) on the account.`,
			`  live: ${branchPlan.live.join(', ') || 'none'}`,
			`  orphaned, sweeping now: ${branchPlan.sweep.join(', ') || 'none'}`,
			`  orphaned, next run: ${branchPlan.deferred.join(', ') || 'none'}`,
		].join('\n'),
	)

	const failedBranches: Array<string> = []
	for (const workerName of branchPlan.sweep) {
		assertPreviewResourceName(workerName, 'worker')
		console.log(`Cleaning up ${workerName}${dryRun ? ' (dry run)' : ''}.`)
		try {
			await cleanupPreviewResources({ workerName, dryRun, ...client })
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error))
			failedBranches.push(workerName)
		}
	}

	if (failed.length > 0 || failedBranches.length > 0) {
		const failedNames = [
			...failed.map((number) => `kody-pr-${String(number)}`),
			...failedBranches,
		]
		fail(
			`Preview sweep could not fully clean up: ${failedNames.join(', ')}. The next scheduled run retries them.`,
		)
	}
}

if (isExecutedDirectly(import.meta.url)) {
	try {
		await main()
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error))
	}
}
