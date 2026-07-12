const CRON_JOB_ORG_API = "https://api.cron-job.org/jobs";

export const CRON_JOB_ORG_CREATE_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepMs(ms: number): Promise<void> {
	return sleep(ms);
}

async function readCronJobOrgError(response: Response): Promise<string> {
	const text = (await response.text()).trim();
	if (text) return text;
	return `cron-job.org returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
}

export async function createCronJobOrgJob(
	job: Record<string, unknown>,
	options?: {
		retries?: number;
		retryDelayMs?: number;
	},
): Promise<{ ok: true; jobId: string | number } | { ok: false; error: string }> {
	const apiKey = process.env.CRONJOB_API_KEY;
	if (!apiKey) {
		return { ok: false, error: "Missing CRONJOB_API_KEY configuration" };
	}

	const retries = options?.retries ?? 4;
	const retryDelayMs = options?.retryDelayMs ?? 1000;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await fetch(CRON_JOB_ORG_API, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ job }),
			});

			if (response.ok) {
				const data = (await response.json()) as { jobId?: string | number };
				if (data.jobId === undefined || data.jobId === null) {
					return { ok: false, error: "cron-job.org response missing jobId" };
				}
				return { ok: true, jobId: data.jobId };
			}

			const error = await readCronJobOrgError(response);
			if (attempt < retries) {
				await sleep(retryDelayMs * attempt);
				continue;
			}
			return { ok: false, error };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (attempt < retries) {
				await sleep(retryDelayMs * attempt);
				continue;
			}
			return { ok: false, error: message };
		}
	}

	return { ok: false, error: "Failed to create cron-job.org job" };
}

export function friendlyCallJobTitle(params: {
	phoneNumber: string;
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}): string {
	const date = `${params.year}-${String(params.month).padStart(2, "0")}-${String(params.day).padStart(2, "0")}`;
	const time = `${String(params.hour).padStart(2, "0")}:${String(params.minute).padStart(2, "0")}`;
	return `Friendly call for ${params.phoneNumber} on ${date} at ${time}`;
}
